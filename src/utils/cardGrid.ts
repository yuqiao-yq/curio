import type { CSSProperties } from 'react'
import {
  CARD_HEIGHT_MAX_PX,
  CARD_HEIGHT_MIN_PX,
  CARD_WIDTH_FIXED_DEFAULT,
  CARD_WIDTH_FLUID_MAX_DEFAULT,
  CARD_WIDTH_FLUID_MIN_DEFAULT,
  CARD_WIDTH_MAX_PX,
  CARD_WIDTH_MIN_PX,
  CUSTOM_H_MIN_DEFAULT,
  CUSTOM_W_MAX_DEFAULT,
  CUSTOM_W_MIN_DEFAULT,
  type UserSettings,
} from '../types/bookmark'

/**
 * 工具函数只读这几个字段，订阅它们即可，不必拿完整 settings；
 * 这样消费方（BookmarkGrid / VirtualBookmarkGrid）可以用细粒度 zustand selector
 * 避免无关 settings 变更引发 re-render。
 */
export type GridSettings = Pick<
  UserSettings,
  | 'cardSize'
  | 'cardWidthMode'
  | 'cardWidthMin'
  | 'cardWidthMax'
  | 'cardWidthFixed'
  | 'cardCustomWidthMin'
  | 'cardCustomWidthMax'
>

/* ─────────────────────────────────────────────────────────────
 * 卡片网格布局：根据 settings.cardSize / cardWidthMode / cardCustom* 推导
 *   - 非虚拟化路径用的 className + CSS variable style（BookmarkGrid + VirtualBookmarkGrid 非虚拟分支）
 *   - 虚拟化路径用的 cols 数 + 单行 gridTemplateColumns（VirtualBookmarkGrid 虚拟分支自己排行）
 *
 * 矩阵：
 *   compact  → 固定 112px auto-fill，忽略其它字段
 *   standard → 按 cardWidthMode 走 responsive(默认) / fluid / fixed
 *   custom   → 走 cardCustomWidthMin/Max 的 auto-fill minmax，与 standard.fluid/fixed 正交
 * ───────────────────────────────────────────────────────────── */

/** Tailwind 默认断点：sm=640 md=768 lg=1024 xl=1280；列数 2→3→4→5→6 */
function responsiveColsForWidth(w: number): number {
  if (w >= 1280) return 6
  if (w >= 1024) return 5
  if (w >= 768) return 4
  if (w >= 640) return 3
  return 2
}

const COMPACT_CARD = 112
const COMPACT_GAP = 8

function compactColsForWidth(w: number): number {
  return Math.max(1, Math.floor((w + COMPACT_GAP) / (COMPACT_CARD + COMPACT_GAP)))
}

/** 把任意输入夹到合法卡片宽度范围内 */
export function clampCardWidth(v: number | undefined, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  if (n < CARD_WIDTH_MIN_PX) return CARD_WIDTH_MIN_PX
  if (n > CARD_WIDTH_MAX_PX) return CARD_WIDTH_MAX_PX
  return Math.round(n)
}

/** 把任意输入夹到合法卡片高度范围内（custom 档专用） */
export function clampCardHeight(v: number | undefined, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback
  if (n < CARD_HEIGHT_MIN_PX) return CARD_HEIGHT_MIN_PX
  if (n > CARD_HEIGHT_MAX_PX) return CARD_HEIGHT_MAX_PX
  return Math.round(n)
}

/** 取 fluid 模式下的 [min, max]（保证 min <= max） */
export function resolveFluidRange(settings: GridSettings): { min: number; max: number } {
  const min = clampCardWidth(settings.cardWidthMin, CARD_WIDTH_FLUID_MIN_DEFAULT)
  const maxRaw = clampCardWidth(settings.cardWidthMax, CARD_WIDTH_FLUID_MAX_DEFAULT)
  // min > max 时把 max 抬到 min，避免 minmax(200px, 140px) 这种非法值
  return { min, max: Math.max(min, maxRaw) }
}

/** 取 fixed 模式下的固定卡片宽度 */
export function resolveFixedWidth(settings: GridSettings): number {
  return clampCardWidth(settings.cardWidthFixed, CARD_WIDTH_FIXED_DEFAULT)
}

/** 取 custom 档的宽度范围 [min, max]（min === max 时视觉退化为固定宽） */
export function resolveCustomWidthRange(settings: GridSettings): { min: number; max: number } {
  const min = clampCardWidth(settings.cardCustomWidthMin, CUSTOM_W_MIN_DEFAULT)
  const maxRaw = clampCardWidth(settings.cardCustomWidthMax, CUSTOM_W_MAX_DEFAULT)
  return { min, max: Math.max(min, maxRaw) }
}

