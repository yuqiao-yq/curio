import { browser } from 'wxt/browser'
import { withStorageLock } from './storageLock'
import { acknowledgeBookmarkSync, PendingBookmarkChangesError } from './bookmarkSyncState'
import { getRepository } from '../repositories'
import type { BookmarkCard, Category, UserSettings } from '../types/bookmark'

/* ─────────────────────────────────────────────────────────────
 * V1.5：跨设备同步（chrome.storage.sync）
 *
 * 覆盖两条管线：
 *   1) 偏好（settings 子集，白名单） — 1 个 sync item，体积 < 1KB
 *   2) 书签数据（categories + cards）  — 分块写入多个 sync item
 *
 * chrome.storage.sync 硬性配额（Chromium / Edge）：
 *   QUOTA_BYTES_PER_ITEM = 8KB
 *   QUOTA_BYTES (total)  = 100KB
 *   MAX_ITEMS            = 512
 *   MAX_WRITE_OPERATIONS_PER_MINUTE = 120
 *
 * 策略：
 *   - 整包 LWW（按用户选型）：书签 payload 整体序列化 / 整体覆盖
 *   - 分块：序列化字符串按 CHUNK_BYTES 切片，写入 KEY_BM_CHUNK(i)，
 *     再加一个 KEY_BM_MANIFEST 记录 ts + chunkCount + totalBytes
 *   - 所有 chunk + manifest 用一次 storage.sync.set 提交；远端可能分批到达，
 *     读取完整版本并验证校验值后再应用
 *   - 超限保护：写之前先估算字节数，超 100KB 直接拒绝并清晰报错
 *   - 自回声防抖：每条管线各自的 lastPushTs/lastPullTs 守门
 *
 * 仍按整包传输；本地待同步且已看到远端新版本时暂停自动覆盖。
 * 跨设备没有共享锁，远端可延迟到达；此保护不等于逐条冲突合并。
 * ───────────────────────────────────────────────────────────── */

// ─── 常量 ─────────────────────────────────────────────────

/** 偏好 payload key */
export const KEY_SETTINGS_PAYLOAD = 'curio:sync:settings'
/** 书签 manifest key（包含 ts / chunkCount / totalBytes） */
export const KEY_BM_MANIFEST = 'curio:sync:bookmarks:meta'
/** 书签 chunk key 前缀 */
export const KEY_BM_CHUNK_PREFIX = 'curio:sync:bookmarks:c'
export const keyBmChunk = (i: number): string => `${KEY_BM_CHUNK_PREFIX}${i}`

/** 本机同步元数据 key（统一存放 enabled / 各管线状态） */
export const KEY_LOCAL_META = 'curio:sync:meta'

export const PAYLOAD_VERSION = 1

// 单 chunk 字节预算：留 1KB 缓冲给 JSON 字符串引号 + key 本身的开销
const CHUNK_BYTES = 7_000
// 总配额（chrome.storage.sync.QUOTA_BYTES = 102400），留 ~2KB 给 settings + manifest
const QUOTA_BYTES_TOTAL = 100_000
// 最大 chunk 数：避免单次写入太多 key 触发 MAX_ITEMS 或异常
const MAX_CHUNKS = 16

/**
 * 白名单：哪些 UserSettings 字段会被同步。
 * 排除：wallpaper（体积大）、sidebarWidth（屏宽相关）、
 * browserSync*（账号/书签栏 id 不同）、syncProvider（设备选择）
 */
export const SYNCABLE_SETTINGS_KEYS = [
  'theme',
  'layout',
  'language',
  'cardSize',
  'cardIconSize',
  'cardGlass',
  'cardWidthMode',
  'cardWidthMin',
  'cardWidthMax',
  'cardWidthFixed',
  'cardCustomWidthMin',
  'cardCustomWidthMax',
  'cardCustomHeightMin',
  'cardCustomHeightMax',
  'fontColor',
  'backgroundBlur',
  'subSectionDefaultExpanded',
  'recentIncludeBrowserHistory',
] as const satisfies ReadonlyArray<keyof UserSettings>

