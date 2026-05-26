import { useMemo, useState } from 'react'
import { useBookmarkStore } from '../../../../../../stores/useBookmarkStore'
import { useTaggerStore, resolveFinalEntries } from '../../../../../../ai/services/useTaggerStore'
import { toast } from '../../../../../../stores/useToastStore'
import { cn } from '../../../../../../utils/cn'

/* ──────────────────────────────────────────────────────────────────────
 * Stage: preview —— 逐条建议复核 + 全选 + 编辑。
 * 用户点「应用」后 setCardTagsBatch 写入并跳 done；任何异常跳 error。
 * ────────────────────────────────────────────────────────────────────── */

export function PreviewStage() {
  const plan = useTaggerStore((s) => s.plan)
  const review = useTaggerStore((s) => s.review)
  const acceptAll = useTaggerStore((s) => s.acceptAll)
  const rejectAll = useTaggerStore((s) => s.rejectAll)
  const reset = useTaggerStore((s) => s.reset)
  const goApplying = useTaggerStore((s) => s.goApplying)
  const goDone = useTaggerStore((s) => s.goDone)
  const goError = useTaggerStore((s) => s.goError)
  const setCardTagsBatch = useBookmarkStore((s) => s.setCardTagsBatch)
  const cards = useBookmarkStore((s) => s.cards)

  // 卡片快查表（hook 必须在 early return 之前）
  const cardMap = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

  if (!plan) return null

  const acceptedCount = review.accepted.size

  const handleApply = async () => {
    goApplying()
    try {
      const entries = resolveFinalEntries(plan, review)
      if (entries.length > 0) {
        await setCardTagsBatch(entries)
      }
      goDone()
      toast.success(
        '标签已写入',
        `${entries.length} 条书签更新了 tags`,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误'
      goError(msg)
      toast.error('应用标签失败', msg)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部统计 + 全选 */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 text-xs">
        <span className="text-slate-500 dark:text-slate-400">已勾选</span>
        <span className="tabular-nums text-slate-700 dark:text-slate-200">
          {acceptedCount} / {plan.suggestions.length}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={acceptAll}
          className="text-brand hover:underline"
        >
          全选
        </button>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <button
          type="button"
          onClick={rejectAll}
          className="text-slate-500 hover:text-red-500"
        >
          全不选
        </button>
      </div>

      {/* 中间：建议列表 */}
      <div className="flex-1 overflow-auto p-2 space-y-1.5">
        {plan.suggestions.map((s) => (
          <SuggestionRow
            key={s.bookmarkId}
            suggestion={s}
            card={cardMap.get(s.bookmarkId)}
            accepted={review.accepted.has(s.bookmarkId)}
            edited={review.edits.get(s.bookmarkId)}
          />
        ))}
        {plan.suggestions.length === 0 && (
          <div className="text-center text-xs text-slate-400 py-8">
            AI 没有给出任何建议
          </div>
        )}
      </div>

      {/* 底部操作 */}
      <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2">
        <button
          type="button"
          onClick={reset}
          className={cn(
            'flex-1 h-9 rounded-md text-sm',
            'text-slate-600 dark:text-slate-300',
            'hover:bg-slate-100 dark:hover:bg-slate-700/60',
          )}
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => void handleApply()}
          disabled={acceptedCount === 0}
          className={cn(
            'flex-1 h-9 rounded-md text-sm font-medium',
            acceptedCount > 0
              ? 'bg-brand text-white hover:bg-brand-600'
              : 'bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500 cursor-not-allowed',
          )}
        >
          应用 {acceptedCount > 0 && `(${acceptedCount})`}
        </button>
      </div>
    </div>
  )
}

function SuggestionRow({
  suggestion,
  card,
  accepted,
  edited,
}: {
  suggestion: { bookmarkId: string; oldTags?: string[]; newTags: string[] }
  card?: { title: string; url: string }
  accepted: boolean
  edited?: string[]
}) {
  const toggleAccept = useTaggerStore((s) => s.toggleAccept)
  const editTags = useTaggerStore((s) => s.editTags)
  const resetEdit = useTaggerStore((s) => s.resetEdit)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const finalTags = edited ?? suggestion.newTags

  const startEdit = () => {
    setDraft(finalTags.join(' '))
    setEditing(true)
  }
  const commitEdit = () => {
    const next = draft
      .split(/[\s,，]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    editTags(suggestion.bookmarkId, next)
    setEditing(false)
  }

  // 卡片可能已被删除（理论上 plan 期间不会，但防御）
  if (!card) return null

  return (
    <div
      className={cn(
        'rounded-md border p-2 transition-colors',
        accepted
          ? 'border-brand/40 bg-brand/5'
          : 'border-slate-200 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-800/20 opacity-70',
      )}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={accepted}
          onChange={() => toggleAccept(suggestion.bookmarkId)}
          className="mt-1 shrink-0 accent-brand cursor-pointer"
          aria-label="接受此建议"
        />
        <div className="flex-1 min-w-0">
          {/* 卡片标题 */}
          <div className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
            {card.title}
          </div>
          <div className="text-[10px] text-slate-400 truncate font-mono">
            {card.url}
          </div>

          {/* tags 区 */}
          <div className="mt-1.5">
            {editing ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit()
                    if (e.key === 'Escape') setEditing(false)
                  }}
                  onBlur={commitEdit}
                  placeholder="用空格 / 逗号分隔"
                  className={cn(
                    'flex-1 h-6 px-1.5 text-xs rounded',
                    'bg-white dark:bg-slate-900',
                    'border border-brand focus:ring-1 focus:ring-brand/30 outline-none',
                  )}
                />
              </div>
            ) : (
              <div className="flex items-center flex-wrap gap-1">
                {suggestion.oldTags && suggestion.oldTags.length > 0 && (
                  <>
                    {suggestion.oldTags.map((t) => (
                      <span
                        key={`old-${t}`}
                        className="inline-flex items-center px-1.5 h-4 rounded text-[10px] text-slate-400 line-through bg-slate-100 dark:bg-slate-800"
                      >
                        {t}
                      </span>
                    ))}
                    <span className="text-[10px] text-slate-300 mx-0.5">→</span>
                  </>
                )}
                {finalTags.map((t) => (
                  <span
                    key={`new-${t}`}
                    className={cn(
                      'inline-flex items-center px-1.5 h-4 rounded text-[10px]',
                      'bg-brand/10 text-brand',
                    )}
                  >
                    {t}
                  </span>
                ))}
                <button
                  type="button"
                  onClick={startEdit}
                  className="text-[10px] text-slate-400 hover:text-brand ml-1"
                  title="编辑"
                >
                  ✎
                </button>
                {edited && (
                  <button
                    type="button"
                    onClick={() => resetEdit(suggestion.bookmarkId)}
                    className="text-[10px] text-slate-400 hover:text-slate-600"
                    title="还原 AI 建议"
                  >
                    ↶
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
