import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { BookmarkCard } from '../types/bookmark'
import { BookmarkCardItem } from './BookmarkCardItem'
import { useBookmarkStore } from '../stores/useBookmarkStore'

/* ─────────────────────────────────────────────────────────────
 * VirtualBookmarkGrid（P0-1）
 *
 * 仅在「搜索结果」这类大型扁平卡片列上使用：
 *   - 1000+ 卡片时，老实 render 全量 DOM 会让首帧 / 滚动卡顿（CardItem ~720 LOC）
 *   - 分类内部按 section 展示，单 section 通常 <100 卡，不走这里
 *
 * 实现：
 *   - 行级虚拟化（每行 N 列，N 由容器宽度 + Tailwind 断点推导）
 *   - 滚动容器自动向上找最近的 overflow-y-auto/scroll 祖先（这里是
 *     <main className="overflow-y-auto"> in App.tsx）
 *   - 卡片高度用 measureElement 动态测量，不写死，避免不同视觉密度下高度漂移
 *   - overscan=4 行：滚动时预渲染上下 4 行，体感无白屏
 *   - 列数变化（窗口 resize 跨越断点）时强制 reset 测量缓存
 *
 * 与原始 `<div className={GRID_COLS}>` 行为完全一致：响应式列数、gap-3。
 * ───────────────────────────────────────────────────────────── */

export interface VirtualBookmarkItem {
  card: BookmarkCard
  categoryPath: string
  dupCount: number
  dupCategoryPaths: string[]
}

interface Props {
  items: VirtualBookmarkItem[]
  /** 启用虚拟化的阈值；items 少于此值时直接全量渲染，避免不必要的复杂度 */
  threshold?: number
}

// 与 BookmarkGrid 内 GRID_COLS 同步：grid-cols-2 sm:3 md:4 lg:5 xl:6
// Tailwind 默认断点：sm=640 md=768 lg=1024 xl=1280
function colsForWidth(w: number): number {
  if (w >= 1280) return 6
  if (w >= 1024) return 5
  if (w >= 768) return 4
  if (w >= 640) return 3
  return 2
}

/**
 * compact 档：按 BookmarkGrid GRID_COLS_COMPACT 同款 `auto-fill minmax(112px,1fr)` 计算列数。
 * 单卡宽 112px，gap-2 = 8px；列数 = floor((w + gap) / (112 + gap))，最少 1 列。
 */
const COMPACT_CARD = 112
const COMPACT_GAP = 8
function compactColsForWidth(w: number): number {
  return Math.max(1, Math.floor((w + COMPACT_GAP) / (COMPACT_CARD + COMPACT_GAP)))
}

/** 向上找最近的可滚动祖先；找不到回退到 documentElement */
function findScrollParent(el: HTMLElement | null): HTMLElement {
  let cur: HTMLElement | null = el?.parentElement ?? null
  while (cur && cur !== document.body) {
    const style = window.getComputedStyle(cur)
    const oy = style.overflowY
    if (oy === 'auto' || oy === 'scroll') return cur
    cur = cur.parentElement
  }
  return document.scrollingElement as HTMLElement ?? document.documentElement
}

export function VirtualBookmarkGrid({ items, threshold = 60 }: Props) {
  const cardSize = useBookmarkStore((s) => s.settings.cardSize)
  const isCompact = cardSize === 'compact'
  const parentRef = useRef<HTMLDivElement | null>(null)
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)
  const [cols, setCols] = useState<number>(() => {
    if (typeof window === 'undefined') return 5
    return isCompact
      ? compactColsForWidth(window.innerWidth)
      : colsForWidth(window.innerWidth)
  })

  // 找滚动父节点（mount 后 DOM 才有）
  useLayoutEffect(() => {
    setScrollEl(findScrollParent(parentRef.current))
  }, [])

  // 监听容器宽度变化推导列数；isCompact 切换时立即用最新策略复算一次
  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const recalc = (w: number) =>
      setCols(isCompact ? compactColsForWidth(w) : colsForWidth(w))
    recalc(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([entry]) => recalc(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [isCompact])

  const enabled = items.length >= threshold

  const rows = useMemo(() => {
    if (!enabled) return []
    const out: VirtualBookmarkItem[][] = []
    for (let i = 0; i < items.length; i += cols) {
      out.push(items.slice(i, i + cols))
    }
    return out
  }, [items, cols, enabled])

  // 行间距与 BookmarkGrid 一致：compact gap-2 / 其它 gap-3
  // 行高估算给个保守初值，measureElement 之后会自动校正
  const ROW_GAP = isCompact ? 8 : 12
  const ESTIMATED_ROW_HEIGHT = isCompact ? 112 : 140

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ESTIMATED_ROW_HEIGHT + ROW_GAP,
    overscan: 4,
    measureElement: (el) => el.getBoundingClientRect().height + ROW_GAP,
  })

  // 列数变化时缓存失效（行宽度变了，单卡可能高度也变）
  useEffect(() => {
    virtualizer.measure()
  }, [cols, virtualizer])

  // 小集合直接平铺，省去 windowing 复杂度
  if (!enabled) {
    return (
      <div
        className={
          isCompact
            ? 'grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2'
            : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3'
        }
      >
        {items.map(({ card, categoryPath, dupCount, dupCategoryPaths }) => (
          <BookmarkCardItem
            key={card.id}
            card={card}
            draggable={false}
            searchMeta={{ categoryPath, dupCount, dupCategoryPaths }}
          />
        ))}
      </div>
    )
  }

  const virtualRows = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  return (
    <div ref={parentRef} className="relative" style={{ height: totalSize }}>
      {virtualRows.map((vr) => {
        const row = rows[vr.index]
        return (
          <div
            key={vr.key}
            data-index={vr.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 right-0"
            style={{ transform: `translateY(${vr.start}px)` }}
          >
            <div
              className={isCompact ? 'grid gap-2' : 'grid gap-3'}
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {row.map(({ card, categoryPath, dupCount, dupCategoryPaths }) => (
                <BookmarkCardItem
                  key={card.id}
                  card={card}
                  draggable={false}
                  searchMeta={{ categoryPath, dupCount, dupCategoryPaths }}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