export type SyncableKey = (typeof SYNCABLE_SETTINGS_KEYS)[number]
export type SyncableSettings = Pick<UserSettings, SyncableKey>

// ─── payload 类型 ─────────────────────────────────────────

export interface SettingsPayload {
  version: number
  ts: number
  settings: Partial<SyncableSettings>
}

export interface BookmarksManifest {
  version: number
  ts: number
  /** 分块数；reader 据此读取 chunk 0..N-1 后拼接 */
  chunkCount: number
  /** 序列化后字节数；用于 UI 显示容量占比 */
  totalBytes: number
  /** 检测分块到达顺序导致的混合版本；兼容未带校验值的旧客户端。 */
  checksum?: string
}

export interface BookmarksPayload {
  categories: Category[]
  cards: BookmarkCard[]
}

// ─── meta 类型 ─────────────────────────────────────────────

export interface SyncSubMeta {
  lastPushTs?: number
  lastPullTs?: number
  /** 仅书签子状态用到：上次成功写入的序列化字节数 */
  lastSizeBytes?: number
}

export interface SyncMeta {
  /** 同步总开关（settings + bookmarks 共用） */
  enabled: boolean
  settings: SyncSubMeta
  bookmarks: SyncSubMeta
  /** 最近一次任意管线的错误描述（UI 用） */
  lastError?: string
}

const DEFAULT_META: SyncMeta = {
  enabled: false,
  settings: {},
  bookmarks: {},
}

// ─── meta 读写（本地） ──────────────────────────────────────

export async function getMeta(): Promise<SyncMeta> {
  try {
    const r = await browser.storage.local.get(KEY_LOCAL_META)
    const raw = (r[KEY_LOCAL_META] ?? {}) as Partial<SyncMeta>
    return {
      ...DEFAULT_META,
      ...raw,
      settings: { ...DEFAULT_META.settings, ...(raw.settings ?? {}) },
      bookmarks: { ...DEFAULT_META.bookmarks, ...(raw.bookmarks ?? {}) },
    }
  } catch {
    return { ...DEFAULT_META }
  }
}

type MetaPatch = Partial<Omit<SyncMeta, 'settings' | 'bookmarks'>> & {
  settings?: Partial<SyncSubMeta>
  bookmarks?: Partial<SyncSubMeta>
  /** 显式传 null 用于清空 lastError */
  clearError?: boolean
}

export async function setMeta(patch: MetaPatch): Promise<SyncMeta> {
  return withStorageLock('sync-meta', async () => {
    const prev = await getMeta()
    const next: SyncMeta = {
      ...prev,
      ...('enabled' in patch ? { enabled: patch.enabled ?? prev.enabled } : {}),
      settings: { ...prev.settings, ...(patch.settings ?? {}) },
      bookmarks: { ...prev.bookmarks, ...(patch.bookmarks ?? {}) },
    }
    if (patch.clearError) delete next.lastError
    else if (patch.lastError !== undefined) next.lastError = patch.lastError
    await browser.storage.local.set({ [KEY_LOCAL_META]: next })
    return next
  })
}

// ─── 通用 ─────────────────────────────────────────────────

