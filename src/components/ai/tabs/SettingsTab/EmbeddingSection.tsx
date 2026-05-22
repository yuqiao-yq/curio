import { useEffect, useState } from 'react'
import { useAISettingsStore } from '../../../../ai/useAISettingsStore'
import { useBookmarkStore } from '../../../../stores/useBookmarkStore'
import { useEmbedderStore } from '../../../../ai/services/useEmbedderStore'
import {
  cleanOrphans,
  computeEmbedStatus,
  runEmbed,
  type EmbedStatus,
} from '../../../../ai/services/embedder'
import { clearEmbeddings } from '../../../../repositories/EmbeddingsDB'
import { cn } from '../../../../utils/cn'
import { toast } from '../../../../stores/useToastStore'
import { confirmDialog } from '../../../Dialog'
import { ActionBtn, StatRow } from './shared'

/* ─────────────────────────────────────────────────────────────
 * Embedding 管理 section（§5.1）
 *
 * 状态展示 + 三个动作：
 * - 「补缺」：仅为缺失 / stale 的卡片生成（增量、低成本，推荐）
 * - 「全部重生成」：清空整库后从头跑（切换模型 / 大改后用）
 * - 「清空」：删除所有 embedding（不会再走语义搜索）
 *
 * 进度态用 useEmbedderStore 跟踪，可中途取消。
 * ───────────────────────────────────────────────────────────── */

