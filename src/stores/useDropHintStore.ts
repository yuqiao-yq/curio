import { create } from 'zustand'

/**
 * 跨容器拖拽提示 store（v0.20.3 跨文件夹拖拽用）。
 *
 * 背景：项目里有多个独立的 DndContext（侧栏分类树 / 每个 CategorySection 的卡片网格）。
 * dnd-kit 各自封闭，无法直接识别"把一个 DndContext 内的元素拖到另一个 DndContext
 * 的 droppable 上"。我们用一个轻量旁路：
 *
 * - 卡片所在的 CategorySection 在 onDragMove 中用 elementFromPoint 反查鼠标下方
 *   的 [data-card-drop-target] 元素，写到本 store
 * - FolderCard / 侧栏 SortableSidebarRow 订阅 hoverCategoryId 显示蓝色高亮
 * - onDragEnd 时若 store 有值，调 useBookmarkStore.moveCard(...) 跨分类移动
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
   * 注意：源卡片本身所在的 categoryId 由调用方（CategorySection）过滤掉，
   * 进入本 store 的值一定 ≠ 源 categoryId，可直接用于高亮。
   */
  hoverCategoryId: string | null
  set: (id: string | null) => void
}

export const useDropHintStore = create<DropHintStore>((set) => ({
  hoverCategoryId: null,
  set: (id) => set({ hoverCategoryId: id }),
}))