export function hasSyncStorage(): boolean {
  try {
    return !!(browser?.storage as { sync?: unknown } | undefined)?.sync
  } catch {
    return false
  }
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

// ============================================================
// 偏好同步（settings）
// ============================================================

/** 从 UserSettings 中拣出白名单字段，skip undefined */
export function pickSyncable(settings: UserSettings): Partial<SyncableSettings> {
  const out: Partial<SyncableSettings> = {}
  for (const k of SYNCABLE_SETTINGS_KEYS) {
    const v = settings[k]
    if (v !== undefined) {
      // @ts-expect-error: index union
      out[k] = v
    }
  }
  return out
}

/** 仅当 a / b 中某个可同步字段有变化才返回 true */
export function syncableChanged(a: UserSettings, b: UserSettings): boolean {
  for (const k of SYNCABLE_SETTINGS_KEYS) {
    if (a[k] !== b[k]) return true
  }
  return false
}

async function readSettingsRemote(): Promise<SettingsPayload | null> {
  if (!hasSyncStorage()) return null
  const r = await browser.storage.sync.get(KEY_SETTINGS_PAYLOAD)
  const raw = r[KEY_SETTINGS_PAYLOAD] as SettingsPayload | undefined
  if (!raw || typeof raw !== 'object' || typeof raw.ts !== 'number') return null
  return raw
}

function sanitizeSettings(raw: Partial<SyncableSettings> | undefined): Partial<SyncableSettings> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Partial<SyncableSettings> = {}
  for (const k of SYNCABLE_SETTINGS_KEYS) {
    if (k in raw) {
      const v = (raw as Record<string, unknown>)[k]
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        // @ts-expect-error: index union
        out[k] = v
      }
    }
  }
  // v0.22.x large → custom 迁移兜底：远端可能仍然是「旧版客户端」推上来的 cardSize: 'large'，
  // 接到本地之前先映射成 custom，并落与 LocalRepository.getSettings 一致的视觉默认 W/H，
  // 避免被 'large' 字面量短路到 type union 之外引发渲染兜底（CARD_SIZE_STYLES.standard）。
  if ((out as { cardSize?: string }).cardSize === 'large') {
    ;(out as { cardSize?: string }).cardSize = 'custom'
    if (out.cardCustomWidthMin == null) out.cardCustomWidthMin = 192
    if (out.cardCustomWidthMax == null) out.cardCustomWidthMax = 192
    if (out.cardCustomHeightMin == null) out.cardCustomHeightMin = 128
    if (out.cardCustomHeightMax == null) out.cardCustomHeightMax = 128
  }
  return out
}

export async function pushSettings(current: UserSettings): Promise<{
  ok: boolean
  ts?: number
  error?: string
}> {
  return withStorageLock('sync-bookmarks', async () => {
    const m = await getMeta()
    if (!m.enabled || !hasSyncStorage()) return { ok: false, error: 'sync 未启用' }
    try {
      const ts = Math.max(
        Date.now(),
        (m.settings.lastPushTs ?? 0) + 1,
        (m.settings.lastPullTs ?? 0) + 1,
      )
      const payload: SettingsPayload = {
        version: PAYLOAD_VERSION,
        ts,
        settings: pickSyncable(current),
      }
      await browser.storage.sync.set({ [KEY_SETTINGS_PAYLOAD]: payload })
      await setMeta({ settings: { lastPushTs: ts }, clearError: true })
      return { ok: true, ts }
    } catch (err) {
      const error = errMsg(err)
      await setMeta({ lastError: `偏好推送失败：${error}` })
      return { ok: false, error }
    }
  })
}

export async function pullSettingsForce(): Promise<{
  applied?: Partial<SyncableSettings>
  ts?: number
  error?: string
}> {
  if (!hasSyncStorage()) return { error: '当前浏览器不支持 storage.sync' }
  try {
    const remote = await readSettingsRemote()
    if (!remote) return {}
    await setMeta({ settings: { lastPullTs: remote.ts }, clearError: true })
    return { applied: sanitizeSettings(remote.settings), ts: remote.ts }
  } catch (err) {
    const error = errMsg(err)
    await setMeta({ lastError: `偏好拉取失败：${error}` })
    return { error }
  }
}

/**
 * onChanged 触发时（settings payload 变更）处理远端到本机。
 * - 自回声：payload.ts <= meta.settings.lastPushTs → 忽略
 * - 重复应用：payload.ts <= meta.settings.lastPullTs → 忽略
 */
