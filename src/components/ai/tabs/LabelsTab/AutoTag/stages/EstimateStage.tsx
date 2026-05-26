import { useMemo } from 'react'
import { useBookmarkStore } from '../../../../../../stores/useBookmarkStore'
import { useAISettingsStore } from '../../../../../../ai/useAISettingsStore'
import { useTaggerStore } from '../../../../../../ai/services/useTaggerStore'
import { estimateTaggerCost, runTagger, selectCardsForTagging } from '../../../../../../ai/services/tagger'
import { toast } from '../../../../../../stores/useToastStore'
import { cn } from '../../../../../../utils/cn'

/* ──────────────────────────────────────────────────────────────────────
 * Stage: estimate —— 展示「将打标签的书签数 / 模型 / 估算 token & 成本」。
 * 用户确认后才真正向 AI 发请求，避免静默烧钱。
 * ────────────────────────────────────────────────────────────────────── */

export function EstimateStage() {
  const settings = useAISettingsStore()
  const cards = useBookmarkStore((s) => s.cards)
  const categories = useBookmarkStore((s) => s.categories)
  const range = useTaggerStore((s) => s.range)
  const reset = useTaggerStore((s) => s.reset)
  const goRunning = useTaggerStore((s) => s.goRunning)
  const setProgress = useTaggerStore((s) => s.setProgress)
  const goPreview = useTaggerStore((s) => s.goPreview)
  const goError = useTaggerStore((s) => s.goError)

  const targetCards = useMemo(
    () => selectCardsForTagging(range, cards, categories),
    [range, cards, categories],
  )

  const provider = settings.providers.find(
    (p) => p.id === (settings.routing.organize ?? settings.routing.chat),
  )
  const { promptTokens, outputTokens, costCny } = useMemo(
    () => estimateTaggerCost(targetCards, provider?.model ?? ''),
    [targetCards, provider?.model],
  )

  const handleStart = async () => {
    const controller = new AbortController()
    goRunning(controller)
    try {
      const plan = await runTagger({
        range,
        cards,
        categories,
        settings,
        signal: controller.signal,
        onProgress: setProgress,
      })
      if (plan.suggestions.length === 0) {
        goError('AI 没有给出任何标签建议（可能是模型返回格式异常）。请重试，或换一个 Provider。')
        return
      }
      goPreview(plan)
    } catch (err) {
      if (controller.signal.aborted) return
      const msg = err instanceof Error ? err.message : '未知错误'
      goError(msg)
      toast.error('AI 打标签失败', msg)
    }
  }

  return (
    <div className="p-3 space-y-4 text-sm">
      <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">
        即将执行 AI 打标签
      </h3>

      <div className="rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 p-3 space-y-1.5 text-xs">
        <Stat label="书签数量" value={`${targetCards.length} 条`} />
        <Stat label="使用 Provider" value={provider?.name ?? '(未选)'} />
        <Stat label="使用模型" value={provider?.model ?? '(未选)'} mono />
        <Stat label="发送数据" value="标题 + 域名（已匿名）" />
        <div className="border-t border-slate-200 dark:border-slate-700/60 my-1.5" />
        <Stat label="估算 prompt tokens" value={promptTokens.toLocaleString()} />
        <Stat label="估算 output tokens" value={outputTokens.toLocaleString()} />
        <Stat
          label="估算成本"
          value={costCny > 0 ? `≈ ¥${costCny.toFixed(4)}` : '免费 / 未知'}
          highlight
        />
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed">
        以上为粗略估算。实际值以 Provider 返回为准。
        每批 50 条；成本与书签数量近似线性。
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={reset}
          className={cn(
            'flex-1 h-9 rounded-md text-sm',
            'text-slate-600 dark:text-slate-300',
            'hover:bg-slate-100 dark:hover:bg-slate-700/60',
          )}
        >
          返回
        </button>
        <button
          type="button"
          onClick={() => void handleStart()}
          className="flex-1 h-9 rounded-md text-sm font-medium bg-brand text-white hover:bg-brand-600"
        >
          确认执行
        </button>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  mono,
  highlight,
}: {
  label: string
  value: string
  mono?: boolean
  highlight?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span
        className={cn(
          'tabular-nums',
          mono && 'font-mono text-[11px]',
          highlight ? 'text-brand font-medium' : 'text-slate-700 dark:text-slate-200',
        )}
      >
        {value}
      </span>
    </div>
  )
}