export function EmbeddingSection() {
  const settings = useAISettingsStore()
  const cards = useBookmarkStore((s) => s.cards)
  const stage = useEmbedderStore((s) => s.stage)
  const progress = useEmbedderStore((s) => s.progress)
  const lastResult = useEmbedderStore((s) => s.lastResult)
  const errorMessage = useEmbedderStore((s) => s.errorMessage)
  const start = useEmbedderStore((s) => s.start)
  const setProgress = useEmbedderStore((s) => s.setProgress)
  const finish = useEmbedderStore((s) => s.finish)
  const fail = useEmbedderStore((s) => s.fail)
  const cancel = useEmbedderStore((s) => s.cancel)
  const reset = useEmbedderStore((s) => s.reset)

  const [status, setStatus] = useState<EmbedStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)

  // 拉一次状态：mount 时 + 任务结束后 + cards / settings 变了
  // computeEmbedStatus 是异步，不能放在 useMemo 里
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setStatusLoading(true)
      try {
        const s = await computeEmbedStatus(cards, settings)
        if (!cancelled) setStatus(s)
      } finally {
        if (!cancelled) setStatusLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // 任务从 running → done/error 时自动刷新状态
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, settings.providers, settings.routing.embedding, stage])

  const handleRun = async (mode: 'all' | 'missing') => {
    if (mode === 'all') {
      const ok = await confirmDialog({
        title: '确认全量重生成 embedding？',
        message:
          '这会清空当前所有 embedding 并重新调 API（按书签数量计费）。\n建议仅在切换 embedding 模型 / 大批量改了卡片后使用。',
        confirmText: '全量重生成',
        danger: true,
      })
      if (!ok) return
    }
    const controller = new AbortController()
    start(mode, controller)
    try {
      const result = await runEmbed({
        mode,
        cards,
        settings,
        signal: controller.signal,
        onProgress: setProgress,
      })
      finish(result)
      if (result.errors.length > 0) {
        toast.warning(
          'Embedding 部分失败',
          `成功 ${result.saved} / ${result.generated} 条；${result.errors.length} 个批次失败`,
        )
      } else if (result.saved > 0) {
        toast.success(
          'Embedding 已生成',
          `${result.saved} 条 · model=${result.model}`,
        )
      } else {
        toast.info('无可生成项', '所有书签的 embedding 都已是最新')
      }
    } catch (err) {
      if (controller.signal.aborted) {
        reset()
        return
      }
      const msg = err instanceof Error ? err.message : '未知错误'
      fail(msg)
      toast.error('Embedding 任务失败', msg)
    }
  }

  const handleClear = async () => {
    const ok = await confirmDialog({
      title: '清空所有 embedding？',
      message:
        '清空后语义搜索会回退到普通 substring 搜索，直到再次生成。',
      confirmText: '清空',
      danger: true,
    })
    if (!ok) return
    await clearEmbeddings()
    toast.success('已清空', 'Embedding 库已重置')
    setStatus(null)
    reset()
  }

  const handleCleanOrphans = async () => {
    const removed = await cleanOrphans(cards)
    if (removed === 0) {
      toast.info('无孤立行', '所有 embedding 都对应着现有书签')
    } else {
      toast.success('已清理', `删掉 ${removed} 条孤立 embedding`)
    }
    reset()
  }

  const running = stage === 'running'
  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <section>
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
        Embedding 管理
      </h4>
      <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
        生成后可在搜索框输入 <code className="font-mono text-slate-500">@ai 关键字</code> 跨标题/标签做语义搜索。
        新增 / 修改书签后会自动标记为待补，点「补缺」即可增量更新。
      </p>

      {/* 状态网格 */}
      <div
        className={cn(
          'rounded-md border p-2.5 text-xs',
          'bg-slate-50 dark:bg-slate-800/40',
          'border-slate-200 dark:border-slate-700',
        )}
      >
        {statusLoading && !status ? (
          <div className="text-slate-400 py-1">读取索引状态…</div>
        ) : status ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <StatRow label="书签总数" value={status.totalCards} />
            <StatRow
              label="已索引"
              value={status.indexedCards}
              tone={status.indexedCards === status.totalCards ? 'ok' : 'normal'}
            />
            <StatRow
              label="待补缺"
              value={status.missingCards}
              tone={status.missingCards > 0 ? 'warn' : 'ok'}
            />
            <StatRow
              label="内容已变 (stale)"
              value={status.staleCards}
              tone={status.staleCards > 0 ? 'warn' : 'ok'}
            />
            {status.mismatchCards > 0 && (
              <StatRow
                label="模型不一致"
                value={status.mismatchCards}
                tone="warn"
              />
            )}
            {status.orphanRows > 0 && (
              <StatRow label="孤立行" value={status.orphanRows} tone="warn" />
            )}
            {status.currentModel && (
              <div className="col-span-2 flex items-center justify-between gap-2 pt-1 mt-1 border-t border-slate-200 dark:border-slate-700/60">
                <span className="text-slate-400">使用模型</span>
                <span className="font-mono text-[10px] text-slate-500 dark:text-slate-300 truncate">
                  {status.currentModel}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-slate-400 py-1">暂无数据</div>
        )}
      </div>

      {/* 进度条（运行中） */}
      {running && (
        <div className="mt-2 rounded-md border border-brand/30 bg-brand/5 px-2.5 py-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-brand font-medium">
              ✨ 正在生成 embedding…
            </span>
            <span className="tabular-nums text-slate-500">
              {progress.done} / {progress.total} ({pct}%)
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
            <div
              className="h-full bg-brand transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <button
            type="button"
            onClick={cancel}
            className="text-[10px] text-slate-400 hover:text-red-500"
          >
            取消任务
          </button>
        </div>
      )}

      {/* 错误条 */}
      {stage === 'error' && (
        <div className="mt-2 rounded-md border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-600 dark:text-red-300 break-words">
          {errorMessage}
          <button
            type="button"
            onClick={reset}
            className="ml-2 underline hover:no-underline"
          >
            知道了
          </button>
        </div>
      )}

      {/* 上次结果摘要 */}
      {stage === 'done' && lastResult && (
        <div className="mt-2 rounded-md border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
          ✓ 上次任务：成功 {lastResult.saved} / {lastResult.generated} 条
          {lastResult.errors.length > 0 && (
            <span className="text-amber-600 dark:text-amber-300">
              ，{lastResult.errors.length} 批失败
            </span>
          )}
        </div>
      )}

      {/* 操作按钮区 */}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <ActionBtn
          primary
          disabled={running || !status || status.missingCards + status.staleCards === 0}
          onClick={() => void handleRun('missing')}
          title={
            status && status.missingCards + status.staleCards === 0
              ? '所有 embedding 都已是最新'
              : '为缺失 / 内容变化的卡片生成 embedding'
          }
        >
          ✨ 补缺
          {status && status.missingCards + status.staleCards > 0 && (
            <span className="ml-1 tabular-nums opacity-80">
              ({status.missingCards + status.staleCards})
            </span>
          )}
        </ActionBtn>
        <ActionBtn
          disabled={running || !status || status.totalCards === 0}
          onClick={() => void handleRun('all')}
          title="清空后从头跑（切换模型 / 大改时用）"
        >
          全部重生成
        </ActionBtn>
        {status && status.orphanRows > 0 && (
          <ActionBtn
            disabled={running}
            onClick={() => void handleCleanOrphans()}
            title="删除已被删除卡片对应的孤立 embedding 行"
          >
            清理孤立 ({status.orphanRows})
          </ActionBtn>
        )}
        <div className="flex-1" />
        <ActionBtn
          danger
          disabled={running || !status || status.indexedCards === 0}
          onClick={() => void handleClear()}
          title="清空所有 embedding（不删书签本身）"
        >
          清空
        </ActionBtn>
      </div>
    </section>
  )
}