export async function handleSettingsRemoteChange(
  payload: SettingsPayload | null,
): Promise<{ applied?: Partial<SyncableSettings>; ts?: number }> {
  return withStorageLock('sync-bookmarks', async () => {
    if (!payload) return {}
    const m = await getMeta()
    if (!m.enabled) return {}
    if (m.settings.lastPushTs && payload.ts <= m.settings.lastPushTs) return {}
    if (m.settings.lastPullTs && payload.ts <= m.settings.lastPullTs) return {}
    await setMeta({ settings: { lastPullTs: payload.ts }, clearError: true })
    return { applied: sanitizeSettings(payload.settings), ts: payload.ts }
  })
}

// ============================================================
// 书签同步（categories + cards）
// ============================================================

function payloadChecksum(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(16)
}

const encoder = new TextEncoder()
function utf8Bytes(text: string): number {
  return encoder.encode(text).byteLength
}

/** 按 JSON 二次编码后的字节分块；for...of 不切断 emoji 代理对。 */
function chunkString(s: string): string[] {
  const chunks: string[] = []
  let chunk = ''
  let bytes = 2 // 字符串外围引号
  for (const char of s) {
    const size = utf8Bytes(JSON.stringify(char)) - 2
    if (bytes + size > CHUNK_BYTES && chunk) {
      chunks.push(chunk)
      chunk = ''
      bytes = 2
    }
    chunk += char
    bytes += size
  }
  if (chunk || !chunks.length) chunks.push(chunk)
  return chunks
}

function estimateItemBytes(key: string, value: unknown): number {
  return utf8Bytes(key) + utf8Bytes(JSON.stringify(value) ?? '')
}

export interface PushBookmarksResult {
  ok: boolean
  ts?: number
  bytes?: number
  chunks?: number
  error?: string
  /** 超过配额时的提示文本（UI 直接展示） */
  quotaHint?: string
  conflict?: boolean
}

/**
 * 底层整包写入接口，不确认本地待同步状态。UI 和自动调度使用 pushLocalBookmarks。
 * - 自动分块；超过 100KB 总配额直接拒绝
 * - 用一次 storage.sync.set 提交所有 chunk + manifest；远端可能分批到达
 */
export async function pushBookmarks(
  categories: Category[],
  cards: BookmarkCard[],
): Promise<PushBookmarksResult> {
  return withStorageLock('sync-bookmarks', () => writeBookmarks(categories, cards))
}

