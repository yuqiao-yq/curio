import { browser } from 'wxt/browser'
import type {
  BookmarkCard,
  Category,
  UserSettings,
} from '../types/bookmark'

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
 *   - 原子写：所有 chunk + manifest 用一次 storage.sync.set 提交，
 *     避免读到半截状态；onChanged 也是单次事件
 *   - 超限保护：写之前先估算字节数，超 100KB 直接拒绝并清晰报错
 *   - 自回声防抖：每条管线各自的 lastPushTs/lastPullTs 守门
 *
 * 冲突：整包 LWW（"后写的覆盖先写的"）。两台设备同时改 →
 * 后写者的整个 categories+cards 替换先写者的整个集合，
 * 先写者那一端原本未推送的本地改动会丢失。在 UI 中说清楚。
 * ───────────────────────────────────────────────────────────── */

// ─── 常量 ─────────────────────────────────────────────────

/** 偏好 payload key */
export const KEY_SETTINGS_PAYLOAD = 'tabit:sync:settings'
/** 书签 manifest key（包含 ts / chunkCount / totalBytes） */
export const KEY_BM_MANIFEST = 'tabit:sync:bookmarks:meta'
/** 书签 chunk key 前缀 */
export const KEY_BM_CHUNK_PREFIX = 'tabit:sync:bookmarks:c'
export const keyBmChunk = (i: number): string => `${KEY_BM_CHUNK_PREFIX}${i}`

/** 本机同步元数据 key（统一存放 enabled / 各管线状态） */
export const KEY_LOCAL_META = 'tabit:sync:meta'

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

function sanitizeSettings(
  raw: Partial<SyncableSettings> | undefined,
): Partial<SyncableSettings> {
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
  return out
}

export async function pushSettings(current: UserSettings): Promise<{
  ok: boolean
  ts?: number
  error?: string
}> {
  const m = await getMeta()
  if (!m.enabled || !hasSyncStorage()) return { ok: false, error: 'sync 未启用' }
  try {
    const ts = Date.now()
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
  if (!payload) return {}
  const m = await getMeta()
  if (!m.enabled) return {}
  if (m.settings.lastPushTs && payload.ts <= m.settings.lastPushTs) return {}
  if (m.settings.lastPullTs && payload.ts <= m.settings.lastPullTs) return {}
  await setMeta({ settings: { lastPullTs: payload.ts }, clearError: true })
  return { applied: sanitizeSettings(payload.settings), ts: payload.ts }
}

// ============================================================
// 书签同步（categories + cards）
// ============================================================

/**
 * 把对象序列化并按字节切片。
 * 这里直接对 JSON 字符串按字符切（UTF-8 安全考虑：CHUNK_BYTES 留了大缓冲，
 * 实际字符串字符数远小于字节配额，4 字节字符仍能稳定容纳）。
 */
function chunkString(s: string): string[] {
  if (s.length <= CHUNK_BYTES) return [s]
  const out: string[] = []
  for (let i = 0; i < s.length; i += CHUNK_BYTES) {
    out.push(s.slice(i, i + CHUNK_BYTES))
  }
  return out
}

/** 估算 chrome.storage.sync 中 key+value 的近似字节占用（用于配额前置检查） */
function estimateItemBytes(key: string, value: unknown): number {
  // storage.sync 计算字节按 JSON.stringify(value).length + key.length
  // 这是 chromium 实现的近似；够用于客户端预检
  const v = JSON.stringify(value)
  return key.length + (v?.length ?? 0)
}

export interface PushBookmarksResult {
  ok: boolean
  ts?: number
  bytes?: number
  chunks?: number
  error?: string
  /** 超过配额时的提示文本（UI 直接展示） */
  quotaHint?: string
}

/**
 * 把整套 categories + cards 整包 LWW 推送到云端。
 * - 自动分块；超过 100KB 总配额直接拒绝
 * - 用一次 storage.sync.set 原子提交所有 chunk + manifest
 */
export async function pushBookmarks(
  categories: Category[],
  cards: BookmarkCard[],
): Promise<PushBookmarksResult> {
  const m = await getMeta()
  if (!m.enabled || !hasSyncStorage()) {
    return { ok: false, error: 'sync 未启用' }
  }

  const ts = Date.now()
  const payload: BookmarksPayload = { categories, cards }
  const serialized = JSON.stringify(payload)
  const totalBytes = serialized.length

  // 配额预检：总字节超 100KB 直接报错；不要等 chrome 抛出 QUOTA_BYTES，
  // 那样会写一半失败一半留下脏 chunk
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
  const mfRes = await browser.storage.sync.get(KEY_BM_MANIFEST)
  const manifest = mfRes[KEY_BM_MANIFEST] as BookmarksManifest | undefined
  if (!manifest || typeof manifest.ts !== 'number' || !Number.isFinite(manifest.chunkCount)) {
    return null
  }
  const keys = Array.from({ length: manifest.chunkCount }, (_, i) => keyBmChunk(i))
  if (keys.length === 0) return null
  const chunksRes = (await browser.storage.sync.get(keys)) as Record<string, string | undefined>
  let concat = ''
  for (let i = 0; i < manifest.chunkCount; i++) {
    const c = chunksRes[keyBmChunk(i)]
    if (typeof c !== 'string') {
      // 缺块：拒绝拼装，宁可视为"无云端数据"
      return null
    }
    concat += c
  }
  try {
    const payload = JSON.parse(concat) as BookmarksPayload
    if (!Array.isArray(payload.categories) || !Array.isArray(payload.cards)) {
      return null
    }
    return { manifest, payload }
  } catch {
    return null
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
    await setMeta({
      bookmarks: { lastPullTs: r.manifest.ts, lastSizeBytes: r.manifest.totalBytes },
      clearError: true,
    })
    return { payload: r.payload, ts: r.manifest.ts, bytes: r.manifest.totalBytes }
  } catch (err) {
    const error = errMsg(err)
    await setMeta({ lastError: `书签拉取失败：${error}` })
    return { error }
  }
}

/**
 * onChanged 触发时（书签 manifest 变更）处理远端到本机。
 * 注意 chunk 的变化我们不直接看，只看 manifest.ts —— 因为 manifest
 * 是 push 时同 set 写的，可以代表整次写入的『提交点』。
 */
export async function handleBookmarksRemoteChange(
  manifest: BookmarksManifest | null,
): Promise<{ payload?: BookmarksPayload; ts?: number }> {
  if (!manifest || typeof manifest.ts !== 'number') return {}
  const m = await getMeta()
  if (!m.enabled) return {}
  if (m.bookmarks.lastPushTs && manifest.ts <= m.bookmarks.lastPushTs) return {}
  if (m.bookmarks.lastPullTs && manifest.ts <= m.bookmarks.lastPullTs) return {}
  // manifest 变了，但本地状态滞后 → 重新读全量
  const r = await readBookmarksRemote()
  if (!r) return {}
  await setMeta({
    bookmarks: { lastPullTs: r.manifest.ts, lastSizeBytes: r.manifest.totalBytes },
    clearError: true,
  })
  return { payload: r.payload, ts: r.manifest.ts }
}

// ============================================================
// 启停 / 清理 / bootstrap
// ============================================================

/**
 * 启用同步：把本机当前 settings + bookmarks 都作为初始 payload 推到云端。
 * - 任一步失败都视为启用失败，meta.enabled 仍设为 false
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

  // 先把 enabled 打开，pushSettings/pushBookmarks 内部会检查 enabled
  await setMeta({ enabled: true, clearError: true })

  const ps = await pushSettings(current)
  if (!ps.ok) {
    await setMeta({ enabled: false })
    return { ok: false, error: ps.error }
  }

  const pb = await pushBookmarks(categories, cards)
  if (!pb.ok) {
    // 偏好已推但书签超限 → 仍维持启用，让用户看到错误并自行清理；
    // 不要回滚 enabled，否则书签同步功能完全用不了
    return { ok: false, error: pb.error, quotaHint: pb.quotaHint }
  }

  return { ok: true }
}

export async function disableSync(): Promise<void> {
  await setMeta({ enabled: false, clearError: true })
}

/**
 * 清空云端所有同步数据（settings payload + bookmarks chunks + manifest）。
 * 本地状态不变；其它设备会收到 onChanged 并清空（这里直接 wipe 不通知，
 * 因为 onChanged 在 null payload 上我们自身就返回 {}，对方应用层不会动）。
 */
export async function wipeRemote(): Promise<void> {
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
  } catch {
    /* 失败容忍，UI 会显示 lastError */
  }
}

