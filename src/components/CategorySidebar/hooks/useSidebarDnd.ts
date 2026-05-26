import { useRef, useState } from 'react'
import {
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
} from '@dnd-kit/core'
import type { Category } from '../../../types/bookmark'
import { collectDescendantIds } from '../../../stores/useBookmarkStore/helpers'
import type { OverInfo } from '../utils'

/* ──────────────────────────────────────────────────────────────────────
 * 侧栏分类树的拖拽逻辑。
 *
 * - 距离阈值 6px：避免点击进入分类时误触发拖拽
 * - 拖动时持续计算"指针所在行的位置"——
 *   行上 30% → before，下 30% → after，中间 40% → inside（成为子节点）
 * - 校验循环引用：禁止把节点拖到自己的后代上
 * ────────────────────────────────────────────────────────────────────── */

export function useSidebarDnd(
  categories: Category[],
  moveCategory: (
    activeId: string,
    targetParentId: string | undefined,
    targetIndex: number,
  ) => Promise<void>,
  /** 嵌入后自动展开目标节点，让放进去的子节点立刻可见 */
  onExpandAfterMove: (id: string) => void,
) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  // 拖拽过程中目标行 + 放置位置（before/after/inside）
  // ref 用于 handleDragEnd 时拿到最新值（避免闭包 stale）
  const [overInfo, setOverInfo] = useState<OverInfo | null>(null)
  const overInfoRef = useRef<OverInfo | null>(null)
  const updateOverInfo = (next: OverInfo | null) => {
    const prev = overInfoRef.current
    if (prev === null && next === null) return
    if (
      prev &&
      next &&
      prev.id === next.id &&
      prev.position === next.position
    ) {
      return
    }
    overInfoRef.current = next
    setOverInfo(next)
  }

  const handleDragMove = (e: DragMoveEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) {
      updateOverInfo(null)
      return
    }
    const activeId = String(active.id)
    const overId = String(over.id)
    // 循环引用：禁止把节点拖到自己的后代上
    const desc = collectDescendantIds([activeId], categories)
    if (desc.has(overId)) {
      updateOverInfo(null)
      return
    }
    const activeRect = active.rect.current.translated
    const overRect = over.rect
    if (!activeRect || !overRect) return
    const center = activeRect.top + activeRect.height / 2
    const ratio = (center - overRect.top) / overRect.height
    let position: OverInfo['position']
    if (ratio < 0.3) position = 'before'
    else if (ratio > 0.7) position = 'after'
    else position = 'inside'
    updateOverInfo({ id: overId, position })
  }

  const handleDragEnd = (e: DragEndEvent) => {
    const info = overInfoRef.current
    updateOverInfo(null)
    if (!info || !e.active) return

    const activeId = String(e.active.id)
    const activeCat = categories.find((c) => c.id === activeId)
    const overCat = categories.find((c) => c.id === info.id)
    if (!activeCat || !overCat) return
    if (activeCat.id === overCat.id) return

    // 循环引用兜底校验（store 内也会再校验一次）
    const desc = collectDescendantIds([activeId], categories)
    if (desc.has(overCat.id)) return

    if (info.position === 'inside') {
      // 嵌入：移到 overCat 下作为最后一个子节点
      const childCount = categories.filter(
        (c) => c.parentId === overCat.id && c.id !== activeId,
      ).length
      void moveCategory(activeId, overCat.id, childCount)
      onExpandAfterMove(overCat.id)
      return
    }

    // before / after：插入到 overCat 所在层级（与 overCat 同父）
    const newParent = overCat.parentId
    const siblings = categories
      .filter(
        (c) => (c.parentId ?? '') === (newParent ?? '') && c.id !== activeId,
      )
      .sort((a, b) => a.order - b.order)
    const overIndex = siblings.findIndex((c) => c.id === overCat.id)
    if (overIndex < 0) return
    const newIndex = info.position === 'before' ? overIndex : overIndex + 1
    void moveCategory(activeId, newParent, newIndex)
  }

  const handleDragCancel = () => updateOverInfo(null)

  return {
    sensors,
    overInfo,
    handleDragMove,
    handleDragEnd,
    handleDragCancel,
  }
}