/** 调用方必须持有 sync-bookmarks 锁。 */
async function writeBookmarks(
  categories: Category[],
  cards: BookmarkCard[],
): Promise<PushBookmarksResult> {
  const m = await getMeta()
  if (!m.enabled || !hasSyncStorage()) {
    return { ok: false, error: 'sync 未启用' }
  }

  const ts = Math.max(
    Date.now(),
    (m.bookmarks.lastPushTs ?? 0) + 1,
    (m.bookmarks.lastPullTs ?? 0) + 1,
  )
  const payload: BookmarksPayload = { categories, cards }
  const serialized = JSON.stringify(payload)
  const totalBytes = utf8Bytes(serialized)

  // 配额预检：总字节超 100KB 直接报错，提供可读的容量说明。
  if (totalBytes > QUOTA_BYTES_TOTAL) {
    const overKb = ((totalBytes - QUOTA_BYTES_TOTAL) / 1024).toFixed(1)
    const quotaHint =
      `书签数据 ${(totalBytes / 1024).toFixed(1)} KB，超出 chrome.storage.sync 100KB ` +
      `上限约 ${overKb} KB。请清理无用书签 / 关闭同步、或等待 V2.0 云盘方案。`
    await setMeta({ lastError: quotaHint })
    return { ok: false, error: '超出云端配额', quotaHint, bytes: totalBytes }
  }

  const chunks = chunkString(serialized)
  if (chunks.length > MAX_CHUNKS) {
    const quotaHint = `分块数 ${chunks.length} 超过安全上限 ${MAX_CHUNKS}，请精简书签。`
    await setMeta({ lastError: quotaHint })
    return { ok: false, error: '分块过多', quotaHint, bytes: totalBytes }
  }

  const manifest: BookmarksManifest = {
    version: PAYLOAD_VERSION,
    ts,
    chunkCount: chunks.length,
    totalBytes,
    checksum: payloadChecksum(serialized),
  }

  // 构造一次性 set 的对象：manifest + chunks
  const writeObj: Record<string, unknown> = {
    [KEY_BM_MANIFEST]: manifest,
  }
  chunks.forEach((c, i) => {
    writeObj[keyBmChunk(i)] = c
  })

  // 二次校验：所有 item 单个都不能超 8KB（理论上 chunk 已按 7KB 切了）
  for (const [k, v] of Object.entries(writeObj)) {
    if (estimateItemBytes(k, v) > 8 * 1024) {
      const quotaHint = `内部错误：item ${k} 超 8KB 单项限制`
      await setMeta({ lastError: quotaHint })
      return { ok: false, error: quotaHint, quotaHint, bytes: totalBytes }
    }
  }

  try {
    const existing = await browser.storage.sync.get(null)
    const projected = { ...existing, ...writeObj }
    const storedBytes = Object.entries(projected).reduce(
      (n, [k, v]) => n + estimateItemBytes(k, v),
      0,
    )
    if (storedBytes > 102400) {
      const quotaHint =
        '写入后的同步数据（含偏好、分块和旧版本）超过 100KB，请先导出备份并精简数据。'
      await setMeta({ lastError: quotaHint })
      return { ok: false, error: '超出云端配额', quotaHint, bytes: storedBytes }
    }
    await browser.storage.sync.set(writeObj)
    // 清理上一次留下、本次用不到的 chunk（避免历史 chunk 残留浪费配额）
    await pruneStaleChunks(chunks.length)
    await setMeta({
      bookmarks: { lastPushTs: ts, lastSizeBytes: totalBytes },
      clearError: true,
    })
    return { ok: true, ts, bytes: totalBytes, chunks: chunks.length }
  } catch (err) {
    const error = errMsg(err)
    await setMeta({ lastError: `书签推送失败：${error}` })
    return { ok: false, error, bytes: totalBytes }
  }
}

/** 自动推送使用持久化版本；手动推送才可显式选择覆盖冲突。 */
export async function pushLocalBookmarks(
  options: { force?: boolean; shouldContinue?: () => boolean } = {},
): Promise<PushBookmarksResult> {
  return withStorageLock('sync-bookmarks', async () => {
    try {
      const meta = await getMeta()
      if (!meta.enabled || !hasSyncStorage()) return { ok: false, error: 'sync 未启用' }
      const snapshot = await getRepository().getSyncSnapshot()
      const remote = options.force ? null : await readBookmarksRemote()
      if (options.shouldContinue && !options.shouldContinue())
        return { ok: false, error: '已取消同步' }
      if (!options.force) {
        if (!snapshot.state?.pending && remote) return { ok: true }
        const knownTs = Math.max(meta.bookmarks.lastPushTs ?? 0, meta.bookmarks.lastPullTs ?? 0)
        if (snapshot.state?.pending && remote && remote.manifest.ts > knownTs) {
          throw new PendingBookmarkChangesError()
        }
      }
      const result = await writeBookmarks(snapshot.data.categories, snapshot.data.cards)
      if (result.ok) await acknowledgeBookmarkSync(snapshot.state?.revision)
      return result
    } catch (err) {
      const error = errMsg(err)
      await setMeta({ lastError: error })
      return { ok: false, error, conflict: err instanceof PendingBookmarkChangesError }
    }
  })
}

