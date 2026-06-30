import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { BookmarkCard } from '../types/bookmark'
import { BookmarkCardItem } from './BookmarkCardItem'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { getGridClassAndStyle, getVirtualRowLayout } from '../utils/cardGrid'

/* ─────────────────────────────────────────────────────────────
 * VirtualBookmarkGrid（P0-1）
 *
 * 仅在「搜索结果」这类大型扁平卡片列上使用：
 *   - 1000+ 卡片时，老实 render 全量 DOM 会让首帧 / 滚动卡顿（CardItem ~720 LOC）
 *   - 分类内部按 section 展示，单 section 通常 <100 卡，不走这里
 *
 * 实现：
 *   - 行级虚拟化（每行 N 列，N 由容器宽度 + 当前 cardSize / cardWidthMode 推导）
 *   - 滚动容器自动向上找最近的 overflow-y-auto/scroll 祖先（这里是
 *     <main className="overflow-y-auto"> in App.tsx）
 *   - 卡片高度用 measureElement 动态测量，不写死，避免不同视觉密度下高度漂移
 *   - overscan=4 行：滚动时预渲染上下 4 行，体感无白屏
 *   - 列数变化（窗口 resize 跨越断点 / 切换宽度模式）时强制 reset 测量缓存
 *
 * 与原始 `<div className={GRID_COLS}>` 行为完全一致；标准档新增 fluid / fixed
 * 模式后，列数与 gridTemplateColumns 全部委托给 utils/cardGrid。
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
  // 仅订阅参与布局的 5 个字段，避免无关 settings 改动触发 re-render
  const cardSize = useBookmarkStore((s) => s.settings.cardSize)
  const cardWidthMode = useBookmarkStore((s) => s.settings.cardWidthMode)
  const cardWidthMin = useBookmarkStore((s) => s.settings.cardWidthMin)
  const cardWidthMax = useBookmarkStore((s) => s.settings.cardWidthMax)
  const cardWidthFixed = useBookmarkStore((s) => s.settings.cardWidthFixed)
  const gridSettings = useMemo(
    () => ({ cardSize, cardWidthMode, cardWidthMin, cardWidthMax, cardWidthFixed }),
    [cardSize, cardWidthMode, cardWidthMin, cardWidthMax, cardWidthFixed],
  )

  const parentRef = useRef<HTMLDivElement | null>(null)
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null)

  // 容器宽 → 用 utils/cardGrid 推 cols / gap / template
  const [layout, setLayout] = useState(() =>
    getVirtualRowLayout(
      gridSettings,
      typeof window === 'undefined' ? 1280 : window.innerWidth,
    ),
  )

  // 找滚动父节点（mount 后 DOM 才有）
  useLayoutEffect(() => {
    setScrollEl(findScrollParent(parentRef.current))
  }, [])

  // 监听容器宽度变化推导列数；gridSettings 变化时立即用最新策略复算一次
  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const recalc = (w: number) => setLayout(getVirtualRowLayout(gridSettings, w))
    recalc(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(([entry]) => recalc(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [gridSettings])

  const enabled = items.length >= threshold
  const cols = layout.cols

  const rows = useMemo(() => {
    if (!enabled) return []
    const out: VirtualBookmarkItem[][] = []
    for (let i = 0; i < items.length; i += cols) {
      out.push(items.slice(i, i + cols))
    }
    return out
  }, [items, cols, enabled])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => layout.estimatedRowHeight + layout.rowGap,
    overscan: 4,
    measureElement: (el) => el.getBoundingClientRect().height + layout.rowGap,
  })

  // 列数 / 行 gap 变化时缓存失效（行宽度变了，单卡可能高度也变）
  useEffect(() => {
    virtualizer.measure()
  }, [cols, layout.rowGap, virtualizer])

  // 小集合直接平铺，省去 windowing 复杂度
  if (!enabled) {
    const grid = getGridClassAndStyle(gridSettings)
    return (
      <div className={grid.className} style={grid.style}>
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
              className="grid"
              style={{
                gap: `${layout.rowGap}px`,
                gridTemplateColumns: layout.gridTemplateColumns,
              }}
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
