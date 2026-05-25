import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import type { UserSettings } from '../../types/bookmark'
import {
  cancelPendingSyncPush,
  useBookmarkStore,
} from '../../stores/useBookmarkStore'
import {
  disableSync,
  enableSync,
  estimateBookmarksBytes,
  getMeta,
  hasSyncStorage,
  KEY_LOCAL_META,
  pullBookmarksForce,
  pullSettingsForce,
  pushBookmarks,
  pushSettings,
  SYNC_QUOTA,
  SYNCABLE_SETTINGS_KEYS,
  wipeRemote,
  type SyncableSettings,
  type SyncMeta,
} from '../../services/SyncService'
import { toast } from '../../stores/useToastStore'
import { confirmDialog } from '../Dialog'
import { cn } from '../../utils/cn'

/* ─────────────────────────────────────────────────────────────
 * 跨设备同步（V1.5）UI 卡片：
 * 两条独立管线，都走 chrome.storage.sync：
 *   1) 偏好（settings 白名单）— 1 个 item, < 1KB
 *   2) 书签数据（categories + cards）— 分块（每块 ≤8KB）+ manifest
 *
 * 状态行：分两行展示 settings / bookmarks 各自的最近推送/拉取 + 容量占比
 * 操作按钮：立即推送（同时推两条）/ 从云端覆盖（同时拉两条）/ 清空云端
 *
 * 关键点：
 *   - chrome.storage.sync 总配额 100KB；超出 push 会拒写，并把 quotaHint
 *     冒泡到 meta.lastError + toast。一定要在 UI 把容量条画出来。
 *   - 「整包 LWW」：两端同时改 → 后写者覆盖先写者。已在文案明示。
 * ───────────────────────────────────────────────────────────── */

