import { useMemo } from 'react'
import type { OrganizePlan, PlanReview } from '../../ai/types'
import { useBookmarkStore } from '../../stores/useBookmarkStore'
import { useOrganizeStore } from '../../ai/services/useOrganizeStore'
import { cn } from '../../utils/cn'
import { IconView } from '../../utils/icon'

/**
 * 整理建议 diff 视图
 *
 * 三段：
 * 1. 🆕 即将新建的分类（每条带"接受"勾选 + AI 给的理由）
 * 2. ↻ 书签移动（按目标分类聚合显示，避免一条条堆）
 * 3. 🗑 删除的空分类
 *
 * 单条 ✓/✗ 即时联动 useOrganizeStore.review。
 */
export function DiffViewer({
  plan,
  review,
}: {
  plan: OrganizePlan
  review: PlanReview
}) {
  const cards = useBookmarkStore((s) => s.cards)
  const categories = useBookmarkStore((s) => s.categories)
  const toggleNewCategory = useOrganizeStore((s) => s.toggleNewCategory)
  const toggleAssignment = useOrganizeStore((s) => s.toggleAssignment)
  const toggleDeletion = useOrganizeStore((s) => s.toggleDeletion)

  const cardMap = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])
  const catMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  )
  const tempIdToProposal = useMemo(
    () => new Map(plan.newCategories.map((c) => [c.tempId, c])),
    [plan.newCategories],
  )

  // 按"目标分类"聚合 assignments，让 UI 更紧凑
  const grouped = useMemo(() => {
    type Group = {
      key: string
      label: string
      isNew: boolean
      assignments: Array<{ index: number; cardId: string }>
    }
    const map = new Map<string, Group>()
    plan.assignments.forEach((asn, i) => {
      const key = asn.targetTempId ?? `cat:${asn.targetCategoryId ?? '?'}`
      let label = '(未知目标)'
      let isNew = false
      if (asn.targetTempId) {
        const p = tempIdToProposal.get(asn.targetTempId)
        if (p) {
          label = p.name
          isNew = true
        }
      } else if (asn.targetCategoryId) {
        label = catMap.get(asn.targetCategoryId)?.name ?? '(未知)'
      }
      const g = map.get(key) ?? { key, label, isNew, assignments: [] }
      g.assignments.push({ index: i, cardId: asn.bookmarkId })
      map.set(key, g)
    })
    // 排序：新建 在前 + 内部按数量倒序
    return Array.from(map.values()).sort((a, b) => {
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1
      return b.assignments.length - a.assignments.length
    })
  }, [plan.assignments, tempIdToProposal, catMap])

  return (
    <div className="space-y-5">
      {/* ───── 1. 新建分类 ───── */}
      {plan.newCategories.length > 0 && (
        <Section title="新建分类" emoji="🆕" count={plan.newCategories.length}>
          <div className="space-y-1.5">
            {plan.newCategories.map((p) => {
              const accepted = review.acceptedNewCategoryTempIds.has(p.tempId)
              const memberCount = plan.assignments.filter(
                (a) => a.targetTempId === p.tempId,
              ).length
              return (
                <DiffRow
                  key={p.tempId}
                  accepted={accepted}
                  onToggle={() => toggleNewCategory(p.tempId)}
                  badge={
                    <span className="inline-flex items-center gap-1">
                      <IconView
                        value={p.icon}
                        fallback="📁"
                        emojiClassName="text-base leading-none"
                        imgClassName="w-4 h-4 rounded-sm object-contain"
                      />
                      <span className="font-medium">{p.name}</span>
                      <span className="text-[10px] text-slate-400 tabular-nums">
                        ({memberCount} 项)
                      </span>
                    </span>
                  }
                  detail={p.rationale}
                />
              )
            })}
          </div>
        </Section>
      )}

      {/* ───── 2. 书签移动（按目标聚合） ───── */}
      {grouped.length > 0 && (
        <Section
          title="书签移动"
          emoji="↻"
          count={plan.assignments.length}
        >
          <div className="space-y-2">
            {grouped.map((g) => {
              const allAccepted = g.assignments.every((a) =>
                review.acceptedAssignments.has(a.index),
              )
              return (
                <div
                  key={g.key}
                  className={cn(
                    'rounded-md border border-slate-200 dark:border-slate-700',
                    'bg-white dark:bg-slate-800/40',
                  )}
                >
                  <div className="flex items-center gap-2 px-3 py-2 text-xs">
                    <span className="text-slate-400">→</span>
                    <span
                      className={cn(
                        'font-medium',
                        g.isNew
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-700 dark:text-slate-200',
                      )}
                    >
                      {g.label}
                    </span>
                    {g.isNew && (
                      <span className="text-[10px] text-emerald-600 dark:text-emerald-400 px-1 rounded bg-emerald-100 dark:bg-emerald-500/20">
                        新建
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400 tabular-nums">
                      {g.assignments.length} 条
                    </span>
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => {
                        // 切换整组
                        for (const a of g.assignments) {
                          if (allAccepted)
                            review.acceptedAssignments.delete(a.index)
                          else review.acceptedAssignments.add(a.index)
                          toggleAssignment(a.index)
                        }
                      }}
                      className="text-[10px] text-brand hover:underline"
                    >
                      {allAccepted ? '全部拒绝' : '全部接受'}
                    </button>
                  </div>
                  <ul className="px-3 pb-2 space-y-1">
                    {g.assignments.map((a) => {
                      const card = cardMap.get(a.cardId)
                      const accepted = review.acceptedAssignments.has(a.index)
                      return (
                        <li key={a.index} className="flex items-center gap-2">
                          <Checkbox
                            checked={accepted}
                            onChange={() => toggleAssignment(a.index)}
                          />
                          <span
                            className={cn(
                              'flex-1 truncate text-xs',
                              accepted
                                ? 'text-slate-700 dark:text-slate-200'
                                : 'text-slate-400 line-through',
                            )}
                            title={card?.title}
                          >
                            {card?.title ?? '(已不存在)'}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* ───── 3. 删除空分类 ───── */}
      {plan.deletions.length > 0 && (
        <Section title="删除空分类" emoji="🗑" count={plan.deletions.length}>
          <div className="space-y-1.5">
            {plan.deletions.map((id) => {
              const accepted = review.acceptedDeletions.has(id)
              const cat = catMap.get(id)
              return (
                <DiffRow
                  key={id}
                  accepted={accepted}
                  onToggle={() => toggleDeletion(id)}
                  badge={
                    <span className="inline-flex items-center gap-1">
                      <IconView
                        value={cat?.icon}
                        fallback="📁"
                        emojiClassName="text-base leading-none"
                        imgClassName="w-4 h-4 rounded-sm object-contain"
                      />
                      <span className="font-medium line-through">
                        {cat?.name ?? '(未知)'}
                      </span>
                    </span>
                  }
                  detail="书签已全部移走，可以安全删除"
                />
              )
            })}
          </div>
        </Section>
      )}

      {plan.newCategories.length === 0 &&
        plan.assignments.length === 0 &&
        plan.deletions.length === 0 && (
          <div className="text-center py-12 text-sm text-slate-400">
            ✓ AI 觉得当前结构已经很好，没有可优化的建议
          </div>
        )}
    </div>
  )
}

/* ─── 局部组件 ──────────────────────────────────────── */

function Section({
  title,
  emoji,
  count,
  children,
}: {
  title: string
  emoji: string
  count: number
  children: React.ReactNode
}) {
  return (
    <section>
      <h4 className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2 px-1">
        <span>{emoji}</span>
        <span>{title}</span>
        <span className="text-[10px] text-slate-400 tabular-nums">{count}</span>
      </h4>
      {children}
    </section>
  )
}

function DiffRow({
  accepted,
  onToggle,
  badge,
  detail,
}: {
  accepted: boolean
  onToggle: () => void
  badge: React.ReactNode
  detail?: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-full text-left flex items-start gap-2 px-2.5 py-2 rounded-md',
        'border border-slate-200 dark:border-slate-700',
        'transition-colors',
        accepted
          ? 'bg-white dark:bg-slate-800/40 hover:border-brand/40'
          : 'bg-slate-100/60 dark:bg-slate-800/20 opacity-60',
      )}
    >
      <Checkbox checked={accepted} onChange={() => undefined} stopProp={false} />
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            'text-xs',
            !accepted && 'line-through text-slate-400',
          )}
        >
          {badge}
        </div>
        {detail && (
          <div className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
            {detail}
          </div>
        )}
      </div>
    </button>
  )
}

function Checkbox({
  checked,
  onChange,
  stopProp = true,
}: {
  checked: boolean
  onChange: () => void
  stopProp?: boolean
}) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={(e) => {
        if (stopProp) e.stopPropagation()
        onChange()
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onChange()
        }
      }}
      className={cn(
        'shrink-0 mt-0.5 w-4 h-4 rounded border flex items-center justify-center text-[10px]',
        'transition-colors cursor-pointer',
        checked
          ? 'bg-brand border-brand text-white'
          : 'border-slate-300 dark:border-slate-600 hover:border-brand/60',
      )}
    >
      {checked ? '✓' : ''}
    </span>
  )
}
