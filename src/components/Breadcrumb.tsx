import { useMemo } from 'react'
import type { Category } from '../types/bookmark'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { IconView } from '../utils/icon'

/**
 * 面包屑栏（常驻显示）
 *
 * 仅展示「从根到当前分类的完整路径」，路径中除最后一项外可点击跳转层级。
 *
 * 历史包袱：之前右侧还挂着一个独立的"搜索书签"输入框，与顶部网页搜索分裂。
 * 现已统一到顶部 WebSearchBox（默认本地，@web 走网页），这里只剩纯路径。
 *
 * 当前没有任何选中分类时不渲染（外层不会调用）。
 */
export function Breadcrumb() {
  const categories = useBookmarkStore((s) => s.categories)
  const activeId = useBookmarkStore((s) => s.activeCategoryId)
  const setActive = useBookmarkStore((s) => s.setActiveCategory)

  // 从当前分类向上追溯，构建路径数组（从根到当前）
  const path = useMemo<Category[]>(() => {
    if (!activeId) return []
    const map = new Map(categories.map((c) => [c.id, c]))
    const result: Category[] = []
    let cur = map.get(activeId)
    while (cur) {
      result.unshift(cur)
      cur = cur.parentId ? map.get(cur.parentId) : undefined
    }
    return result
  }, [activeId, categories])

  if (path.length === 0) return null

  return (
    <nav className="flex items-center gap-1 text-sm flex-wrap min-w-0 px-1 mb-4">
      {path.map((cat, i) => {
        const isLast = i === path.length - 1
        return (
          <span key={cat.id} className="flex items-center gap-1">
            {i > 0 && (
              <span className="text-slate-300 dark:text-slate-600 select-none">›</span>
            )}
            {isLast ? (
              <span className="font-medium text-slate-700 dark:text-slate-200 truncate inline-flex items-center">
                {cat.icon ? (
                  <IconView
                    value={cat.icon}
                    boxed
                    boxClassName="w-5 h-5 mr-1"
                    emojiClassName="text-xs leading-none"
                    imgClassName="w-3.5 h-3.5 rounded-sm object-contain"
                  />
                ) : null}
                {cat.name}
              </span>
            ) : (
              <button
                onClick={() => setActive(cat.id)}
                className="text-brand hover:text-brand-600 hover:underline transition-colors truncate"
              >
                {cat.name}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}