/** 落盘后才确认接收版本；与本机推送共用锁，避免本机写入事件被当作远端更新。 */
export async function commitReceivedBookmarks(
  payload: BookmarksPayload,
  ts: number,
  force = false,
): Promise<boolean> {
  return withStorageLock('sync-bookmarks', async () => {
    const meta = await getMeta()
    if (
      !force &&
      (!meta.enabled ||
        ts <= Math.max(meta.bookmarks.lastPushTs ?? 0, meta.bookmarks.lastPullTs ?? 0))
    )
      return false
    try {
      await getRepository().bulkImport(
        { version: 'sync', exportedAt: Date.now(), ...payload },
        'replace',
        { fromSync: true, discardPending: force },
      )
      await setMeta({
        bookmarks: {
          lastPullTs: ts,
          lastSizeBytes: estimateBookmarksBytes(payload.categories, payload.cards),
        },
        clearError: true,
      })
      return true
    } catch (err) {
      await setMeta({ lastError: errMsg(err) })
      throw err
    }
  })
}

/**
 * 删除编号 >= keepCount 的旧 chunk。
 * 上一次写了 8 个 chunk、本次只写 5 个 → chunk 5/6/7 是脏数据，得清掉。
 */
async function pruneStaleChunks(keepCount: number): Promise<void> {
  try {
    const all = (await browser.storage.sync.get(null)) as Record<string, unknown>
    const stale: string[] = []
    for (const k of Object.keys(all)) {
      if (!k.startsWith(KEY_BM_CHUNK_PREFIX)) continue
      const idxStr = k.slice(KEY_BM_CHUNK_PREFIX.length)
      const idx = Number.parseInt(idxStr, 10)
      if (Number.isFinite(idx) && idx >= keepCount) stale.push(k)
    }
    if (stale.length > 0) await browser.storage.sync.remove(stale)
  } catch {
    // 清理失败不致命；下次成功推送时还会再尝试
  }
}

export async function readBookmarksRemote(): Promise<{
  manifest: BookmarksManifest
  payload: BookmarksPayload
} | null> {
  if (!hasSyncStorage()) return null
  const mfRes = await browser.storage.sync.get(null)
  const manifest = mfRes[KEY_BM_MANIFEST] as BookmarksManifest | undefined
  if (!manifest) return null
  if (
    typeof manifest.ts !== 'number' ||
    !Number.isInteger(manifest.chunkCount) ||
    manifest.chunkCount < 1 ||
    manifest.chunkCount > MAX_CHUNKS
  ) {
    throw new Error('云端书签版本信息无效，已保留本地数据')
  }
  const keys = Array.from({ length: manifest.chunkCount }, (_, i) => keyBmChunk(i))
  if (keys.length === 0) return null
  const chunksRes = mfRes as Record<string, string | undefined>
  let concat = ''
  for (let i = 0; i < manifest.chunkCount; i++) {
    const c = chunksRes[keyBmChunk(i)]
    if (typeof c !== 'string') {
      throw new Error('云端书签尚未完整到达，请稍后重试；本地数据已保留')
    }
    concat += c
  }
  try {
    if (manifest.checksum && manifest.checksum !== payloadChecksum(concat)) {
      throw new Error('云端分块版本不一致')
    }
    const payload = JSON.parse(concat) as BookmarksPayload
    if (!Array.isArray(payload.categories) || !Array.isArray(payload.cards)) {
      throw new Error('云端书签格式无效')
    }
    return { manifest, payload }
  } catch {
    throw new Error('云端书签格式无效，已保留本地数据')
  }
}

export interface PullBookmarksResult {
  payload?: BookmarksPayload
  ts?: number
  bytes?: number
  error?: string
}

export async function pullBookmarksForce(): Promise<PullBookmarksResult> {
  if (!hasSyncStorage()) return { error: '当前浏览器不支持 storage.sync' }
  try {
    const r = await readBookmarksRemote()
    if (!r) return {}
    return { payload: r.payload, ts: r.manifest.ts, bytes: r.manifest.totalBytes }
  } catch (err) {
    const error = errMsg(err)
    await setMeta({ lastError: `书签拉取失败：${error}` })
    return { error }
  }
}

