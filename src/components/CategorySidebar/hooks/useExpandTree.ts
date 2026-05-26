import { useState } from 'react'

/* ──────────────────────────────────────────────────────────────────────
 * 侧栏分类树的展开/折叠态。
 * 简单的 Set<id> + 几个增删 helper，提出去仅为复用 & 阅读清晰。
 * ────────────────────────────────────────────────────────────────────── */

export function useExpandTree() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const expand = (id: string) => {
    setExpanded((prev) => new Set(prev).add(id))
  }

  const collapseAll = () => setExpanded(new Set())
  const expandIds = (ids: string[]) => setExpanded(new Set(ids))

  return {
    expanded,
    toggleExpand,
    expand,
    collapseAll,
    expandIds,
  }
}
