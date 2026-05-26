import { useMemo, useState } from 'react'
import type { Category } from '../../../types/bookmark'
import { collectDescendantIds } from '../../../stores/useBookmarkStore/helpers'

/* ──────────────────────────────────────────────────────────────────────
 * 侧栏「批量选择 + 删除」模式。
 *
 * 进入模式时自动展开所有有子分类的节点：
 * 否则用户想批量勾选子级还要先一个个 ▶ 展开，体验割裂。
 * （展开副作用由调用方传入 expandIds 回调注入，使本 hook 不依赖
 *   useExpandTree 内部实现。）
 *
 * effectiveSelectedIds 是 selectedIds 展开到所有后代后的集合，用于子节点行渲染时
 * 显示"会被父一起删除"的浅色底 + 半选 checkbox。
 * ────────────────────────────────────────────────────────────────────── */

export function useSelectMode(
  categories: Category[],
  /** 进入选择模式时一次性展开所有"有子分类"的节点 */
  expandIds: (ids: string[]) => void,
) {
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const enterSelectMode = () => {
    setSelectMode(true)
    setSelectedIds(new Set())
    const parentIds = categories
      .filter((c) => categories.some((x) => x.parentId === c.id))
      .map((c) => c.id)
    if (parentIds.length > 0) expandIds(parentIds)
  }

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const toggleSelectAll = () =>
    setSelectedIds(
      // 全选 = 所有分类（含所有层级），不再仅限顶层
      selectedIds.size === categories.length
        ? new Set()
        : new Set(categories.map((c) => c.id)),
    )

  const allSelected =
    selectedIds.size === categories.length && categories.length > 0

  const effectiveSelectedIds = useMemo(() => {
    if (!selectMode || selectedIds.size === 0) return new Set<string>()
    return collectDescendantIds(Array.from(selectedIds), categories)
  }, [selectMode, selectedIds, categories])

  return {
    selectMode,
    selectedIds,
    effectiveSelectedIds,
    allSelected,
    enterSelectMode,
    exitSelectMode,
    toggleSelect,
    toggleSelectAll,
  }
}
