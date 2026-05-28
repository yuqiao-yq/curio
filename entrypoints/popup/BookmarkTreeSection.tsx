import { useMemo, useState } from 'react'
import { browser } from 'wxt/browser'
import type { BookmarkCard, Category } from '../../src/types/bookmark'
import { cn } from '../../src/utils/cn'
import { FaviconImg } from '../../src/components/FaviconImg'
import { IconView } from '../../src/utils/icon'

/**
 * Popup「浏览书签」section
 *
 * - 树形结构展示所有 categories（含层级）+ 各 category 下的 cards
 * - 默认整个 section 折叠（避免 popup 一开就很长）
 * - 展开后所有分类默认折叠，用户按需展开
 * - 搜索时自动展开所有匹配分类
 * - 点击书签 → 新开 tab + 关闭 popup
 *
 * 节点视觉规则：
 * - 分类：左侧 ▸/▾ + emoji（缺省 📁）+ 名字 + 右侧"含书签数"
 * - 书签：缩进对齐 + favicon + 标题（hover 显示完整 URL）
 *
 * 高度限制：树容器 max-h 320px + 内部滚动；popup 不会被撑爆。
 */

interface CategoryNode {
  type: 'category'
  id: string
  name: string
  icon?: string
  children: TreeNode[]
}
interface CardNode {
  type: 'card'
  id: string
  name: string
  url: string
}
type TreeNode = CategoryNode | CardNode

/** 把扁平的 categories + cards 构建成层级树（按 order 排序，子分类在前、卡片在后） */
function buildTree(
  categories: Category[],
  cards: BookmarkCard[],
): CategoryNode[] {
  const subCatsByParent = new Map<string, Category[]>()
  for (const c of categories) {
    const k = c.parentId || ''
    const list = subCatsByParent.get(k) ?? []
    list.push(c)
    subCatsByParent.set(k, list)
  }
  for (const list of subCatsByParent.values()) {
    list.sort((a, b) => a.order - b.order)
  }

  const cardsByCat = new Map<string, BookmarkCard[]>()
  for (const c of cards) {
    const list = cardsByCat.get(c.categoryId) ?? []
    list.push(c)
    cardsByCat.set(c.categoryId, list)
  }
  for (const list of cardsByCat.values()) {
    list.sort((a, b) => a.order - b.order)
  }

  function build(parentKey: string): CategoryNode[] {
    const cats = subCatsByParent.get(parentKey) ?? []
    return cats.map<CategoryNode>((cat) => {
      const subCatNodes = build(cat.id)
      const cardNodes: CardNode[] = (cardsByCat.get(cat.id) ?? []).map(
        (card) => ({
          type: 'card',
          id: card.id,
          name: card.title || card.url,
          url: card.url,
        }),
      )
      return {
        type: 'category',
        id: cat.id,
        name: cat.name,
        icon: cat.icon,
        children: [...subCatNodes, ...cardNodes],
      }
    })
  }

  return build('')
}

/** 递归数 category 下所有书签（含子分类） */
function countCards(node: CategoryNode): number {
  let sum = 0
  for (const child of node.children) {
    if (child.type === 'card') sum++
    else sum += countCards(child)
  }
  return sum
}

interface Props {
  categories: Category[]
  cards: BookmarkCard[]
}