/**
 * manifest 或 chunk 变化后，由调用方传入最新 manifest。
 * 重新读取完整 payload 并验证校验值，避免应用尚未到齐的分片。
 */
export async function handleBookmarksRemoteChange(
  manifest: BookmarksManifest | null,
): Promise<{ payload?: BookmarksPayload; ts?: number }> {
  return withStorageLock('sync-bookmarks', async () => {
    if (!manifest || typeof manifest.ts !== 'number') return {}
    const m = await getMeta()
    if (!m.enabled) return {}
    const knownTs = Math.max(m.bookmarks.lastPushTs ?? 0, m.bookmarks.lastPullTs ?? 0)
    if (manifest.ts <= knownTs) return {}
    const r = await readBookmarksRemote()
    if (!r || r.manifest.ts <= knownTs) return {}
    return { payload: r.payload, ts: r.manifest.ts }
  })
}

// ============================================================
// 启停 / 清理 / bootstrap
// ============================================================

/**
 * 启用同步：先合并已有远端书签，再推送本机偏好和合并后的书签。
 * - 偏好推送失败关闭同步；书签推送失败保留开关并提示错误，供后续重试
 * - 在 chrome.storage.sync 不可用时直接报错
 */
export async function enableSync(
  current: UserSettings,
  categories: Category[],
  cards: BookmarkCard[],
): Promise<{ ok: boolean; error?: string; quotaHint?: string }> {
  if (!hasSyncStorage()) {
    const error = '当前浏览器不支持 storage.sync（Firefox 需登录账号）'
    await setMeta({ enabled: false, lastError: error })
    return { ok: false, error }
  }

  // 首次启用先读取已有远端并合并；空本地不能覆盖其它设备的书签。
  try {
    const repo = getRepository()
    await repo.bulkImport(
      { version: 'sync-enable', exportedAt: Date.now(), categories, cards },
      'merge',
    )
    const remote = await readBookmarksRemote()
    if (remote) {
      await repo.bulkImport(
        { version: 'sync-enable', exportedAt: Date.now(), ...remote.payload },
        'merge',
      )
      await setMeta({ bookmarks: { lastPullTs: remote.manifest.ts } })
    }
  } catch (err) {
    const error = `无法安全开启同步：${errMsg(err)}`
    await setMeta({ lastError: error })
    return { ok: false, error }
  }

  // 先把 enabled 打开，pushSettings/pushBookmarks 内部会检查 enabled
  await setMeta({ enabled: true, clearError: true })

  const ps = await pushSettings(current)
  if (!ps.ok) {
    await setMeta({ enabled: false })
    return { ok: false, error: ps.error }
  }

  const pb = await pushLocalBookmarks()
  if (!pb.ok) {
    // 偏好已推但书签超限 → 仍维持启用，让用户看到错误并自行清理；
    // 不要回滚 enabled，否则书签同步功能完全用不了
    return { ok: false, error: pb.error, quotaHint: pb.quotaHint }
  }

  return { ok: true }
}

export async function disableSync(): Promise<void> {
  await withStorageLock('sync-bookmarks', () => setMeta({ enabled: false, clearError: true }))
}

/**
 * 清空云端所有同步数据（settings payload + bookmarks chunks + manifest）。
 * 不删除本地或其它设备的书签；删除通知不应用为空库。
 */
