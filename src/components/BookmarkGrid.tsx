import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import { useEffect, useMemo, useState } from 'react'
import type { BookmarkCard, Category } from '../types/bookmark'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { useDropHintStore, findDropTargetAt } from '../stores/useDropHintStore'
import { toast } from '../stores/useToastStore'
import { useAISettingsStore } from '../ai/useAISettingsStore'
import {
  searchByEmbedding,
  type EmbedSearchHit,
} from '../ai/services/embedder'
import { isAIConfigured } from '../ai/types'
import { BookmarkCardItem, CardDragPreview } from './BookmarkCardItem'
import { RecentSection } from './RecentSection'
import { promptDialog } from './Dialog'
import { cn } from '../utils/cn'

const GRID_COLS =
  'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3'

export function BookmarkGrid() {
  const allCards = useBookmarkStore((s) => s.cards)
  const allCategories = useBookmarkStore((s) => s.categories)
  const activeCategoryId = useBookmarkStore((s) => s.activeCategoryId)
  const setSearchKeyword = useBookmarkStore((s) => s.setSearchKeyword)
  const keyword = useBookmarkStore((s) => s.searchKeyword)

  // 搜索模式：全库搜索书签（不显示文件夹）
  const isSearching = keyword.trim().length > 0
  /**
   * 标签筛选模式：keyword 形如 "#xxx"
   * 由 WebSearchBox 在 tag mode 下、或 BookmarkCardItem / LabelsTab 的
   * tag chip 点击时通过 setSearchKeyword('#xxx') 触发。
   * 搜索时按 tag 精确匹配（大小写不敏感），不再走 title/url substring。
   */
  const tagFilter = useMemo(() => {
    const t = keyword.trim()
    if (!t.startsWith('#')) return null
    const tag = t.replace(/^#+/, '').trim()
    return tag.length > 0 ? tag : null
  }, [keyword])
  /**
   * AI 语义搜索模式：keyword 形如 "@ai xxx"
   * 由 WebSearchBox 在 ai mode 下写入；交给 AISearchView 异步检索 + 渲染。
   */
  const aiQuery = useMemo(() => {
    const t = keyword.trim()
    if (!/^@ai(\s+|$)/i.test(t)) return null
    const q = t.replace(/^@ai\s*/i, '').trim()
    return q.length > 0 ? q : null
  }, [keyword])

  /**
   * 搜索结果：先按关键字匹配命中所有 cards，再按 URL（小写）去重展示。
   *
   * 历史问题：浏览器导入时同一站点（如 google.com）通常会出现在
   * 「书签栏 / 收藏 / 最近」等多个文件夹中。原始实现直接把所有匹配
   * 平铺渲染，用户输入两个字母（如 "go"）会看到一长串"重复"卡片。
   *
   * 现在：
   * - tag 模式：按 tags 精确匹配（大小写不敏感）；不去重，让用户看到所有副本
   * - 普通模式：按 url 分组，每组只保留 updatedAt 最大者作为代表（认为它是最新维护的版本）
   * - 同时收集副本所在的所有分类路径，传给卡片以 chip + tooltip 展示
   * - 顶部增加结果统计，让用户知道「N 条独立结果（原始命中 M 条）」
   */
  const searchResult = useMemo(() => {
    if (!isSearching) return { items: [], rawCount: 0 }
    const matched = tagFilter
      ? allCards.filter((c) =>
          c.tags?.some((t) => t.toLowerCase() === tagFilter.toLowerCase()),
        )
      : (() => {
          const kw = keyword.trim().toLowerCase()
          return allCards.filter(
            (c) =>
              c.title.toLowerCase().includes(kw) ||
              c.url.toLowerCase().includes(kw),
          )
        })()
    // 分类路径快查表
    const catMap = new Map(allCategories.map((c) => [c.id, c]))
    const pathOf = (catId: string): string => {
      const parts: string[] = []
      let cur = catMap.get(catId)
      while (cur) {
        parts.unshift(cur.name)
        cur = cur.parentId ? catMap.get(cur.parentId) : undefined
      }
      return parts.join(' / ') || '(未分类)'
    }
    // 按 url 分组
    const byUrl = new Map<string, typeof matched>()
    for (const card of matched) {
      const key = (card.url || '').toLowerCase().trim()
      const list = byUrl.get(key) ?? []
      list.push(card)
      byUrl.set(key, list)
    }
    // 每组取代表 + 收集副本分类
    const items = Array.from(byUrl.values())
      .map((group) => {
        // 代表：updatedAt 最大；并列时取 order 最小
        const sorted = [...group].sort((a, b) => {
          if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
          return a.order - b.order
        })
        const rep = sorted[0]
        const others = sorted.slice(1)
        return {
          card: rep,
          categoryPath: pathOf(rep.categoryId),
          dupCount: others.length,
          // 其他副本所在分类（去重，避免同一分类多个文案重复）
          dupCategoryPaths: Array.from(
            new Set(others.map((c) => pathOf(c.categoryId))),
          ),
        }
      })
      .sort((a, b) => b.card.updatedAt - a.card.updatedAt)
    return { items, rawCount: matched.length }
  }, [allCards, allCategories, keyword, isSearching, tagFilter])

  // AI 语义搜索：单独走异步路径
  if (aiQuery) {
    return <AISearchView query={aiQuery} cards={allCards} categories={allCategories} />
  }

  // 搜索模式：扁平展示
  if (isSearching) {
    const { items, rawCount } = searchResult
    return (
      <div>
        {/* tag 模式：突出展示当前筛选的 tag，提供一键清除 */}
        {tagFilter && (
          <div
            className={cn(
              'mb-3 px-2.5 py-1.5 rounded-md inline-flex items-center gap-2',
              'bg-violet-50 dark:bg-violet-500/10',
              'border border-violet-200 dark:border-violet-500/30',
              'text-xs text-violet-700 dark:text-violet-300',
            )}
          >
            <span className="text-[10px] uppercase tracking-wider opacity-70">
              按标签筛选
            </span>
            <span className="font-medium">
              <span className="opacity-60">#</span>
              {tagFilter}
            </span>
            <span className="text-violet-400 tabular-nums">
              · {items.length} 张卡片
            </span>
            <button
              type="button"
              onClick={() => setSearchKeyword('')}
              className={cn(
                'ml-1 w-4 h-4 inline-flex items-center justify-center rounded text-[11px]',
                'text-violet-400 hover:text-violet-700 dark:hover:text-violet-100',
                'hover:bg-violet-100 dark:hover:bg-violet-500/20',
              )}
              title="清除筛选"
              aria-label="清除筛选"
            >
              ✕
            </button>
          </div>
        )}

        {/* 顶部统计：让用户感知"重复被合并了"（tag 模式下另起视觉） */}
        {!tagFilter && items.length > 0 && (
          <div className="text-xs text-slate-400 mb-3 px-1">
            找到 <span className="tabular-nums text-slate-600 dark:text-slate-300">{items.length}</span>{' '}
            条独立结果
            {rawCount !== items.length && (
              <>
                {' '}
                <span className="text-slate-400/80">
                  · 原始命中 {rawCount} 条，已按 URL 合并
                </span>
              </>
            )}
          </div>
        )}
        <div className={GRID_COLS}>
          {items.map(({ card, categoryPath, dupCount, dupCategoryPaths }) => (
            <BookmarkCardItem
              key={card.id}
              card={card}
              draggable={false}
              searchMeta={{ categoryPath, dupCount, dupCategoryPaths }}
            />
          ))}
        </div>
        {items.length === 0 && (
          <div className="col-span-full text-center py-16 text-slate-400 text-sm">
            {tagFilter
              ? `没有书签使用 #${tagFilter} 标签`
              : '没有找到匹配的书签'}
          </div>
        )}
      </div>
    )
  }

  if (!activeCategoryId) return null

  const activeCategory = allCategories.find((c) => c.id === activeCategoryId)
  if (!activeCategory) return null

  // DFS 收集当前 active 分类下的所有后代分类（按 order 排序），用于按 section 展示
  const descendants = collectDescendantsDFS(activeCategoryId, allCategories)

  // 当前层是否完全为空（无子文件夹、无直接书签、无后代）
  const directCardCount = allCards.filter((c) => c.categoryId === activeCategoryId).length
  const directFolderCount = allCategories.filter((c) => c.parentId === activeCategoryId).length
  const isEmpty =
    directCardCount === 0 && directFolderCount === 0 && descendants.length === 0

  return (
    <div className="flex flex-col gap-8">
      {/* 最近使用：常驻在分类内容上方，独立折叠（搜索模式由上方 if 提前 return，这里不会渲染） */}
      <RecentSection />

      {/* 当前分类（根 section）：使用 compact header 暴露折叠按钮
          key 绑定 activeCategoryId：切换分类时强制 remount，恢复"展开"默认态 */}
      <CategorySection
        key={`root-${activeCategoryId}`}
        category={activeCategory}
        showFolders
        headerVariant="compact"
      />

      {/* 所有后代分类（递归 DFS）：每个作为独立 section（full header），
          标题用相对 active 的路径（不再重复根名），并按层级缩进，
          层次越深视觉越缩进，避免 "Test / 1 / 11" 这种"被无奈展开的全路径"。
          key 含 activeCategoryId：切换分类时强制 remount，所有子 section 回到"折叠"默认态。 */}
      {descendants.map((cat) => (
        <CategorySection
          key={`${activeCategoryId}-${cat.id}`}
          category={cat}
          rootId={activeCategoryId}
          showFolders={false}
          headerVariant="full"
        />
      ))}

      {/* 空状态 */}
      {isEmpty && (
        <div className="text-center py-12 text-slate-400">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-sm">这里还没有内容，点击 + 添加书签</p>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * CategorySection：单个分类的内容区块
 * - showFolders：是否显示直接子文件夹卡片（仅根 section 显示，避免重复）
 * - headerVariant：
 *   - 'full'    完整 header（含面包屑路径），用于子 section
 *   - 'compact' 紧凑 header（仅折叠按钮 + 数量 + 添加书签），用于根 section
 *               （路径已由 Breadcrumb 承担，避免重复，但保留折叠能力）
 *   - 'none'    不渲染 header（旧行为，保留以备扩展）
 * ───────────────────────────────────────────────────────────── */
type HeaderVariant = 'full' | 'compact' | 'none'
interface SectionProps {
  category: Category
  /**
   * 当前 active 分类 id，用于把面包屑收敛为相对路径（不再从根开始拼）。
   * 不传或与 category.id 相同时，按"绝对路径"行为（兼容旧调用）。
   */
  rootId?: string | null
  showFolders: boolean
  headerVariant: HeaderVariant
}

function CategorySection({
  category,
  rootId,
  showFolders,
  headerVariant,
}: SectionProps) {
  const allCards = useBookmarkStore((s) => s.cards)
  const allCategories = useBookmarkStore((s) => s.categories)
  const setActive = useBookmarkStore((s) => s.setActiveCategory)
  const reorder = useBookmarkStore((s) => s.reorderCardsInCategory)
  const addCard = useBookmarkStore((s) => s.addCard)
  const moveCard = useBookmarkStore((s) => s.moveCard)
  // v0.21.2：子 section header 上编辑 description
  const updateCategory = useBookmarkStore((s) => s.updateCategory)
  // v0.21.2：当书签拖到本子 section 的 header 时高亮（full header 才订阅有意义）
  const isHeaderDropHovered = useDropHintStore(
    (s) => s.hoverCategoryId === category.id,
  )

  // header 渲染辅助：full 显示完整路径头，compact 仅显示折叠按钮（用于根 section）
  const showFullHeader = headerVariant === 'full'
  const showCompactHeader = headerVariant === 'compact'

  // section 自身的折叠状态（compact / full 两种 header 都能切换）
  // - full header（子 section）：默认折叠，配合"切换分类时只展开根目录的书签"产品行为
  // - compact header（根 section）：默认展开，让用户切到分类后立刻看到该分类的书签
  // BookmarkGrid 通过 key 中带 activeCategoryId 让本组件在切换时 remount 回到默认态
  const [collapsed, setCollapsed] = useState(showFullHeader)
  // v0.21.4：DragOverlay 需要的"当前被拖卡片 id"
  const [activeCardId, setActiveCardId] = useState<string | null>(null)

  const subFolders = useMemo(
    () =>
      showFolders
        ? allCategories
            .filter((c) => c.parentId === category.id)
            .sort((a, b) => a.order - b.order)
        : [],
    [allCategories, category.id, showFolders],
  )

  const directCards = useMemo(
    () =>
      allCards
        .filter((c) => c.categoryId === category.id)
        .sort((a, b) => a.order - b.order),
    [allCards, category.id],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  /* ─── 书签卡片拖拽：同分类排序 + 跨分类 moveCard（v0.21.0 / v0.21.2 / v0.21.4 / v0.21.6） ─── */

  const handleDragStart = (e: DragStartEvent) => {
    setActiveCardId(e.active.id as string)
  }

  /**
   * v0.21.6 关键修复：拖拽期间用全局 pointermove 直接算指针位置，
   * 不再依赖 dnd-kit 的 onDragMove。
   *
   * 之前的 v0.21.4 用 active.rect.current.translated（被 DragOverlay 接管 transform
   * 后不再跟随指针），v0.21.5 改用 activatorEvent + delta（dnd-kit 的 activatorEvent
   * 在 PointerSensor activation 后不一定是 pointerdown，clientX/Y 不可靠）。
   * 直接监听全局 pointermove 拿真实的 clientX/clientY 最稳。
   *
   * 仅在有 activeCardId 时挂 listener，避免无谓开销。
   */
  useEffect(() => {
    if (!activeCardId) return
    const onMove = (e: PointerEvent) => {
      const targetId = findDropTargetAt(
        e.clientX,
        e.clientY,
        `[data-dnd-card="${activeCardId}"]`,
      )
      // 源分类不算（让 dnd-kit 接管同分类排序，避免 hint 跟 sortable 冲突）
      const next = targetId && targetId !== category.id ? targetId : null
      if (useDropHintStore.getState().hoverCategoryId !== next) {
        useDropHintStore.getState().set(next)
      }
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [activeCardId, category.id])

  const handleDragCancel = () => {
    useDropHintStore.getState().set(null)
    setActiveCardId(null)
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e
    const hint = useDropHintStore.getState().hoverCategoryId
    useDropHintStore.getState().set(null)
    setActiveCardId(null)

    // 1) 跨分类：用户拖到了某个 FolderCard 或侧栏行（且不是源分类）
    if (hint && hint !== category.id) {
      const cardId = active.id as string
      const targetCount = allCards.filter((c) => c.categoryId === hint).length
      try {
        await moveCard(cardId, hint, targetCount)
        const targetCat = allCategories.find((c) => c.id === hint)
        if (targetCat) {
          toast.success(
            '已移动书签',
            `→「${targetCat.name}」（追加到末尾）`,
          )
        }
      } catch (err) {
        toast.error(
          '移动失败',
          err instanceof Error ? err.message : '未知错误',
        )
      }
      return
    }

    // 2) 同分类排序（原逻辑）
    if (!over || active.id === over.id) return
    const ids = directCards.map((c) => c.id)
    const oldIdx = ids.indexOf(active.id as string)
    const newIdx = ids.indexOf(over.id as string)
    if (oldIdx === -1 || newIdx === -1) return
    await reorder(category.id, arrayMove(ids, oldIdx, newIdx))
  }

  /* ─── 描述编辑（v0.21.2：子 section header 上点击描述触发） ─── */

  const handleEditDescription = async () => {
    const next = await promptDialog({
      title: category.description
        ? `编辑「${category.name}」备注`
        : `为「${category.name}」添加备注`,
      defaultValue: category.description ?? '',
      placeholder: '简短描述这个文件夹…',
      allowEmpty: true,
      multiline: true,
    })
    if (next === null) return
    void updateCategory(category.id, {
      description: next.trim() || undefined,
    })
  }

  const handleAddCard = async () => {
    const url = await promptDialog({
      title: '添加书签',
      message: '在「' + category.name + '」下新增一个书签',
      placeholder: 'https://...',
      validate: (v) => {
        const t = v.trim()
        if (!t) return '请输入网址'
        if (!/^https?:\/\//i.test(t)) return '请以 http:// 或 https:// 开头'
        return null
      },
    })
    if (!url?.trim()) return
    const title = await promptDialog({
      title: '书签标题',
      defaultValue: url,
      placeholder: '一句话描述这个书签',
      allowEmpty: false,
    })
    if (!title?.trim()) return
    await addCard({
      categoryId: category.id,
      title: title.trim(),
      url: url.trim(),
    })
  }

  // 计算相对 active 根的路径与深度。例：active=Test，cat=Test/1/11 → 路径 "1 / 11"，深度 2。
  // 这样子 section 不再重复根名（"Test / 1 / 11"），让用户专注于"在当前分类下的相对位置"。
  const { breadcrumbPath, relativeDepth } = useMemo(() => {
    if (!showFullHeader) return { breadcrumbPath: '', relativeDepth: 0 }
    const map = new Map(allCategories.map((c) => [c.id, c]))
    const parts: string[] = []
    let cur: Category | undefined = category
    let depth = 0
    while (cur) {
      // 遇到 active 根本身就停下，把它作为"基准"，不放进显示路径
      if (rootId && cur.id === rootId) break
      parts.unshift(cur.name)
      depth++
      cur = cur.parentId ? map.get(cur.parentId) : undefined
    }
    // 如果一路追溯都没碰到 rootId（理论上不会发生，因为这些都是 root 的后代），
    // 回退到完整路径，避免显示空字符串
    return {
      breadcrumbPath: parts.length > 0 ? parts.join(' / ') : category.name,
      relativeDepth: Math.max(1, depth),
    }
  }, [allCategories, category, showFullHeader, rootId])

  // section 整体为空时（无子文件夹、无书签）也显示出来——保持目录结构可见
  const sectionIsEmpty = subFolders.length === 0 && directCards.length === 0

  return (
    <section
      // 子 section 按相对深度做左缩进，最多缩 3 层（避免超深嵌套时挤压主区域）
      // root section（compact）relativeDepth=0，不缩进
      style={
        showFullHeader
          ? { paddingLeft: Math.min(3, relativeDepth) * 16 }
          : undefined
      }
    >
      {showFullHeader && (
        <header
          // v0.21.2：整个 header 是书签拖拽的 drop target —— 把书签拖到这里
          // 即可移动到该子文件夹（替代原来需要"先有一个 FolderCard 才能拖"的设计）
          data-card-drop-target={category.id}
          className={cn(
            'flex items-center gap-2 mb-3 group/sec px-1.5 py-1 -mx-1.5 rounded-md transition-colors',
            // drop hint 高亮（淡蓝色 + ring）
            isHeaderDropHovered &&
              'bg-sky-50/70 dark:bg-sky-500/10 ring-2 ring-sky-400/60',
          )}
          title={
            isHeaderDropHovered
              ? `放入文件夹：${category.name}`
              : undefined
          }
        >
          <button
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? '展开' : '折叠'}
            className={cn(
              'w-7 h-7 flex items-center justify-center text-base rounded shrink-0',
              'text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800',
              // 仅 hover 整行 header 时显示，避免视觉噪音；展开状态下应用 rotate
              'opacity-0 group-hover/sec:opacity-100 focus-visible:opacity-100 transition-[opacity,transform] duration-150',
              collapsed ? '' : 'rotate-90',
            )}
          >
            ▸
          </button>
          <span className="text-base leading-none shrink-0">{category.icon ?? '📂'}</span>
          <button
            onClick={() => setActive(category.id)}
            className="text-sm font-medium text-slate-700 dark:text-slate-200 hover:text-brand transition-colors truncate shrink-0"
            title={`进入：${breadcrumbPath}`}
          >
            {breadcrumbPath}
          </button>
          <span className="text-xs text-slate-400 tabular-nums shrink-0">
            {directCards.length > 0 && `${directCards.length} 个书签`}
          </span>
          {/* v0.21.2：description 紧贴数量后面；
              - 已有：浅色 truncate 显示，点击进入编辑（promptDialog 多行）
              - 没有：极淡的"+ 添加备注"占位，仅 hover header 时显示 */}
          {category.description ? (
            <>
              <span className="text-xs text-slate-300 dark:text-slate-600 shrink-0">·</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleEditDescription()
                }}
                className={cn(
                  'flex-1 min-w-0 text-left text-xs truncate',
                  'text-slate-500 dark:text-slate-400',
                  'rounded px-1 py-0.5 hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors',
                )}
                title={`备注：${category.description}\n（点击编辑）`}
              >
                {category.description}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleEditDescription()
                }}
                className={cn(
                  'text-xs px-1.5 py-0.5 rounded',
                  'text-slate-300 dark:text-slate-600 hover:text-brand',
                  'hover:bg-slate-100 dark:hover:bg-slate-700/60',
                  'opacity-0 group-hover/sec:opacity-100 focus-visible:opacity-100 transition-opacity',
                )}
                title="为该文件夹添加备注"
              >
                + 备注
              </button>
              <div className="flex-1" />
            </>
          )}
          <div
            className={cn(
              'border-t border-dashed border-slate-200 dark:border-slate-700 ml-2',
              // description 已经占据了弹性宽度，没有时这里也要再有占位
              category.description ? 'hidden' : 'flex-1',
            )}
          />
          <button
            onClick={handleAddCard}
            className="opacity-0 group-hover/sec:opacity-100 transition-opacity btn-ghost !p-1 h-6 w-6 text-sm shrink-0"
            title="在此分类添加书签"
          >+</button>
        </header>
      )}

      {/* compact header：根 section 专用——仅折叠按钮 + 「当前分类」标签 + 数量
          路径已由 Breadcrumb 承担，避免重复；保留折叠能力即可 */}
      {showCompactHeader && (
        <header
          // v0.21.6：compact header（root section）也作 drop target，
          // 解决"子文件夹的书签 → 拖回当前分类（root）"的诉求。
          // 同 full header 共用一套 hint 视觉。
          data-card-drop-target={category.id}
          className={cn(
            'flex items-center gap-2 mb-3 group/sec px-1.5 py-1 -mx-1.5 rounded-md transition-colors',
            isHeaderDropHovered &&
              'bg-sky-50/70 dark:bg-sky-500/10 ring-2 ring-sky-400/60',
          )}
          title={
            isHeaderDropHovered
              ? `放回当前分类：${category.name}`
              : undefined
          }
        >
          <button
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? '展开' : '折叠'}
            className={cn(
              'w-7 h-7 flex items-center justify-center text-base rounded shrink-0',
              'text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800',
              'opacity-0 group-hover/sec:opacity-100 focus-visible:opacity-100 transition-[opacity,transform] duration-150',
              collapsed ? '' : 'rotate-90',
            )}
          >
            ▸
          </button>
          <span className="text-xs uppercase tracking-wider text-slate-400 shrink-0">
            当前分类
          </span>
          <span className="text-xs text-slate-400 tabular-nums shrink-0">
            {/* 与下方主区一致：书签在前，文件夹在后 */}
            {directCards.length > 0 && `${directCards.length} 书签`}
            {directCards.length > 0 && subFolders.length > 0 && ' · '}
            {subFolders.length > 0 && `${subFolders.length} 文件夹`}
          </span>
          <div className="flex-1 border-t border-dashed border-slate-200 dark:border-slate-700 ml-2" />
        </header>
      )}

      {!collapsed && (
        <>
          {/* 直接书签（支持拖拽排序）—— 优先于文件夹展示
              产品诉求：用户更常打开常用书签，文件夹是导航辅助；
              所以"书签 → 文件夹"的视觉顺序更符合使用频次

              - 根 section（非 full header）始终显示该块（哪怕 0 书签也保留 + 按钮，方便随时新建）
              - 子 section（full header）只有有书签时显示，避免视觉空洞 */}
          {(directCards.length > 0 || !showFullHeader) && (
            <div className={subFolders.length > 0 ? 'mb-4' : ''}>
              {/* 仅当下面还有文件夹时给书签块加标题，做视觉分隔；
                  纯书签场景去掉标题更清爽 */}
              {subFolders.length > 0 && (
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                  书签
                </h3>
              )}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragCancel={handleDragCancel}
              >
                <SortableContext
                  items={directCards.map((c) => c.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className={GRID_COLS}>
                    {directCards.map((card) => (
                      <BookmarkCardItem key={card.id} card={card} />
                    ))}
                    {/* 仅在根 section（非 full header）显示 + 按钮，子 section 由 header 上的 + 处理 */}
                    {!showFullHeader && (
                      <button
                        onClick={handleAddCard}
                        className="card flex items-center justify-center h-24 text-3xl text-slate-300 hover:text-brand hover:border-brand/50 transition-colors"
                        title="新建书签"
                      >
                        +
                      </button>
                    )}
                  </div>
                </SortableContext>
                {/* v0.21.4 DragOverlay：把拖拽中的卡片视觉 portal 到 <body>，
                    逃出 main 容器 overflow 的裁剪——主诉求"被左侧菜单栏遮挡"
                    的根因是 main overflow-y:auto 强制 overflow-x 也变 auto，
                    transform 出主区边界会被 clip 掉。Portal 到 body 后无 clip。

                    dropAnimation：松手时 overlay 平滑回到原 sortable 元素位置
                    （同分类排序时这就是新位置；跨分类时是源位置，180ms 内消失）。
                    带来用户提到的"吸附效果"。 */}
                <DragOverlay
                  dropAnimation={{
                    duration: 200,
                    easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
                  }}
                  zIndex={9999}
                >
                  {activeCardId
                    ? (() => {
                        const card = allCards.find((c) => c.id === activeCardId)
                        return card ? <CardDragPreview card={card} /> : null
                      })()
                    : null}
                </DragOverlay>
              </DndContext>
            </div>
          )}

          {/* v0.21.2：移除了 root section 下的"文件夹"网格区块——
              子文件夹的信息（图标、名称、数量、备注）已经合并到
              下方各子 section 的 header 上，整 header 同时承担：
              - 浏览入口（点击名称进入）
              - 备注的显示/编辑
              - 书签拖入的 drop target（替代原 FolderCard 的角色）
              避免了视觉上"文件夹一排卡片 + 下面又是同一批文件夹的 section"的重复。 */}

          {/* 子 section 完全为空时给一个柔和提示，保持目录结构可见 */}
          {showFullHeader && sectionIsEmpty && (
            <div className="text-xs text-slate-400 pl-7 pb-1">空文件夹</div>
          )}
        </>
      )}
    </section>
  )
}

/** DFS 收集所有后代分类（不含自己），按 order 顺序遍历 */
function collectDescendantsDFS(rootId: string, allCats: Category[]): Category[] {
  const result: Category[] = []
  const dfs = (parentId: string) => {
    const children = allCats
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.order - b.order)
    for (const child of children) {
      result.push(child)
      dfs(child.id)
    }
  }
  dfs(rootId)
  return result
}

/* ─────────────────────────────────────────────────────────────
 * AISearchView：@ai 模式下的语义检索结果视图（V1.5 §5.1）
 *
 * - debounce 350ms 调 embedder.searchByEmbedding（避免每次按键都打 API）
 * - 主结果：按余弦相似度倒序，每条带百分比 score
 * - 兜底（fallback）：embedding 缺失但 substring 命中的卡片，作为次级结果展示
 * - 未配置 AI / 库为空时给出引导
 * ───────────────────────────────────────────────────────────── */

interface AISearchViewProps {
  query: string
  cards: BookmarkCard[]
  categories: Category[]
}

type AISearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; hits: EmbedSearchHit[] }
  | { status: 'error'; message: string }

function AISearchView({ query, cards, categories }: AISearchViewProps) {
  const settings = useAISettingsStore()
  const setSearchKeyword = useBookmarkStore((s) => s.setSearchKeyword)
  const aiReady = isAIConfigured(settings)

  const [state, setState] = useState<AISearchState>({ status: 'idle' })

  // debounce 调 search
  useEffect(() => {
    if (!aiReady) {
      setState({ status: 'error', message: '尚未配置可用的 AI Provider' })
      return
    }
    setState({ status: 'loading' })
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const hits = await searchByEmbedding({
          query,
          cards,
          settings,
          topK: 30,
          minScore: 0.2,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        setState({ status: 'ready', hits })
      } catch (err) {
        if (controller.signal.aborted) return
        const msg = err instanceof Error ? err.message : '未知错误'
        setState({ status: 'error', message: msg })
      }
    }, 350)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, aiReady, settings.routing.embedding, settings.providers.length])

  // 分类路径快查（与主搜索分支同款实现）
  const pathOf = useMemo(() => {
    const catMap = new Map(categories.map((c) => [c.id, c]))
    return (catId: string): string => {
      const parts: string[] = []
      let cur = catMap.get(catId)
      while (cur) {
        parts.unshift(cur.name)
        cur = cur.parentId ? catMap.get(cur.parentId) : undefined
      }
      return parts.join(' / ') || '(未分类)'
    }
  }, [categories])

  const cardMap = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

  // 主结果：按 hits 排
  const primaryItems = useMemo(() => {
    if (state.status !== 'ready') return []
    return state.hits
      .map((h) => {
        const card = cardMap.get(h.cardId)
        if (!card) return null
        return { card, score: h.score, categoryPath: pathOf(card.categoryId) }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
  }, [state, cardMap, pathOf])

  /**
   * Fallback：embedding 没覆盖到的书签 + substring 命中的，作为次级结果。
   * 让用户在 embedding 还没补齐时也有兜底结果，避免"AI 模式 = 空白"。
   */
  const fallbackItems = useMemo(() => {
    if (state.status !== 'ready') return []
    const kw = query.toLowerCase()
    const hitIds = new Set(state.hits.map((h) => h.cardId))
    const subMatches = cards.filter(
      (c) =>
        !hitIds.has(c.id) &&
        (c.title.toLowerCase().includes(kw) || c.url.toLowerCase().includes(kw)),
    )
    return subMatches.slice(0, 20).map((card) => ({
      card,
      categoryPath: pathOf(card.categoryId),
    }))
  }, [state, cards, pathOf, query])

  return (
    <div>
      {/* 顶部模式横幅 */}
      <div
        className={cn(
          'mb-3 px-2.5 py-1.5 rounded-md inline-flex items-center gap-2',
          'bg-fuchsia-50 dark:bg-fuchsia-500/10',
          'border border-fuchsia-200 dark:border-fuchsia-500/30',
          'text-xs text-fuchsia-700 dark:text-fuchsia-300',
        )}
      >
        <span className="text-[10px] uppercase tracking-wider opacity-70">
          AI 语义搜索
        </span>
        <span className="font-medium truncate max-w-[280px]" title={query}>
          {query}
        </span>
        {state.status === 'loading' && (
          <span className="text-fuchsia-400 animate-pulse">检索中…</span>
        )}
        {state.status === 'ready' && (
          <span className="text-fuchsia-400 tabular-nums">
            · {primaryItems.length} 命中
            {fallbackItems.length > 0 && ` + ${fallbackItems.length} 兜底`}
          </span>
        )}
        <button
          type="button"
          onClick={() => setSearchKeyword('')}
          className={cn(
            'ml-1 w-4 h-4 inline-flex items-center justify-center rounded text-[11px]',
            'text-fuchsia-400 hover:text-fuchsia-700 dark:hover:text-fuchsia-100',
            'hover:bg-fuchsia-100 dark:hover:bg-fuchsia-500/20',
          )}
          title="清除搜索"
          aria-label="清除搜索"
        >
          ✕
        </button>
      </div>

      {/* 状态分支 */}
      {state.status === 'error' ? (
        <div className="rounded-md p-3 text-xs text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 break-words">
          AI 检索失败：{state.message}
          {!aiReady && (
            <div className="mt-1 text-[11px] text-slate-500">
              请到浮窗 ⚙ 设置添加并启用 Provider
            </div>
          )}
        </div>
      ) : state.status === 'loading' ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          ✨ 正在做语义检索…
        </div>
      ) : (
        <>
          {/* 主结果 */}
          {primaryItems.length > 0 ? (
            <div className={GRID_COLS}>
              {primaryItems.map(({ card, score, categoryPath }) => (
                <AIHitCard
                  key={`p-${card.id}`}
                  card={card}
                  score={score}
                  categoryPath={categoryPath}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-slate-400 text-sm space-y-2">
              <div>没有找到语义相似的书签</div>
              <div className="text-[11px] text-slate-300 dark:text-slate-600">
                如果是新装或刚清空了 embedding，先到 ⚙ 设置点「✨ 补缺」生成索引
              </div>
            </div>
          )}

          {/* 兜底（substring）：仅在主结果不空时也显示 —— 让用户感知"还有非语义命中"
              主结果空时只展示空状态，避免兜底唱主角让用户误以为 AI 没接通 */}
          {primaryItems.length > 0 && fallbackItems.length > 0 && (
            <div className="mt-6">
              <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-2 px-1">
                · 关键字兜底匹配（embedding 未覆盖）
              </div>
              <div className={GRID_COLS}>
                {fallbackItems.map(({ card, categoryPath }) => (
                  <BookmarkCardItem
                    key={`f-${card.id}`}
                    card={card}
                    draggable={false}
                    searchMeta={{
                      categoryPath,
                      dupCount: 0,
                      dupCategoryPaths: [],
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * AI 命中的单卡：复用 BookmarkCardItem，但额外覆盖一个角标显示 score（百分比）。
 * 没把 score 塞到 BookmarkCardItem.searchMeta 里是因为该接口语义是「分类副本」，
 * AI score 是另一码事；用包一层的方式让两边都纯净。
 */
function AIHitCard({
  card,
  score,
  categoryPath,
}: {
  card: BookmarkCard
  score: number
  categoryPath: string
}) {
  const pct = Math.round(score * 100)
  return (
    <div className="relative">
      <BookmarkCardItem
        card={card}
        draggable={false}
        searchMeta={{ categoryPath, dupCount: 0, dupCategoryPaths: [] }}
      />
      {/* 右上角分数徽标：高 score 用 brand 色，低 score 灰色 */}
      <span
        className={cn(
          'absolute top-1 right-1 inline-flex items-center px-1 h-3.5 rounded text-[9px] leading-none',
          'tabular-nums font-medium pointer-events-none',
          pct >= 60
            ? 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300'
            : 'bg-slate-100 dark:bg-slate-700 text-slate-400',
        )}
        title={`相似度 ${pct}%`}
      >
        {pct}
      </span>
    </div>
  )
}
