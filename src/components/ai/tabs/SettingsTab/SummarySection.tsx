import { useEffect, useMemo, useState } from 'react'
import { useAISettingsStore } from '../../../../ai/useAISettingsStore'
import { useBookmarkStore } from '../../../../stores/useBookmarkStore'
import { useSummarizerStore } from '../../../../ai/services/useSummarizerStore'
import {
  SUMMARY_RANGE_LABEL,
  runSummarizer,
  selectCardsForSummarizing,
} from '../../../../ai/services/summarizer'
import { cn } from '../../../../utils/cn'
import { toast } from '../../../../stores/useToastStore'
import { confirmDialog } from '../../../Dialog'
import { ActionBtn, RangeChip, ToggleRow } from './shared'
import { IconView } from '../../../../utils/icon'

/* ─────────────────────────────────────────────────────────────
 * AI 自动备注 section（V2.0 §6.3）
 *
 * 列表 + 范围选择 + 进度 + 一键批量；不覆盖用户已写的 description。
 * autoSummarize 开关只控制"crawler 完成后是否提示用户来这里"，
 * 不会真的后台静默调 LLM —— 避免无声消耗 token。
 * ───────────────────────────────────────────────────────────── */

export function SummarySection() {
  const settings = useAISettingsStore()
  const cards = useBookmarkStore((s) => s.cards)
  const categories = useBookmarkStore((s) => s.categories)
  const updateCard = useBookmarkStore((s) => s.updateCard)

  const stage = useSummarizerStore((s) => s.stage)
  const range = useSummarizerStore((s) => s.range)
  const progress = useSummarizerStore((s) => s.progress)
  const lastResult = useSummarizerStore((s) => s.lastResult)
  const errorMessage = useSummarizerStore((s) => s.errorMessage)
  const setRange = useSummarizerStore((s) => s.setRange)
  const start = useSummarizerStore((s) => s.start)
  const setProgress = useSummarizerStore((s) => s.setProgress)
  const finish = useSummarizerStore((s) => s.finish)
  const fail = useSummarizerStore((s) => s.fail)
  const cancel = useSummarizerStore((s) => s.cancel)
  const reset = useSummarizerStore((s) => s.reset)

  // 估算待处理条数（仅给按钮上的 (N) 用）
  const [estimated, setEstimated] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    void selectCardsForSummarizing(range, cards, categories).then((list) => {
      if (!cancelled) setEstimated(list.length)
    })
    return () => {
      cancelled = true
    }
  }, [range, cards, categories, stage])

  const topCategories = useMemo(
    () => categories.filter((c) => !c.parentId),
    [categories],
  )
  const running = stage === 'running'
  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  const handleRun = async () => {
    const targets = await selectCardsForSummarizing(range, cards, categories)
    if (targets.length === 0) {
      toast.info('无可生成项', '该范围内没有需要生成备注的卡片')
      return
    }
    if (
      range.type === 'all' &&
      !(await confirmDialog({
        title: `覆盖 ${targets.length} 张卡片的备注？`,
        message: '"all" 模式会重新生成并覆盖已有备注。',
        confirmText: '覆盖',
        danger: true,
      }))
    ) {
      return
    }
    if (
      targets.length > 30 &&
      !(await confirmDialog({
        title: `为 ${targets.length} 张卡片生成备注`,
        message:
          '每张约 1 次 LLM 调用，按 token 计费。开始？',
        confirmText: '开始生成',
      }))
    ) {
      return
    }

    const controller = new AbortController()
    start(controller)
    try {
      const result = await runSummarizer({
        cards: targets,
        settings,
        signal: controller.signal,
        onProgress: setProgress,
      })
      // 写库：仅写入"AI 真给了 summary 的"；用户已写过 description 的在 select 阶段就过滤了
      let written = 0
      for (const r of result.results) {
        if (!r.summary) continue
        await updateCard(r.cardId, { description: r.summary })
        written++
      }
      finish({ total: result.total, ok: result.ok, failed: result.failed })
      if (written > 0) {
        toast.success('AI 备注已写入', `${written} 张卡片`)
      } else {
        toast.warning(
          '没有可用的备注',
          'AI 没能为这批书签生成有效摘要，可换个 Provider 重试',
        )
      }
    } catch (err) {
      if (controller.signal.aborted) {
        reset()
        return
      }
      const msg = err instanceof Error ? err.message : '未知错误'
      fail(msg)
      toast.error('AI 备注任务失败', msg)
    }
  }

  return (
    <section id="summary-section">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
        AI 自动备注
      </h4>
      <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
        基于已抓取正文，让 AI 为每张卡片生成一句话简短摘要（≤ 25 字），写入备注。
        <span className="text-slate-500"> 默认仅处理"已抓正文且没写备注"的卡片，不会覆盖你写的内容。</span>
      </p>

      {/* autoSummarize 开关 */}
      <ToggleRow
        label="抓取完成后提示生成备注"
        description="开启后，每次内容抓取完成会提示「已为你准备 N 条可生成备注」"
        checked={settings.autoSummarize}
        onChange={settings.setAutoSummarize}
      />

      {/* 范围选择 */}
      {!running && (
        <div className="mt-2 space-y-1.5">
          <RangeChip
            checked={range.type === 'untouched'}
            onClick={() => setRange({ type: 'untouched' })}
            label={SUMMARY_RANGE_LABEL.untouched}
          />
          <RangeChip
            checked={range.type === 'all'}
            onClick={() => setRange({ type: 'all' })}
            label={SUMMARY_RANGE_LABEL.all}
          />
          {topCategories.length > 0 && (
            <details className="group">
              <summary
                className={cn(
                  'cursor-pointer text-[11px] text-slate-500 dark:text-slate-400 px-2 py-1 rounded',
                  'hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                按某个顶层分类生成备注…
              </summary>
              <div className="pl-2 mt-1 space-y-1 border-l-2 border-slate-100 dark:border-slate-700">
                {topCategories.map((c) => (
                  <RangeChip
                    key={c.id}
                    checked={range.type === 'category' && range.id === c.id}
                    onClick={() => setRange({ type: 'category', id: c.id })}
                    label={
                      <>
                        <IconView
                          value={c.icon}
                          fallback="📁"
                          emojiClassName="text-sm leading-none"
                          imgClassName="w-4 h-4 rounded-sm object-contain"
                        />
                        <span className="truncate">{c.name}</span>
                      </>
                    }
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* 进度条 */}
      {running && (
        <div className="mt-2 rounded-md border border-brand/30 bg-brand/5 px-2.5 py-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-brand font-medium">
              ✨ 正在生成备注…
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
          {progress.currentTitle && (
            <div
              className="text-[10px] text-slate-500 dark:text-slate-400 truncate"
              title={progress.currentTitle}
            >
              · {progress.currentTitle}
            </div>
          )}
          <button
            type="button"
            onClick={cancel}
            className="text-[10px] text-slate-400 hover:text-red-500"
          >
            取消任务（已完成项保留）
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
          ✓ 上次：成功 {lastResult.ok} / {lastResult.total}
          {lastResult.failed > 0 && (
            <span className="text-amber-600 dark:text-amber-300">
              （失败 {lastResult.failed}）
            </span>
          )}
        </div>
      )}

      {/* 操作按钮区 */}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <ActionBtn
          primary
          disabled={running || estimated === 0}
          onClick={() => void handleRun()}
          title={
            estimated === 0
              ? '当前范围无可生成项；先在「内容抓取」里抓些正文'
              : '为选定范围生成 AI 备注'
          }
        >
          ✨ 批量生成备注
          {estimated !== null && estimated > 0 && (
            <span className="ml-1 tabular-nums opacity-80">({estimated})</span>
          )}
        </ActionBtn>
      </div>
    </section>
  )
}
