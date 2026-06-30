/**
 * SyncService 测试（V1.5 跨设备同步红线）
 *
 * 这是项目最容易丢数据的模块。覆盖：
 *  - pickSyncable / syncableChanged：白名单 + 变更判定
 *  - pushSettings + pullSettingsForce：圆环
 *  - pushBookmarks：分块、配额预检拒写、stale chunk 清理
 *  - readBookmarksRemote：缺块容错
 *  - handleSettingsRemoteChange / handleBookmarksRemoteChange：自回声防抖 + 重复应用防抖
 *  - bootstrapSync：远端新 → 应用；本地新 → 推；远端无 → 推
 *  - wipeRemote：清空云端 + 重置本地 meta
 *  - enableSync / disableSync：开关效果
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  KEY_BM_CHUNK_PREFIX,
  KEY_BM_MANIFEST,
  KEY_LOCAL_META,
  KEY_SETTINGS_PAYLOAD,
  SYNCABLE_SETTINGS_KEYS,
  bootstrapSync,
  disableSync,
  enableSync,
  estimateBookmarksBytes,
  getMeta,
  handleBookmarksRemoteChange,
  handleSettingsRemoteChange,
  keyBmChunk,
  pickSyncable,
  pullBookmarksForce,
  pullSettingsForce,
  pushBookmarks,
  pushSettings,
  setMeta,
  syncableChanged,
  wipeRemote,
} from './SyncService'
import { DEFAULT_SETTINGS, type BookmarkCard, type Category, type UserSettings } from '../types/bookmark'

// ─── helpers ──────────────────────────────────────────

function mkSettings(over: Partial<UserSettings> = {}): UserSettings {
  return { ...DEFAULT_SETTINGS, ...over }
}

function mkCat(id: string, over: Partial<Category> = {}): Category {
  return {
    id,
    name: id,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function mkCard(id: string, over: Partial<BookmarkCard> = {}): BookmarkCard {
  return {
    id,
    categoryId: 'cat1',
    title: `Card ${id}`,
    url: `https://x.com/${id}`,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

async function enable() {
  await setMeta({ enabled: true })
}

afterEach(async () => {
  await chrome.storage.local.clear()
  await chrome.storage.sync.clear()
})

// ─── pickSyncable / syncableChanged ───────────────────

describe('pickSyncable / syncableChanged', () => {
  it('只挑白名单字段', () => {
    const s = mkSettings({
      theme: 'dark',
      wallpaper: 'data:image/png;base64,xxx',
      sidebarWidth: 300,
    })
    const picked = pickSyncable(s)
    expect(picked.theme).toBe('dark')
    // 黑名单字段不能出现
    expect('wallpaper' in picked).toBe(false)
    expect('sidebarWidth' in picked).toBe(false)
    expect('browserSyncAuto' in picked).toBe(false)
    expect('syncProvider' in picked).toBe(false)
  })

  it('跳过 undefined', () => {
    const picked = pickSyncable(mkSettings({ fontColor: undefined }))
    expect('fontColor' in picked).toBe(false)
  })

  it('白名单内字段变化 → syncableChanged=true', () => {
    expect(syncableChanged(mkSettings(), mkSettings({ theme: 'dark' }))).toBe(true)
  })

  it('只有黑名单字段变化 → syncableChanged=false', () => {
    expect(
      syncableChanged(
        mkSettings({ wallpaper: 'a' }),
        mkSettings({ wallpaper: 'b' }),
      ),
    ).toBe(false)
  })

  it('白名单不漏字段（防漏检查）', () => {
    // 必须有这些核心字段；漏一个用户偏好就同步不到了
    const must = ['theme', 'layout', 'language', 'cardSize']
    for (const k of must) {
      expect(SYNCABLE_SETTINGS_KEYS as readonly string[]).toContain(k)
    }
  })
})

// ─── pushSettings + pullSettingsForce ─────────────────

describe('pushSettings / pullSettingsForce', () => {
  it('sync 未启用时 push 拒绝', async () => {
    const r = await pushSettings(mkSettings())
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/未启用/)
  })

  it('启用后 push → sync 上有 payload，meta.lastPushTs 写入', async () => {
    await enable()
    const r = await pushSettings(mkSettings({ theme: 'dark' }))
    expect(r.ok).toBe(true)
    expect(r.ts).toBeGreaterThan(0)

    const sync = await chrome.storage.sync.get(KEY_SETTINGS_PAYLOAD)
    expect(sync[KEY_SETTINGS_PAYLOAD]).toBeTruthy()

    const meta = await getMeta()
    expect(meta.settings.lastPushTs).toBe(r.ts)
    expect(meta.lastError).toBeUndefined()
  })

  it('pullForce 拿回 push 上去的内容（圆环）', async () => {
    await enable()
    // 用 'standard' 而不是 'large'：'large' 已在 v0.22.x 从 cardSize 联合移除，
    // 历史值现在由 sanitizeSettings 中的迁移兜底转成 'custom'（见下方专项测试）。
    await pushSettings(mkSettings({ theme: 'dark', cardSize: 'standard' }))
    const r = await pullSettingsForce()
    expect(r.applied?.theme).toBe('dark')
    expect(r.applied?.cardSize).toBe('standard')
  })

  it('sanitizeSettings 过滤掉远端的 unknown / 非法类型字段', async () => {
    await enable()
    // 直接造一个被污染的远端 payload
    await chrome.storage.sync.set({
      [KEY_SETTINGS_PAYLOAD]: {
        version: 1,
        ts: Date.now(),
        settings: {
          theme: 'dark', // ✅ string
          cardSize: { evil: true }, // ❌ 非法类型，应被丢
          unknownField: 'leaked', // ❌ 不在白名单
        },
      },
    })
    const r = await pullSettingsForce()
    expect(r.applied?.theme).toBe('dark')
    expect('cardSize' in (r.applied ?? {})).toBe(false)
    expect('unknownField' in (r.applied ?? {})).toBe(false)
  })

  it('v0.22.x 迁移兜底：远端旧版推上来的 cardSize:"large" 应用前被改写成 custom + 默认 W/H', async () => {
    // 场景：A 设备升级到新版（custom 档），B 设备还在旧版（cardSize='large'）。
    // B 推上去的 payload 是 'large'，A 拉下来时 sanitizeSettings 兜底应该把它
    // 改写成 'custom'，并注入与 LocalRepository.getSettings 同款的 192×128 默认。
    await enable()
    await chrome.storage.sync.set({
      [KEY_SETTINGS_PAYLOAD]: {
        version: 1,
        ts: Date.now(),
        settings: { cardSize: 'large' },
      },
    })
    const r = await pullSettingsForce()
    expect(r.applied?.cardSize).toBe('custom')
    expect(r.applied?.cardCustomWidthMin).toBe(192)
    expect(r.applied?.cardCustomWidthMax).toBe(192)
    expect(r.applied?.cardCustomHeightMin).toBe(128)
    expect(r.applied?.cardCustomHeightMax).toBe(128)
  })
})

// ─── handleSettingsRemoteChange: 自回声防抖 ──────────

describe('handleSettingsRemoteChange: 自回声防抖', () => {
  it('payload.ts <= lastPushTs → 忽略（自回声）', async () => {
    await enable()
    await setMeta({ settings: { lastPushTs: 1000 } })

    const r = await handleSettingsRemoteChange({
      version: 1,
      ts: 1000, // = lastPushTs
      settings: { theme: 'dark' },
    })
    expect(r.applied).toBeUndefined()
    expect(r.ts).toBeUndefined()
  })

  it('payload.ts <= lastPullTs → 忽略（重复应用）', async () => {
    await enable()
    await setMeta({ settings: { lastPullTs: 1000 } })

    const r = await handleSettingsRemoteChange({
      version: 1,
      ts: 999,
      settings: { theme: 'dark' },
    })
    expect(r.applied).toBeUndefined()
  })

  it('payload.ts 比双 ts 都新 → 应用并更新 lastPullTs', async () => {
    await enable()
    await setMeta({ settings: { lastPushTs: 1000, lastPullTs: 1000 } })

    const r = await handleSettingsRemoteChange({
      version: 1,
      ts: 2000,
      settings: { theme: 'dark' },
    })
    expect(r.applied?.theme).toBe('dark')
    expect(r.ts).toBe(2000)
    const m = await getMeta()
    expect(m.settings.lastPullTs).toBe(2000)
  })

  it('sync 未启用时不应用', async () => {
    const r = await handleSettingsRemoteChange({
      version: 1,
      ts: 9999,
      settings: { theme: 'dark' },
    })
    expect(r.applied).toBeUndefined()
  })
})

// ─── pushBookmarks ───────────────────────────────────

describe('pushBookmarks', () => {
  it('小数据：单 chunk + manifest', async () => {
    await enable()
    const cats = [mkCat('a'), mkCat('b')]
    const cards = [mkCard('1'), mkCard('2')]
    const r = await pushBookmarks(cats, cards)
    expect(r.ok).toBe(true)
    expect(r.chunks).toBe(1)
    expect(r.bytes).toBeGreaterThan(0)

    const sync = await chrome.storage.sync.get(null)
    expect(sync[KEY_BM_MANIFEST]).toBeTruthy()
    expect(sync[keyBmChunk(0)]).toBeTruthy()
  })

  it('大数据：自动分块 + manifest.chunkCount > 1', async () => {
    await enable()
    // 7000 字节单 chunk，做 ~20KB 数据 → 3 块
    const cards = Array.from({ length: 200 }, (_, i) =>
      mkCard(`bm-${i}`, { description: 'x'.repeat(80) }),
    )
    const r = await pushBookmarks([mkCat('a')], cards)
    expect(r.ok).toBe(true)
    expect(r.chunks).toBeGreaterThan(1)

    const sync = await chrome.storage.sync.get(null)
    const mf = sync[KEY_BM_MANIFEST] as { chunkCount: number; totalBytes: number }
    expect(mf.chunkCount).toBe(r.chunks)
    // chunk N-1 必须存在
    expect(sync[keyBmChunk(mf.chunkCount - 1)]).toBeTruthy()
  })

  it('超 100KB 总配额 → 拒写、不留脏 chunk', async () => {
    await enable()
    // 单个 description 1KB × 150 卡片 ≈ 150KB
    const cards = Array.from({ length: 150 }, (_, i) =>
      mkCard(`big-${i}`, { description: 'X'.repeat(1024) }),
    )
    const r = await pushBookmarks([mkCat('a')], cards)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/配额/)
    expect(r.quotaHint).toMatch(/100KB/)

    // 一个 chunk 都没写入
    const sync = await chrome.storage.sync.get(null)
    expect(sync[KEY_BM_MANIFEST]).toBeUndefined()
    for (const k of Object.keys(sync)) {
      expect(k.startsWith(KEY_BM_CHUNK_PREFIX)).toBe(false)
    }
    // meta 上应该写了 lastError
    const meta = await getMeta()
    expect(meta.lastError).toMatch(/配额|超出|100KB/)
  })

  it('第二次 push 更少 chunk → 清理旧的多余 chunk（pruneStaleChunks）', async () => {
    await enable()
    // 第一次：大量数据 → 多 chunk
    const bigCards = Array.from({ length: 100 }, (_, i) =>
      mkCard(`big-${i}`, { description: 'X'.repeat(120) }),
    )
    const r1 = await pushBookmarks([mkCat('a')], bigCards)
    expect(r1.ok).toBe(true)
    expect(r1.chunks!).toBeGreaterThan(1)

    // 第二次：少量数据 → 1 chunk
    const r2 = await pushBookmarks([mkCat('a')], [mkCard('1')])
    expect(r2.ok).toBe(true)
    expect(r2.chunks).toBe(1)

    // 旧的多余 chunk 应该被清掉
    const sync = await chrome.storage.sync.get(null)
    const chunkKeys = Object.keys(sync).filter((k) => k.startsWith(KEY_BM_CHUNK_PREFIX))
    expect(chunkKeys).toHaveLength(1)
    expect(chunkKeys).toContain(keyBmChunk(0))
  })

  it('sync 未启用时 push 拒绝', async () => {
    const r = await pushBookmarks([mkCat('a')], [mkCard('1')])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/未启用/)
  })
})

// ─── readBookmarksRemote / pullBookmarksForce ─────────

describe('pullBookmarksForce', () => {
  it('push 后能 pull 回原数据（圆环）', async () => {
    await enable()
    const cats = [mkCat('a'), mkCat('b', { parentId: 'a' })]
    const cards = [mkCard('1', { categoryId: 'a' }), mkCard('2', { categoryId: 'b' })]
    await pushBookmarks(cats, cards)

    const r = await pullBookmarksForce()
    expect(r.payload?.categories.map((c) => c.id)).toEqual(['a', 'b'])
    expect(r.payload?.cards.map((c) => c.id)).toEqual(['1', '2'])
  })

  it('远端缺块 → 返回 {} 而非崩溃', async () => {
    await enable()
    // 手工写一个声称有 5 chunk 但只写了 1 chunk 的脏 manifest
    await chrome.storage.sync.set({
      [KEY_BM_MANIFEST]: { version: 1, ts: 1, chunkCount: 5, totalBytes: 100 },
      [keyBmChunk(0)]: '{"categories":[],',
    })
    const r = await pullBookmarksForce()
    expect(r.payload).toBeUndefined()
    expect(r.error).toBeUndefined()
  })

  it('JSON 无法解析 → 返回 {}', async () => {
    await enable()
    await chrome.storage.sync.set({
      [KEY_BM_MANIFEST]: { version: 1, ts: 1, chunkCount: 1, totalBytes: 5 },
      [keyBmChunk(0)]: 'not-json!!!',
    })
    const r = await pullBookmarksForce()
    expect(r.payload).toBeUndefined()
  })

  it('远端无数据 → 返回 {}', async () => {
    await enable()
    const r = await pullBookmarksForce()
    expect(r.payload).toBeUndefined()
    expect(r.error).toBeUndefined()
  })
})

// ─── handleBookmarksRemoteChange: 自回声防抖 ──────────

describe('handleBookmarksRemoteChange: 自回声防抖', () => {
  it('manifest.ts <= lastPushTs → 忽略', async () => {
    await enable()
    await setMeta({ bookmarks: { lastPushTs: 1000 } })
    const r = await handleBookmarksRemoteChange({
      version: 1,
      ts: 1000,
      chunkCount: 1,
      totalBytes: 10,
    })
    expect(r.payload).toBeUndefined()
  })

  it('manifest 比双 ts 都新 → 拉取并应用', async () => {
    await enable()
    // 先 push 模拟"远端有新数据"
    await pushBookmarks([mkCat('a')], [mkCard('1')])
    // 然后清掉本机 push 痕迹，把 lastPushTs 推回过去模拟「别的设备改的」
    await setMeta({ bookmarks: { lastPushTs: 1, lastPullTs: 1 } })

    const sync = await chrome.storage.sync.get(KEY_BM_MANIFEST)
    const mf = sync[KEY_BM_MANIFEST] as { ts: number; chunkCount: number; totalBytes: number; version: number }
    const r = await handleBookmarksRemoteChange(mf)
    expect(r.payload?.categories.map((c) => c.id)).toEqual(['a'])
    expect(r.ts).toBe(mf.ts)

    const meta = await getMeta()
    expect(meta.bookmarks.lastPullTs).toBe(mf.ts)
  })

  it('null manifest → 忽略', async () => {
    const r = await handleBookmarksRemoteChange(null)
    expect(r.payload).toBeUndefined()
  })
})

// ─── enableSync / disableSync / wipeRemote ────────────

describe('enableSync / disableSync / wipeRemote', () => {
  it('enableSync 把 settings + bookmarks 推到云端', async () => {
    const r = await enableSync(
      mkSettings({ theme: 'dark' }),
      [mkCat('a')],
      [mkCard('1')],
    )
    expect(r.ok).toBe(true)

    const sync = await chrome.storage.sync.get(null)
    expect(sync[KEY_SETTINGS_PAYLOAD]).toBeTruthy()
    expect(sync[KEY_BM_MANIFEST]).toBeTruthy()
    expect(sync[keyBmChunk(0)]).toBeTruthy()

    const meta = await getMeta()
    expect(meta.enabled).toBe(true)
  })

  it('enableSync 时书签超限 → 偏好已推、enabled 保持 true、有 quotaHint', async () => {
    const huge = Array.from({ length: 200 }, (_, i) =>
      mkCard(`big-${i}`, { description: 'X'.repeat(1024) }),
    )
    const r = await enableSync(mkSettings(), [mkCat('a')], huge)
    expect(r.ok).toBe(false)
    expect(r.quotaHint).toBeTruthy()

    // 偏好已经推上去了
    const sync = await chrome.storage.sync.get(KEY_SETTINGS_PAYLOAD)
    expect(sync[KEY_SETTINGS_PAYLOAD]).toBeTruthy()

    // enabled 保持 true（让用户继续看错误自行清理）
    const meta = await getMeta()
    expect(meta.enabled).toBe(true)
  })

  it('disableSync 把 meta.enabled 置 false', async () => {
    await enable()
    await disableSync()
    const meta = await getMeta()
    expect(meta.enabled).toBe(false)
  })

  it('wipeRemote 删掉 settings + bookmarks 全部 key', async () => {
    await enable()
    await pushSettings(mkSettings())
    await pushBookmarks([mkCat('a')], [mkCard('1')])

    await wipeRemote()

    const sync = await chrome.storage.sync.get(null)
    expect(sync[KEY_SETTINGS_PAYLOAD]).toBeUndefined()
    expect(sync[KEY_BM_MANIFEST]).toBeUndefined()
    expect(sync[keyBmChunk(0)]).toBeUndefined()

    const meta = await getMeta()
    expect(meta.settings.lastPushTs).toBeUndefined()
    expect(meta.bookmarks.lastPushTs).toBeUndefined()
  })
})

// ─── bootstrapSync ───────────────────────────────────

describe('bootstrapSync', () => {
  it('未启用 → 直接 noop', async () => {
    const r = await bootstrapSync(mkSettings(), [], [])
    expect(r.appliedSettings).toBeUndefined()
    expect(r.appliedBookmarks).toBeUndefined()
  })

  it('远端为空 → 推本机', async () => {
    await enable()
    await bootstrapSync(mkSettings({ theme: 'dark' }), [mkCat('a')], [mkCard('1')])
    const sync = await chrome.storage.sync.get(null)
    expect(sync[KEY_SETTINGS_PAYLOAD]).toBeTruthy()
    expect(sync[KEY_BM_MANIFEST]).toBeTruthy()
  })

  it('远端较新 → 应用远端（不推本机）', async () => {
    await enable()
    // 写一份"较新"的远端 payload
    const futureTs = Date.now() + 100_000
    await chrome.storage.sync.set({
      [KEY_SETTINGS_PAYLOAD]: {
        version: 1,
        ts: futureTs,
        settings: { theme: 'dark' },
      },
    })
    // 本地 lastPushTs 假装很早
    await setMeta({ settings: { lastPushTs: 1 } })

    const r = await bootstrapSync(mkSettings({ theme: 'light' }), [], [])
    expect(r.appliedSettings?.theme).toBe('dark')

    // 不应覆盖远端的较新 payload
    const sync = await chrome.storage.sync.get(KEY_SETTINGS_PAYLOAD)
    expect((sync[KEY_SETTINGS_PAYLOAD] as { ts: number }).ts).toBe(futureTs)
  })
})

// ─── 工具：估算字节 ───────────────────────────────────

describe('estimateBookmarksBytes', () => {
  it('返回 JSON 序列化字节数（用于 UI 容量条）', () => {
    const n = estimateBookmarksBytes([mkCat('a')], [mkCard('1')])
    expect(n).toBeGreaterThan(0)
    // 加数据，字节数必须单调上升
    const n2 = estimateBookmarksBytes(
      [mkCat('a')],
      [mkCard('1'), mkCard('2')],
    )
    expect(n2).toBeGreaterThan(n)
  })
})

// ─── meta CRUD ────────────────────────────────────────

describe('getMeta / setMeta', () => {
  it('未写过时返回默认 meta', async () => {
    const m = await getMeta()
    expect(m.enabled).toBe(false)
    expect(m.settings).toEqual({})
    expect(m.bookmarks).toEqual({})
  })

  it('setMeta 合并 settings / bookmarks（不互相覆盖）', async () => {
    await setMeta({ settings: { lastPushTs: 1 } })
    await setMeta({ bookmarks: { lastPushTs: 2 } })
    const m = await getMeta()
    expect(m.settings.lastPushTs).toBe(1)
    expect(m.bookmarks.lastPushTs).toBe(2)
  })

  it('clearError=true 清掉 lastError', async () => {
    await setMeta({ lastError: 'something broke' })
    expect((await getMeta()).lastError).toBe('something broke')
    await setMeta({ clearError: true })
    expect((await getMeta()).lastError).toBeUndefined()
  })

  it('数据落到本地 KEY_LOCAL_META 而非 sync', async () => {
    await setMeta({ enabled: true })
    const local = await chrome.storage.local.get(KEY_LOCAL_META)
    expect(local[KEY_LOCAL_META]).toBeTruthy()
    const sync = await chrome.storage.sync.get(KEY_LOCAL_META)
    expect(sync[KEY_LOCAL_META]).toBeUndefined()
  })
})