/**
 * 给非虚拟化的网格容器算 className + inline style。
 * 直接套到外层 `<div className={...} style={...}>`。
 */
export function getGridClassAndStyle(settings: GridSettings): {
  className: string
  style?: CSSProperties
} {
  if (settings.cardSize === 'compact') {
    return { className: 'grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2' }
  }
  if (settings.cardSize === 'custom') {
    const { min, max } = resolveCustomWidthRange(settings)
    return {
      className: 'curio-grid-custom',
      style: {
        ['--curio-card-min-w' as unknown as keyof CSSProperties]: `${min}px`,
        ['--curio-card-max-w' as unknown as keyof CSSProperties]: `${max}px`,
      } as CSSProperties,
    }
  }
  // standard
  const mode = settings.cardWidthMode ?? 'responsive'
  if (mode === 'fluid') {
    const { min, max } = resolveFluidRange(settings)
    return {
      className: 'curio-grid-fluid',
      style: {
        // CSS 变量驱动 .curio-grid-fluid 的 minmax(...)；通过类型断言绕开 React CSSProperties 不接受任意 -- 变量的问题
        ['--curio-card-min-w' as unknown as keyof CSSProperties]: `${min}px`,
        ['--curio-card-max-w' as unknown as keyof CSSProperties]: `${max}px`,
      } as CSSProperties,
    }
  }
  if (mode === 'fixed') {
    const w = resolveFixedWidth(settings)
    return {
      className: 'curio-grid-fixed',
      style: {
        ['--curio-card-fixed-w' as unknown as keyof CSSProperties]: `${w}px`,
      } as CSSProperties,
    }
  }
  return {
    className: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3',
  }
}

/**
 * 给虚拟化路径算「单行布局」：列数 + 行 gap + 单行 grid-template-columns。
 * VirtualBookmarkGrid 把扁平 items 按 cols 切片成 rows，每行套一个 grid。
 *
 * @param settings  当前用户设置
 * @param containerWidth  网格容器的实际像素宽度（ResizeObserver 测得）
 */
export function getVirtualRowLayout(
  settings: GridSettings,
  containerWidth: number,
): {
  cols: number
  rowGap: number
  /** 直接塞到行 div 的 style.gridTemplateColumns */
  gridTemplateColumns: string
  /** measureElement 之前给 virtualizer 的初始行高估算 */
  estimatedRowHeight: number
} {
  if (settings.cardSize === 'compact') {
    const cols = compactColsForWidth(containerWidth)
    return {
      cols,
      rowGap: COMPACT_GAP,
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      estimatedRowHeight: 112,
    }
  }
  if (settings.cardSize === 'custom') {
    const { min, max } = resolveCustomWidthRange(settings)
    const gap = 12
    // 与 .curio-grid-custom 的 auto-fill 一致：列数 = ⌊(容器 + gap) / (min + gap)⌋
    const cols = Math.max(1, Math.floor((containerWidth + gap) / (min + gap)))
    return {
      cols,
      rowGap: gap,
      gridTemplateColumns: `repeat(${cols}, minmax(${min}px, ${max}px))`,
      // 高度由卡片自身 inline minHeight/maxHeight 决定，给个中间值方便 virtualizer 估算
      estimatedRowHeight: clampCardHeight(undefined, CUSTOM_H_MIN_DEFAULT),
    }
  }
  // standard
  const mode = settings.cardWidthMode ?? 'responsive'
  if (mode === 'fixed') {
    const w = resolveFixedWidth(settings)
    // 与 .curio-grid-fixed 的 auto-fill 一致：floor((containerWidth + gap) / (cardWidth + gap))
    const gap = 12
    const cols = Math.max(1, Math.floor((containerWidth + gap) / (w + gap)))
    return {
      cols,
      rowGap: gap,
      // 固定列宽 = 卡片宽，与 .curio-grid-fixed 视觉一致
      gridTemplateColumns: `repeat(${cols}, ${w}px)`,
      estimatedRowHeight: 140,
    }
  }
  if (mode === 'fluid') {
    const cols = responsiveColsForWidth(containerWidth)
    const { min, max } = resolveFluidRange(settings)
    return {
      cols,
      rowGap: 12,
      gridTemplateColumns: `repeat(${cols}, minmax(${min}px, ${max}px))`,
      estimatedRowHeight: 140,
    }
  }
  // responsive（默认 / 历史行为）
  const cols = responsiveColsForWidth(containerWidth)
  return {
    cols,
    rowGap: 12,
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    estimatedRowHeight: 140,
  }
}