export async function wipeRemote(): Promise<void> {
  await withStorageLock('sync-bookmarks', async () => {
    if (!hasSyncStorage()) return
    try {
      const all = (await browser.storage.sync.get(null)) as Record<string, unknown>
      const keys: string[] = []
      for (const k of Object.keys(all)) {
        if (k === KEY_SETTINGS_PAYLOAD) keys.push(k)
        else if (k === KEY_BM_MANIFEST) keys.push(k)
        else if (k.startsWith(KEY_BM_CHUNK_PREFIX)) keys.push(k)
      }
      if (keys.length > 0) await browser.storage.sync.remove(keys)
      await setMeta({
        settings: { lastPushTs: undefined, lastPullTs: undefined },
        bookmarks: { lastPushTs: undefined, lastPullTs: undefined, lastSizeBytes: undefined },
        clearError: true,
      })
    } catch (err) {
      await setMeta({ lastError: `清空云端失败：${errMsg(err)}` })
      throw err
    }
  })
}

export interface BootstrapResult {
  appliedSettings?: Partial<SyncableSettings>
  appliedBookmarks?: BookmarksPayload
  bookmarksTs?: number
  /** 引导期错误（不致命；caller 可 toast 提示） */
  warnings?: string[]
}

/**
 * 启动期一次性引导：取云端 + 本地，决定推 / 拉。
 *
 * 偏好：远端新 → 应用；远端无 → 推本机；本地新 → 推本机
 * 书签：远端新 → 应用整包；远端无 → 推本机整包；本地新 → 推本机
 */
export async function bootstrapSync(current: UserSettings): Promise<BootstrapResult> {
  const m = await getMeta()
  if (!m.enabled || !hasSyncStorage()) return {}
  const result: BootstrapResult = { warnings: [] }

  // ─── settings ─────────────────────────────
  try {
    const remoteSettings = await readSettingsRemote()
    const localPush = m.settings.lastPushTs ?? 0
    if (!remoteSettings) {
      const r = await pushSettings(current)
      if (!r.ok) result.warnings?.push(`偏好推送失败：${r.error}`)
    } else if (remoteSettings.ts > localPush) {
      await setMeta({ settings: { lastPullTs: remoteSettings.ts } })
      result.appliedSettings = sanitizeSettings(remoteSettings.settings)
    } else if (localPush > remoteSettings.ts) {
      const r = await pushSettings(current)
      if (!r.ok) result.warnings?.push(`偏好推送失败：${r.error}`)
    }
  } catch (err) {
    result.warnings?.push(`偏好引导失败：${errMsg(err)}`)
  }

  // ─── bookmarks ────────────────────────────
  try {
    const remoteBm = await readBookmarksRemote()
    const snapshot = await getRepository().getSyncSnapshot()
    const localPush = m.bookmarks.lastPushTs ?? 0
    const knownTs = Math.max(localPush, m.bookmarks.lastPullTs ?? 0)
    if (snapshot.state?.pending || !remoteBm) {
      const r = await pushLocalBookmarks()
      if (!r.ok) result.warnings?.push(r.quotaHint ?? r.error ?? '书签推送失败')
    } else if (remoteBm.manifest.ts > knownTs) {
      result.appliedBookmarks = remoteBm.payload
      result.bookmarksTs = remoteBm.manifest.ts
    } else if (localPush > remoteBm.manifest.ts) {
      const r = await pushLocalBookmarks({ force: true })
      if (!r.ok) result.warnings?.push(r.quotaHint ?? `书签推送失败：${r.error}`)
    }
  } catch (err) {
    result.warnings?.push(`书签引导失败：${errMsg(err)}`)
  }

  if (result.warnings?.length) await setMeta({ lastError: result.warnings.join('；') })
  return result
}

// ============================================================
// 工具：配额提示
// ============================================================

/** 当前书签 payload 字节数估算（同步前预览用） */
export function estimateBookmarksBytes(categories: Category[], cards: BookmarkCard[]): number {
  return utf8Bytes(JSON.stringify({ categories, cards }))
}

export const SYNC_QUOTA = {
  total: QUOTA_BYTES_TOTAL,
  perItem: 8 * 1024,
  chunkBytes: CHUNK_BYTES,
  maxChunks: MAX_CHUNKS,
} as const
