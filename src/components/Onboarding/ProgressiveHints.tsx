import { useEffect, useRef, useState } from 'react'
import { useBookmarkStore } from '../../stores/useBookmarkStore'
import { cn } from '../../utils/cn'
import { Spotlight, useAutoDismiss } from './Spotlight'
import { useOnboardingStore } from './useOnboardingStore'

/**
 * L1.5 渐进式提示
 *
 * 监听两个数据维度，从 0 跳到 1 时单独触发一次轻量 mini-spotlight：
 *
 *   - categories.length: 0 → 1 → L1.5-b：高亮新分类条目，提示「双击改名」
 *   - cards.length:      0 → 1 → L1.5-a：高亮首张卡片，提示「右键看更多」
 *
 * 拒触发规则：
 *   - mainTourDone === false：主 Tour 还没走完，让位
 *   - 已 markDone：永不重弹
 *   - 增量 ≥ 2（视为批量导入）：静默 markDone 但不弹（避免骚扰）
 *
 * 视觉特征（区别于 L1 主 Tour）：
 *   - 无遮罩（不打断用户操作）
 *   - 仅一个「知道了」按钮，无翻页
 *   - 10s 自动消失（视为"已展示"）
 */

type ActiveHint = 'category' | 'card' | null

const AUTO_DISMISS_MS = 10000

export function ProgressiveHints() {
  const mainTourDone = useOnboardingStore((s) => s.mainTourDone)
  const tourActive = useOnboardingStore((s) => s.tourActive)
  const categoryHintDone = useOnboardingStore((s) => s.categoryHintDone)
  const cardMenuHintDone = useOnboardingStore((s) => s.cardMenuHintDone)
  const markCategoryDone = useOnboardingStore((s) => s.markCategoryHintDone)
  const markCardDone = useOnboardingStore((s) => s.markCardMenuHintDone)

  const categoriesCount = useBookmarkStore((s) => s.categories.length)
  const cardsCount = useBookmarkStore((s) => s.cards.length)

  // 用 ref 跟踪上一帧的计数，判断"是否从 0 跳到 ≥1"
  // initialized=false 标记「尚未观察过」—— 第一次 effect 跑时把当前值兜底进去，
  // 避免老用户启动时 prev=0 → curr=N 误触发
  const watchRef = useRef<{
    initialized: boolean
    categories: number
    cards: number
  }>({ initialized: false, categories: 0, cards: 0 })

  // 当前要显示的提示；同一时刻最多一个
  const [active, setActive] = useState<ActiveHint>(null)
  // hint 显示后延迟 500ms 再 setActive，等 DOM（新分类行 / 新卡片）渲染稳定
  const pendingTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const watch = watchRef.current

    // 首次跑：仅把当前值记下（防止老用户启动误触发）
    if (!watch.initialized) {
      watch.initialized = true
      watch.categories = categoriesCount
      watch.cards = cardsCount
      return
    }

    const prevCat = watch.categories
    const prevCard = watch.cards
    watch.categories = categoriesCount
    watch.cards = cardsCount

    // 主 Tour 进行中先不抢
    if (tourActive) return
    // 主 Tour 还没走完，让位（确保引导有先后顺序）
    if (!mainTourDone) return

    // ── 分类：0 → ≥1 ──
    if (prevCat === 0 && categoriesCount >= 1 && !categoryHintDone) {
      if (categoriesCount >= 2) {
        // 批量导入：静默标记 done，避免骚扰
        markCategoryDone()
      } else {
        scheduleShow('category', setActive, pendingTimerRef)
      }
    }

    // ── 卡片：0 → ≥1 ──
    if (prevCard === 0 && cardsCount >= 1 && !cardMenuHintDone) {
      if (cardsCount >= 2) {
        markCardDone()
      } else {
        scheduleShow('card', setActive, pendingTimerRef)
      }
    }
  }, [
    categoriesCount,
    cardsCount,
    tourActive,
    mainTourDone,
    categoryHintDone,
    cardMenuHintDone,
    markCategoryDone,
    markCardDone,
  ])

  // 卸载清理
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current) window.clearTimeout(pendingTimerRef.current)
    }
  }, [])

  if (!active) return null
  return (
    <HintBubble
      kind={active}
      onDismiss={() => {
        if (active === 'category') markCategoryDone()
        else markCardDone()
        setActive(null)
      }}
    />
  )
}

/** 延迟 500ms 后再 setActive，给目标 DOM 留出渲染时间 */
function scheduleShow(
  kind: NonNullable<ActiveHint>,
  setActive: (k: ActiveHint) => void,
  timerRef: React.MutableRefObject<number | null>,
) {
  if (timerRef.current) window.clearTimeout(timerRef.current)
  timerRef.current = window.setTimeout(() => {
    setActive(kind)
    timerRef.current = null
  }, 500)
}

/* ─── 轻量 hint 卡片：无遮罩 / 单按钮 / 自动消失 ────────────────────── */

interface HintProps {
  kind: 'category' | 'card'
  onDismiss: () => void
}

function HintBubble({ kind, onDismiss }: HintProps) {
  const cfg =
    kind === 'category'
      ? {
          anchor: 'sidebar-category-row',
          title: '💡 小贴士',
          body: '双击改名 · 长按可拖拽排序、跨层级嵌套 · 鼠标悬停看更多操作',
          placement: 'right' as const,
        }
      : {
          anchor: 'bookmark-card-any',
          title: '💡 小贴士',
          body: '悬停卡片可编辑 / 删除 / 看相关阅读；右键打开完整菜单',
          placement: 'top' as const,
        }

  // 10 秒自动消失，视为"已展示"
  useAutoDismiss(true, AUTO_DISMISS_MS, onDismiss)

  return (
    <Spotlight
      anchor={cfg.anchor}
      placement={cfg.placement}
      withBackdrop={false}
      // 锚点找不到（被批量删除等极端情况）静默关掉
      onAnchorMissing={onDismiss}
      title={cfg.title}
      body={cfg.body}
    >
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onDismiss}
          className={cn(
            'text-xs font-semibold px-3 py-1 rounded',
            'bg-brand text-white hover:bg-brand-600',
            'transition-colors',
          )}
        >
          知道了
        </button>
      </div>
    </Spotlight>
  )
}
