import { useMemo } from 'react'
import { useBookmarkStore } from '../../../../../../stores/useBookmarkStore'
import { useIsAIConfigured } from '../../../../../../ai/useAISettingsStore'
import { useTaggerStore } from '../../../../../../ai/services/useTaggerStore'
import { selectCardsForTagging } from '../../../../../../ai/services/tagger'
import { TAG_RANGE_LABEL } from '../../../../../../ai/types'
import { cn } from '../../../../../../utils/cn'
import { IconView } from '../../../../../../utils/icon'
import { Notice, NoAINotice, isDescendantOf } from '../../_shared'

/* ──────────────────────────────────────────────────────────────────────
 * Stage: config —— 选择「打标签范围」（未打标的 / 全部 / 某顶层分类）
 * 选完点「让 AI 打标签」→ 进入 estimate。
 * ────────────────────────────────────────────────────────────────────── */

export function ConfigStage() {
  const configured = useIsAIConfigured()
  const cards = useBookmarkStore((s) => s.cards)
  const categories = useBookmarkStore((s) => s.categories)
  const range = useTaggerStore((s) => s.range)
  const setRange = useTaggerStore((s) => s.setRange)
  const goEstimate = useTaggerStore((s) => s.goEstimate)

  const stat = useMemo(
    () => selectCardsForTagging(range, cards, categories).length,
    [range, cards, categories],
  )

  const topCategories = categories.filter((c) => !c.parentId)

  if (!configured) return <NoAINotice />

  return (
    <div className="p-3 space-y-4 text-sm">
      <Notice>
        AI 会读取所选范围内书签的「标题 + 域名」（不读完整 URL，更不读网页内容），
        为每条建议 2-4 个中文短标签。预览时可以单条接受或拒绝、也能直接编辑标签后再应用。
      </Notice>

      <section>
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
          打标签范围
        </h4>
        <div className="space-y-1.5">
          <RangeOption
            label={TAG_RANGE_LABEL.untagged}
            description="只为还没打过标签的书签生成（推荐：增量、低成本）"
            checked={range.type === 'untagged'}
            onClick={() => setRange({ type: 'untagged' })}
          />
          <RangeOption
            label={TAG_RANGE_LABEL.all}
            description="对所有书签重新生成（覆盖已有 tags；适合首次或大改）"
            checked={range.type === 'all'}
            onClick={() => setRange({ type: 'all' })}
          />
          {topCategories.length > 0 && (
            <div className="pl-3 border-l-2 border-slate-100 dark:border-slate-700 space-y-1">
              <div className="text-[11px] text-slate-400 mt-2 mb-1">
                按某个顶层分类（含后代）打标签：
              </div>
              {topCategories.map((c) => (
                <RangeOption
                  key={c.id}
                  label={
                    <span className="flex items-center gap-1.5 min-w-0">
                      <IconView
                        value={c.icon}
                        fallback="📁"
                        emojiClassName="text-sm leading-none"
                        imgClassName="w-4 h-4 rounded-sm object-contain"
                      />
                      <span className="truncate">{c.name}</span>
                    </span>
                  }
                  description={`${cards.filter((x) => x.categoryId === c.id || isDescendantOf(x.categoryId, c.id, categories)).length} 条`}
                  checked={range.type === 'category' && range.id === c.id}
                  onClick={() => setRange({ type: 'category', id: c.id })}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60">
        <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
          准备打标签{' '}
          <span className="text-slate-700 dark:text-slate-200 tabular-nums font-medium">
            {stat}
          </span>{' '}
          个书签
        </div>
        <button
          type="button"
          onClick={goEstimate}
          disabled={stat === 0}
          className={cn(
            'w-full h-9 inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium',
            stat > 0
              ? 'bg-brand text-white hover:bg-brand-600'
              : 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500 cursor-not-allowed',
          )}
        >
          ✨ 让 AI 打标签
        </button>
      </div>
    </div>
  )
}

function RangeOption({
  label,
  description,
  checked,
  onClick,
}: {
  label: React.ReactNode
  description?: string
  checked: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-3 p-2 rounded-md text-left transition-colors',
        'border',
        checked
          ? 'border-brand bg-brand/5'
          : 'border-slate-200 dark:border-slate-700 hover:border-brand/40',
      )}
    >
      <span
        className={cn(
          'shrink-0 mt-0.5 w-3.5 h-3.5 rounded-full border flex items-center justify-center',
          checked
            ? 'border-brand bg-brand'
            : 'border-slate-300 dark:border-slate-600',
        )}
        aria-hidden
      >
        {checked && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
      </span>
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            'text-sm',
            checked ? 'text-brand font-medium' : 'text-slate-700 dark:text-slate-200',
          )}
        >
          {label}
        </div>
        {description && (
          <div className="text-[11px] text-slate-400 mt-0.5">{description}</div>
        )}
      </div>
    </button>
  )
}
