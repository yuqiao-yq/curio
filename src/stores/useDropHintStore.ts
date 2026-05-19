import { create } from 'zustand'

/**
 * 跨容器拖拽提示 store。
 *
 * 项目里有多个独立的 DndContext（侧栏分类树 / 每个 CategorySection 的卡片网格 /
 * 文件夹网格）。dnd-kit 各自封闭，无法识别"跨 DndContext 拖拽"。
 *
 * 旁路方案：
 * - 主区拖书签时，外层 useEffect 监听全局 mousemove，按指针位置反查
 *   `[data-card-drop-target]` 元素，写入 hoverCategoryId
 * - FolderCard / 侧栏 SortableSidebarRow / section header 订阅 hoverCategoryId
 *   显示蓝色高亮
 * - onDragEnd 时根据 hoverCategoryId 调用 moveCard 跨级移动
 */
interface DropHintStore {
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
 * v0.21.11 重写为"遍历 + BCR 包含检测"方案，彻底放弃 elementsFromPoint：
 * elementsFromPoint 在 DragOverlay 浮层 + portal + 复杂 z-stack 场景下行为
 * 难以预期，多次尝试都没修对（v0.21.6/v0.21.7/v0.21.8）。
 *
 * 新方案：
 * - querySelectorAll 拿到所有 `[data-card-drop-target]` 元素
 * - 对每个调 getBoundingClientRect 检查 (x, y) 是否在 rect 内
 * - 命中多个时取**面积最小**的，处理嵌套场景（如侧栏父分类行 vs 子分类行）
 * - 性能：通常分类总数 < 50，每次 mousemove ≤ 50 次 BCR，60Hz 完全够用
 */
export function findDropTargetAt(x: number, y: number): string | null {
  const els = document.querySelectorAll('[data-card-drop-target]')
  let best: { id: string; area: number } | null = null
  for (const el of Array.from(els)) {
    const id = (el as HTMLElement).getAttribute('data-card-drop-target')
    if (!id) continue
    const rect = (el as HTMLElement).getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    if (x < rect.left || x > rect.right) continue
    if (y < rect.top || y > rect.bottom) continue
    const area = rect.width * rect.height
    if (!best || area < best.area) {
      best = { id, area }
    }
  }
  return best?.id ?? null
}