export function SyncSection({ settings }: { settings: UserSettings }) {
  const [meta, setMeta] = useState<SyncMeta>({
    enabled: false,
    settings: {},
    bookmarks: {},
  })
  const [loading, setLoading] = useState(false)
  const supported = hasSyncStorage()
  const applyRemoteSettings = useBookmarkStore((s) => s.applyRemoteSettings)
  const applyRemoteBookmarks = useBookmarkStore((s) => s.applyRemoteBookmarks)
  const categories = useBookmarkStore((s) => s.categories)
  const cards = useBookmarkStore((s) => s.cards)

  // 本地容量预估：实时反映用户在本机的占用，与 meta.bookmarks.lastSizeBytes
  // 一起在 UI 里给出双视角（"本机当前" vs "上次成功推送"）
  const localBytes = estimateBookmarksBytes(categories, cards)
  const remoteBytes = meta.bookmarks.lastSizeBytes ?? 0
  const usedBytes = Math.max(localBytes, remoteBytes)
  const usedPct = Math.min(100, (usedBytes / SYNC_QUOTA.total) * 100)
  const overQuota = usedBytes > SYNC_QUOTA.total

  // 启动时读取 + 监听 meta 变化（其他设备同步过来 / 推送完成都会改）
  useEffect(() => {
    let mounted = true
    void getMeta().then((m) => {
      if (mounted) setMeta(m)
    })
    const storageApi = browser?.storage as {
      onChanged?: {
        addListener: (cb: (...args: unknown[]) => void) => void
        removeListener: (cb: (...args: unknown[]) => void) => void
      }
    } | undefined
    if (!storageApi?.onChanged) return
    const listener = (
      changes: Record<string, { newValue?: unknown }>,
      areaName: string,
    ) => {
      if (areaName !== 'local') return
      const ch = changes[KEY_LOCAL_META]
      if (!ch) return
      const next = ch.newValue as SyncMeta | undefined
      if (next) setMeta((prev) => ({ ...prev, ...next }))
    }
    storageApi.onChanged.addListener(listener as never)
    return () => {
      mounted = false
      storageApi.onChanged?.removeListener(listener as never)
    }
  }, [])

  const handleToggle = async (enabled: boolean) => {
    if (loading) return
    setLoading(true)
    try {
      if (enabled) {
        const r = await enableSync(settings, categories, cards)
        if (!r.ok) {
          // 配额超限是软失败：enableSync 内部已保留 enabled=true，
          // 用户清理书签后下次自动推送仍可用
          toast.error(
            r.quotaHint ? '开启失败（书签超出云端配额）' : '开启失败',
            r.quotaHint ?? r.error ?? '未知错误',
          )
        } else {
          toast.success(
            '已开启跨设备同步',
            '本机的偏好与书签已上传作为初始版本',
          )
        }
      } else {
        await disableSync()
        toast.info('已关闭同步', '云端 payload 仍保留，可随时重新开启')
      }
      setMeta(await getMeta())
    } finally {
      setLoading(false)
    }
  }

  const handlePushNow = async () => {
    if (loading) return
    setLoading(true)
    try {
      const ps = await pushSettings(settings)
      const pb = await pushBookmarks(categories, cards)
      if (ps.ok && pb.ok) {
        toast.success(
          '已推送到云端',
          `偏好 + 书签（${formatBytes(pb.bytes ?? 0)}）已上传，其它设备稍后会自动拉取`,
        )
      } else if (!ps.ok && !pb.ok) {
        toast.error('推送失败', `${ps.error ?? ''} / ${pb.quotaHint ?? pb.error ?? ''}`)
      } else if (!pb.ok) {
        toast.error(
          pb.quotaHint ? '书签推送失败（超出云端配额）' : '书签推送失败',
          pb.quotaHint ?? pb.error ?? '未知错误',
        )
      } else {
        toast.error('偏好推送失败', ps.error ?? '未知错误')
      }
      setMeta(await getMeta())
    } finally {
      setLoading(false)
    }
  }

  const handlePullNow = async () => {
    if (loading) return
    if (
      !(await confirmDialog({
        title: '从云端覆盖本机？',
        message:
          '将用云端最新数据覆盖本机：\n' +
          '  · 可同步的偏好（主题 / 布局 / 卡片尺寸等）\n' +
          '  · 全部分类与书签（整包替换）\n\n' +
          '注意：壁纸、侧栏宽度等不参与同步。整包覆盖意味着本机近期未推送上去的书签会丢失。',
        danger: true,
      }))
    ) {
      return
    }
    setLoading(true)
    try {
      // 取消挂起的推送：避免拉取过程中 push timer 抢先把本地新值刷上云端，
      // 导致拉回的「云端=本地新值」让覆盖看似无效。
      cancelPendingSyncPush()
      const beforeSettings = useBookmarkStore.getState().settings
      const [rs, rb] = await Promise.all([
        pullSettingsForce(),
        pullBookmarksForce(),
      ])

      const lines: string[] = []
      let errored = false

      if (rs.error) {
        lines.push(`偏好：${rs.error}`)
        errored = true
      } else if (rs.applied && Object.keys(rs.applied).length > 0) {
        const diff = diffSyncable(beforeSettings, rs.applied)
        if (diff.length === 0) {
          lines.push('偏好：云端与本机一致')
        } else {
          await applyRemoteSettings(rs.applied)
          lines.push(`偏好：覆盖 ${diff.length} 项（${diff.join(' / ')}）`)
        }
      } else {
        lines.push('偏好：云端无数据')
      }

      if (rb.error) {
        lines.push(`书签：${rb.error}`)
        errored = true
      } else if (rb.payload) {
        await applyRemoteBookmarks(rb.payload)
        lines.push(
          `书签：${rb.payload.categories.length} 分类 / ${rb.payload.cards.length} 卡片` +
            `（${formatBytes(rb.bytes ?? 0)}）已应用`,
        )
      } else {
        lines.push('书签：云端无数据')
      }

      if (errored) {
        toast.error('云端覆盖完成（含错误）', lines.join('\n'))
      } else {
        toast.success('已应用云端数据', lines.join('\n'))
      }
      setMeta(await getMeta())
    } finally {
      setLoading(false)
    }
  }

  const handleWipeRemote = async () => {
    if (loading) return
    if (
      !(await confirmDialog({
        title: '清空云端 payload？',
        message:
          '会移除云端保存的偏好 + 全部书签数据（本机数据不变）。\n' +
          '如果当前开启了同步，下一次本地修改会重新写入云端。',
        danger: true,
      }))
    ) {
      return
    }
    setLoading(true)
    try {
      await wipeRemote()
      toast.success('已清空云端')
      setMeta(await getMeta())
    } finally {
      setLoading(false)
    }
  }

  const settingsLine = (() => {
    if (!meta.enabled) return null
    const parts: string[] = []
    if (meta.settings.lastPushTs) parts.push(`推送 ${fmt(meta.settings.lastPushTs)}`)
    if (meta.settings.lastPullTs) parts.push(`拉取 ${fmt(meta.settings.lastPullTs)}`)
    return parts.length > 0 ? parts.join(' · ') : '等待首次同步'
  })()

  const bookmarksLine = (() => {
    if (!meta.enabled) return null
    const parts: string[] = []
    if (meta.bookmarks.lastPushTs) parts.push(`推送 ${fmt(meta.bookmarks.lastPushTs)}`)
    if (meta.bookmarks.lastPullTs) parts.push(`拉取 ${fmt(meta.bookmarks.lastPullTs)}`)
    return parts.length > 0 ? parts.join(' · ') : '等待首次同步'
  })()

  const baseStatus = (() => {
    if (!supported) return 'storage.sync 不可用（Firefox 需登录 Mozilla 账号）'
    if (!meta.enabled) return '未开启 — 数据仅保存在本机'
    return null
  })()

  return (
    <section className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white/55 dark:bg-slate-900/45 p-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
        跨设备同步
      </h4>

      <label
        className={cn(
          'flex items-start gap-3 px-3 py-2.5 rounded-md',
          'border border-slate-200 dark:border-slate-700',
          supported
            ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors'
            : 'opacity-60 cursor-not-allowed',
        )}
      >
        <input
          type="checkbox"
          checked={meta.enabled}
          disabled={!supported || loading}
          onChange={(e) => void handleToggle(e.target.checked)}
          className="mt-0.5 w-4 h-4 accent-brand cursor-pointer shrink-0 disabled:cursor-not-allowed"
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-slate-700 dark:text-slate-200">
            开启跨设备同步（{supported ? 'chrome.storage.sync' : '不可用'}）
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
            同步「轻量偏好」+「全部分类 / 书签」。
            <span className="text-slate-500 dark:text-slate-300">壁纸、侧栏宽度</span>等
            体积大或设备相关的字段不在范围内。
            <br />
            冲突策略为「整包后写覆盖先写」，两台设备同时改时，后保存的会覆盖另一端。
          </div>
        </div>
      </label>

      {/* 状态：基础 / 错误 / 两条管线分别展示 */}
      <div className="mt-2 text-[11px] leading-relaxed">
        {meta.lastError ? (
          <div className="text-red-500">❗ {meta.lastError}</div>
        ) : baseStatus ? (
          <div className="text-slate-400">{baseStatus}</div>
        ) : (
          <div className="space-y-0.5 text-slate-400">
            {settingsLine && (
              <div>
                <span className="text-slate-500 dark:text-slate-300">偏好</span>
                <span className="mx-1.5">·</span>
                {settingsLine}
              </div>
            )}
            {bookmarksLine && (
              <div>
                <span className="text-slate-500 dark:text-slate-300">书签</span>
                <span className="mx-1.5">·</span>
                {bookmarksLine}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 容量进度条：本机当前占用 / 100KB 配额 */}
      {supported && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>云端容量（chrome.storage.sync · 上限 100KB）</span>
            <span
              className={cn(
                overQuota
                  ? 'text-red-500 font-medium'
                  : usedPct > 75
                    ? 'text-amber-500'
                    : 'text-slate-500 dark:text-slate-300',
              )}
            >
              {formatBytes(usedBytes)} / 100 KB · {usedPct.toFixed(0)}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-200/70 dark:bg-slate-700/60 overflow-hidden">
            <div
              className={cn(
                'h-full transition-all',
                overQuota
                  ? 'bg-red-500'
                  : usedPct > 75
                    ? 'bg-amber-500'
                    : 'bg-brand/70',
              )}
              style={{ width: `${Math.min(100, usedPct)}%` }}
            />
          </div>
          {overQuota && (
            <div className="mt-1 text-[11px] text-red-500 leading-relaxed">
              已超 100KB 配额，新的书签推送会被拒绝；请清理无用书签，或等待 V2.0 云盘方案。
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handlePushNow()}
          disabled={!meta.enabled || loading}
          className={cn(
            'px-3 py-1.5 text-xs rounded transition-colors',
            'border border-slate-200 dark:border-slate-700',
            'text-slate-600 dark:text-slate-300',
            'hover:bg-slate-100 dark:hover:bg-slate-700/60',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          ↑ 立即推送
        </button>
        <button
          type="button"
          onClick={() => void handlePullNow()}
          disabled={!supported || loading}
          className={cn(
            'px-3 py-1.5 text-xs rounded transition-colors',
            'border border-slate-200 dark:border-slate-700',
            'text-slate-600 dark:text-slate-300',
            'hover:bg-slate-100 dark:hover:bg-slate-700/60',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
          title="用云端最新数据覆盖本机"
        >
          ↓ 从云端覆盖
        </button>
        <button
          type="button"
          onClick={() => void handleWipeRemote()}
          disabled={!supported || loading}
          className={cn(
            'px-3 py-1.5 text-xs rounded transition-colors',
            'text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          ✕ 清空云端
        </button>
      </div>
    </section>
  )
}

function diffSyncable(
  local: UserSettings,
  remote: Partial<SyncableSettings>,
): string[] {
  const out: string[] = []
  for (const k of SYNCABLE_SETTINGS_KEYS) {
    if (!(k in remote)) continue
    if (local[k] !== remote[k]) out.push(k)
  }
  return out
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function fmt(ts: number): string {
  try {
    const d = new Date(ts)
    const today = new Date()
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    if (sameDay) return `今天 ${hh}:${mm}`
    return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
  } catch {
    return '—'
  }
}
