import { create } from 'zustand'

/**
 * 跨容器拖拽提示 store（v0.21.0 跨文件夹拖拽用）。
 *
 * 背景：项目里有多个独立的 DndContext（侧栏分类树 / 每个 CategorySection 的卡片网格 /
 * 文件夹网格）。dnd-kit 各自封闭，无法直接识别"把一个 DndContext 内的元素拖到另一个
 * DndContext 的 droppable 上"。我们用一个轻量旁路：
 *
 * - 卡片所在的 CategorySection 在 onDragMove 中用 elementFromPoint 反查鼠标下方
 *   的 [data-card-drop-target] 元素，写到本 store
 * - FolderCard / 侧栏 SortableSidebarRow 订阅 hoverCategoryId 显示蓝色高亮
 * - onDragEnd 时若 store 有值，调 useBookmarkStore.moveCard / moveCategory 跨级移动
 * - onDragCancel / onDragEnd 都要清空，避免脏状态遗留到下一次拖拽
 *
 * 为什么不放到 useBookmarkStore：拖拽提示是纯 UI ephemeral 状态，
 * 不该污染主数据 store，也避免不必要的全局 re-render。
 */
interface DropHintStore {
  /**
   * 当前鼠标悬停的"目标分类 id"。
   * - null：未悬停在任何文件夹上（落点不是有效跨分类目标）
   * - string：悬停在该分类对应的 FolderCard 或侧栏行上
   *
   * 注意：源 categoryId（或源 folderId 自身 + descendants）由调用方过滤，
   * 进入本 store 的值一定是"合法的跨级目标"，可直接用于高亮。
   */
  hoverCategoryId: string | null
  set: (id: string | null) => void
}

export const useDropHintStore = create<DropHintStore>((set) => ({
  hoverCategoryId: null,
  set: (id) => set({ hoverCategoryId: id }),
}))

/**
 * 在屏幕坐标 (x, y) 反查最近的 `data-card-drop-target` 元素并返回其 id。
 *
 * dnd-kit 拖拽期间，被拖元素被 CSS transform 移到指针下方但仍接收 pointer events，
 * `document.elementFromPoint` 会先命中它本身。这里通过临时把 active 元素
 * `pointer-events: none` 让它"透明"，调用后立刻还原。
 *
 * @param x         屏幕 X 坐标（一般取 active.rect.translated 的中心）
 * @param y         屏幕 Y 坐标
 * @param activeSelector  定位"被拖元素"的 CSS 选择器，例如
 *                        `[data-dnd-card="${cardId}"]` 或 `[data-dnd-folder="${folderId}"]`
 * @returns drop target 的 categoryId；未命中返回 null
 */
export function findDropTargetAt(
  x: number,
  y: number,
  activeSelector: string,
): string | null {
  const activeEl = document.querySelector(activeSelector) as HTMLElement | null
  let prev = ''
  if (activeEl) {
    prev = activeEl.style.pointerEvents
    activeEl.style.pointerEvents = 'none'
  }
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  if (activeEl) activeEl.style.pointerEvents = prev
  if (!el) return null
  const dropEl = el.closest('[data-card-drop-target]') as HTMLElement | null
  return dropEl?.getAttribute('data-card-drop-target') ?? null
}