export function BookmarkTreeSection({ categories, cards }: Props) {
  // 整个 section 的折叠状态（默认关，避免 popup 撑高）
  const [open, setOpen] = useState(false)
  // 各 category 的展开状态（用 Set 维护）
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')

  const tree = useMemo(() => buildTree(categories, cards), [categories, cards])

  // 搜索过滤：保留 name/url 匹配的卡 + 含匹配后代的分类
  const filteredTree = useMemo<CategoryNode[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tree
    function filter(nodes: TreeNode[]): TreeNode[] {
      const result: TreeNode[] = []
      for (const n of nodes) {
        if (n.type === 'card') {
          if (
            n.name.toLowerCase().includes(q) ||
            n.url.toLowerCase().includes(q)
          ) {
            result.push(n)
          }
        } else {
          const subFiltered = filter(n.children)
          // 分类名命中 → 整个子树带出（更直观）；否则只带出过滤后的子树
          if (n.name.toLowerCase().includes(q)) {
            result.push({ ...n, children: n.children })
          } else if (subFiltered.length > 0) {
            result.push({ ...n, children: subFiltered })
          }
        }
      }
      return result
    }
    return filter(tree) as CategoryNode[]
  }, [tree, query])

  // 搜索态下自动展开所有可见分类，省得用户手动点
  const effectiveExpanded = useMemo(() => {
    if (!query.trim()) return expanded
    const ids = new Set<string>()
    function collect(nodes: TreeNode[]) {
      for (const n of nodes) {
        if (n.type === 'category') {
          ids.add(n.id)
          collect(n.children)
        }
      }
    }
    collect(filteredTree)
    return ids
  }, [query, expanded, filteredTree])

  const toggleCategory = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleOpenUrl = (url: string) => {
    void browser.tabs.create({ url, active: true })
    // 打开后关闭 popup，避免用户还要手动关
    window.close()
  }

  const totalCards = cards.length
  const totalCategories = categories.length
  const hasData = totalCategories > 0 || totalCards > 0

  return (
    <section className="border-t border-slate-200 dark:border-slate-700">
      {/* Section header（可折叠） */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full flex items-center justify-between gap-2 px-3 py-2',
          'text-xs font-semibold text-slate-600 dark:text-slate-300',
          'hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors',
        )}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span aria-hidden>📚</span>
          <span>浏览书签</span>
          {hasData && (
            <span className="text-[10px] text-slate-400 font-normal tabular-nums">
              {totalCategories} 分类 · {totalCards} 书签
            </span>
          )}
        </span>
        <span aria-hidden className="text-slate-400 text-[10px]">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-2">
          {!hasData ? (
            <div className="text-xs text-slate-400 py-3 text-center">
              暂无书签，先打开新标签页创建一些吧
            </div>
          ) : (
            <>
              {/* 搜索框 */}
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索书签 / 分类…"
                className={cn(
                  'w-full h-7 px-2 text-xs rounded',
                  'bg-white dark:bg-slate-900',
                  'border border-slate-200 dark:border-slate-700',
                  'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
                  'placeholder:text-slate-400',
                )}
              />

              {/* 树容器 */}
              <div
                className={cn(
                  'border border-slate-200 dark:border-slate-700 rounded',
                  'bg-slate-50/60 dark:bg-slate-800/40',
                  'max-h-[320px] overflow-y-auto py-0.5',
                )}
              >
                {filteredTree.length === 0 ? (
                  <div className="text-xs text-slate-400 py-3 text-center">
                    没有匹配的书签
                  </div>
                ) : (
                  filteredTree.map((node) => (
                    <TreeRow
                      key={node.id}
                      node={node}
                      depth={0}
                      expanded={effectiveExpanded}
                      onToggle={toggleCategory}
                      onOpenUrl={handleOpenUrl}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

interface TreeRowProps {
  node: TreeNode
  depth: number
  expanded: Set<string>
  onToggle: (id: string) => void
  onOpenUrl: (url: string) => void
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  onOpenUrl,
}: TreeRowProps) {
  if (node.type === 'card') {
    return (
      <button
        type="button"
        onClick={() => onOpenUrl(node.url)}
        title={node.url}
        // 缩进对齐：每层 14px + 26px 让 favicon 与分类 emoji 视觉上同列
        style={{ paddingLeft: depth * 14 + 26 }}
        className={cn(
          'w-full flex items-center gap-2 py-1 pr-2 text-left',
          'text-xs text-slate-700 dark:text-slate-200',
          'hover:bg-brand/10 hover:text-brand transition-colors',
        )}
      >
        <FaviconImg
          url={node.url}
          size={14}
          className="w-3.5 h-3.5 rounded-sm shrink-0"
          fallbackClassName="w-3.5 h-3.5 rounded-sm text-[8px] shrink-0"
        />
        <span className="truncate flex-1">{node.name}</span>
      </button>
    )
  }

  const isExpanded = expanded.has(node.id)
  const hasChildren = node.children.length > 0
  const cardCount = countCards(node)

  return (
    <>
      <button
        type="button"
        onClick={() => hasChildren && onToggle(node.id)}
        disabled={!hasChildren}
        style={{ paddingLeft: depth * 14 + 4 }}
        className={cn(
          'w-full flex items-center gap-1.5 py-1 pr-2 text-left',
          'text-xs font-medium text-slate-700 dark:text-slate-200',
          hasChildren &&
            'hover:bg-slate-100 dark:hover:bg-slate-700/40 transition-colors',
          !hasChildren && 'cursor-default opacity-60',
        )}
      >
        <span
          aria-hidden
          className="w-3 text-slate-400 text-[10px] text-center leading-none"
        >
          {hasChildren ? (isExpanded ? '▾' : '▸') : ''}
        </span>
        {/*
          分类 icon 兼容 emoji / 图片 URL / data:image base64 三种存储形态
          —— 直接渲染字符串会把 base64 文本喷出来，必须走 IconView
        */}
        <span
          aria-hidden
          className="w-4 inline-flex items-center justify-center shrink-0"
        >
          <IconView
            value={node.icon}
            fallback="📁"
            emojiClassName="text-[12px] leading-none"
            imgClassName="w-3.5 h-3.5 rounded-sm object-contain"
          />
        </span>
        <span className="truncate flex-1">{node.name}</span>
        {cardCount > 0 && (
          <span className="shrink-0 text-[10px] text-slate-400 tabular-nums">
            {cardCount}
          </span>
        )}
      </button>
      {isExpanded &&
        node.children.map((child) => (
          <TreeRow
            key={`${child.type}-${child.id}`}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onOpenUrl={onOpenUrl}
          />
        ))}
    </>
  )
}