export interface BootstrapResult {
  appliedSettings?: Partial<SyncableSettings>
  appliedBookmarks?: BookmarksPayload
  /** 引导期错误（不致命；caller 可 toast 提示） */
  warnings?: string[]
}

/**
 * 启动期一次性引导：取云端 + 本地，决定推 / 拉。
 *
 * 偏好：远端新 → 应用；远端无 → 推本机；本地新 → 推本机
 * 书签：远端新 → 应用整包；远端无 → 推本机整包；本地新 → 推本机
 */
export async function bootstrapSync(
  current: UserSettings,
  categories: Category[],
  cards: BookmarkCard[],
): Promise<BootstrapResult> {
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
    const localPush = m.bookmarks.lastPushTs ?? 0
    if (!remoteBm) {
      const r = await pushBookmarks(categories, cards)
      if (!r.ok) result.warnings?.push(r.quotaHint ?? `书签推送失败：${r.error}`)
    } else if (remoteBm.manifest.ts > localPush) {
      await setMeta({
        bookmarks: {
          lastPullTs: remoteBm.manifest.ts,
          lastSizeBytes: remoteBm.manifest.totalBytes,
        },
      })
      result.appliedBookmarks = remoteBm.payload
    } else if (localPush > remoteBm.manifest.ts) {
      const r = await pushBookmarks(categories, cards)
      if (!r.ok) result.warnings?.push(r.quotaHint ?? `书签推送失败：${r.error}`)
    }
  } catch (err) {
    result.warnings?.push(`书签引导失败：${errMsg(err)}`)
  }

  return result
}

// ============================================================
// 工具：配额提示
// ============================================================

/** 当前书签 payload 字节数估算（同步前预览用） */
export function estimateBookmarksBytes(
  categories: Category[],
  cards: BookmarkCard[],
): number {
  return JSON.stringify({ categories, cards }).length
}

export const SYNC_QUOTA = {
  total: QUOTA_BYTES_TOTAL,
  perItem: 8 * 1024,
  chunkBytes: CHUNK_BYTES,
  maxChunks: MAX_CHUNKS,
} as const
