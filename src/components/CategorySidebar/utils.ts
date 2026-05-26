import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from '../../types/bookmark'

/* ──────────────────────────────────────────────────────────────────────
 * CategorySidebar 内共享的小工具与类型。
 * ────────────────────────────────────────────────────────────────────── */

/** 拖到一行的"上 30% / 中 40% / 下 30%"分别表示三种放置语义 */
export type DropPosition = 'before' | 'after' | 'inside'

export interface OverInfo {
  id: string
  position: DropPosition
}

/** 把任意 width 收敛到 [SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX] 范围内 */
export function clampSidebarWidth(w: number): number {
  if (!Number.isFinite(w)) return SIDEBAR_WIDTH_DEFAULT
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, Math.round(w)))
}
