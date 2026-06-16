import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
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
import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Category } from '../types/bookmark'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { useDropHintStore, findDropTargetAt } from '../stores/useDropHintStore'
import { toast } from '../stores/useToastStore'
import { BookmarkCardItem, CardDragPreview } from './BookmarkCardItem'
import { VirtualBookmarkGrid } from './VirtualBookmarkGrid'
import { RecentSection } from './RecentSection'
import { promptDialog } from './Dialog'
import { cn } from '../utils/cn'
import { IconView } from '../utils/icon'

/**
 * v0.21.x：@ai 语义搜索视图按需加载。
 * 没有 AI 需求的用户不必为 embedder + provider + useAISettingsStore 付出首屏 bundle。
 * 入口判定走纯字符串前缀，命中后才动态拉 chunk。
 */
const AISearchView = lazy(() => import('./BookmarkGridAISearch'))

const GRID_COLS =
  'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3'

/**
 * compact 档专用网格：固定列宽 = 卡片宽（112px），auto-fill 自动按容器宽度铺。
 * 避免标准断点 grid 在大屏下把 w-28 卡撑到一行 5~6 列后留出过宽的视觉空隙。
 * gap 也收紧到 2，与 compact 紧凑信息密度一致。
 */
const GRID_COLS_COMPACT =
  'grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2'

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

  // AI 语义搜索：单独走异步路径（lazy chunk，未配 AI 的用户不会加载）
  if (aiQuery) {
    return (
      <Suspense
        fallback={
          <div className="text-center py-12 text-slate-400 text-sm">
            ✨ 加载 AI 检索模块…
          </div>
        }
      >
        <AISearchView query={aiQuery} cards={allCards} categories={allCategories} />
      </Suspense>
    )
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
        {/* v0.21.x P0-1：搜索结果集可能达到 1000+，交给 VirtualBookmarkGrid
            做行级窗口化。items < 60 时它内部会回退到普通平铺，无额外开销。 */}
        <VirtualBookmarkGrid items={items} />
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
  const cardSize = useBookmarkStore((s) => s.settings.cardSize)
  // v0.21.2 / v0.21.8：当书签拖到本 section（header 或下方书签网格区域，
  // 整个 section 都是 drop target）时，让 header 显示高亮提示落点
  const isSectionDropHovered = useDropHintStore(
    (s) => s.hoverCategoryId === category.id,
  )

  // header 渲染辅助：full 显示完整路径头，compact 仅显示折叠按钮（用于根 section）
  const showFullHeader = headerVariant === 'full'
  const showCompactHeader = headerVariant === 'compact'

  // section 自身的折叠状态（compact / full 两种 header 都能切换）
  // - full header（子 section）：默认折叠（v0.21.15 起可在样式管理里开关，
  //   设置 subSectionDefaultExpanded=true 后默认展开；保持原行为对老用户兼容）
  // - compact header（根 section）：默认展开，让用户切到分类后立刻看到该分类的书签
  // BookmarkGrid 通过 key 中带 activeCategoryId 让本组件在切换时 remount 回到默认态
  const subSectionDefaultExpanded = useBookmarkStore(
    (s) => s.settings.subSectionDefaultExpanded ?? false,
  )
  const [collapsed, setCollapsed] = useState(
    showFullHeader ? !subSectionDefaultExpanded : false,
  )
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

  /* ─── 书签卡片拖拽：同分类排序 + 跨分类 moveCard ─── */

  const handleDragStart = (e: DragStartEvent) => {
    setActiveCardId(e.active.id as string)
  }

  /**
   * v0.21.9 关键修复：监听 mousemove 而非 pointermove。
   *
   * 根因：dnd-kit PointerSensor 拖拽时把 pointer events 路由到 source 元素，
   * 即使 window listener 在 capture phase 也能收到，但 lastReported 限流
   * 让大部分采样被跳过。直接监听 mousemove + elementsFromPoint 反查，
   * mouse events 与 pointer events 系统独立，不受 setPointerCapture 影响。
   */
  useEffect(() => {
    if (!activeCardId) return
    const onMove = (e: MouseEvent) => {
      const targetId = findDropTargetAt(e.clientX, e.clientY)
      // 源分类不算（让 dnd-kit 接管同分类排序）
      const next = targetId && targetId !== category.id ? targetId : null
      if (useDropHintStore.getState().hoverCategoryId !== next) {
        useDropHintStore.getState().set(next)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [activeCardId, category.id])

  const handleDragCancel = () => {
    useDropHintStore.getState().set(null)
    setActiveCardId(null)
  }

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    const hint = useDropHintStore.getState().hoverCategoryId
    useDropHintStore.getState().set(null)
    setActiveCardId(null)

    // 1) 跨分类：用户拖到了某个 FolderCard 或侧栏行（且不是源分类）
    if (hint && hint !== category.id) {
      const cardId = active.id as string
      const targetCount = allCards.filter((c) => c.categoryId === hint).length
      // 跨分类一样用 flushSync，让 React 在 dnd-kit cleanup 前完成 DOM 重排
      flushSync(() => {
        void moveCard(cardId, hint, targetCount)
      })
      const targetCat = allCategories.find((c) => c.id === hint)
      if (targetCat) {
        toast.success(
          '已移动书签',
          `→「${targetCat.name}」（追加到末尾）`,
        )
      }
      return
    }

    // 2) 同分类排序
    if (!over || active.id === over.id) return
    const ids = directCards.map((c) => c.id)
    const oldIdx = ids.indexOf(active.id as string)
    const newIdx = ids.indexOf(over.id as string)
    if (oldIdx === -1 || newIdx === -1) return
    /**
     * v0.21.14：flushSync 强制 React state 更新在 dnd-kit cleanup 前完成。
     *
     * 不加 flushSync 时的时序：
     *   dnd-kit cleanup（transform reset → 一帧旧顺序 + 旧位置）
     *   → React batched rerender（异步 → 一帧新顺序）
     *   → 用户看到两帧切换 = 闪烁
     *   往前拖时由于 reorder 方向与 React DOM 重排方向冲突，闪烁更明显；
     *   往后拖恰好一致，看起来"连贯"。
     *
     * flushSync 后：React 强制同步 rerender，cleanup 时 DOM 已是新顺序，
     * 让位 items 的新 transform 直接落在正确位置，无 1-frame 闪烁。
     */
    flushSync(() => {
      void reorder(category.id, arrayMove(ids, oldIdx, newIdx))
    })
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
  // + 占位用正方形：宽=高，避免在网格列里被拉成长方形
  const addCardSquareClass =
    cardSize === 'compact'
      ? 'w-28 h-28'
      : cardSize === 'large'
        ? 'w-32 h-32'
        : 'w-24 h-24'

  return (
    <section
      // v0.21.8：整个 section（header + 下方书签网格）都是 drop target。
      // 之前只在 header 上挂，用户必须精确拖到细细的 header 一行；
      // 现在拖到整个 section 任意位置（包括书签卡片之间的空白）都能命中。
      // findDropTargetAt 用 closest() 沿祖先链向上查找，BookmarkCardItem
      // 的祖先链终点正是这个 section，自然就命中了。
      data-card-drop-target={category.id}
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
          // v0.21.8 起 data-card-drop-target 移到 <section> 上；header 只保留视觉
          className={cn(
            'flex items-center gap-2 mb-3 group/sec px-1.5 py-1 -mx-1.5 rounded-md transition-colors',
            // drop hint 高亮（淡蓝色 + ring）
            isSectionDropHovered &&
              'bg-sky-50/70 dark:bg-sky-500/10 ring-2 ring-sky-400/60',
          )}
          title={
            isSectionDropHovered
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
          <IconView
            value={category.icon}
            fallback="📂"
            boxed
            boxClassName="w-6 h-6"
            emojiClassName="text-sm leading-none"
            imgClassName="w-4 h-4 rounded-sm object-contain"
          />
          <button
            onClick={() => setActive(category.id)}
            className="text-sm font-semibold text-slate-700 dark:text-slate-200 hover:text-brand transition-colors truncate shrink-0"
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
          {/* 弹性占位：没有 description 时撑开，把 + 按钮推到右侧 */}
          {!category.description && <div className="flex-1" />}
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
          // v0.21.8 起 drop target 在 <section> 上；header 只保留视觉
          className={cn(
            'flex items-center gap-2 mb-3 group/sec px-1.5 py-1 -mx-1.5 rounded-md transition-colors',
            isSectionDropHovered &&
              'bg-sky-50/70 dark:bg-sky-500/10 ring-2 ring-sky-400/60',
          )}
          title={
            isSectionDropHovered
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
          <div className="flex-1" />
          <button
            onClick={handleAddCard}
            className="opacity-0 group-hover/sec:opacity-100 transition-opacity btn-ghost !p-1 h-6 w-6 text-sm shrink-0"
            title="在此分类添加书签"
          >+</button>
        </header>
      )}

      {!collapsed && (
        <>
          {/* 直接书签（支持拖拽排序）—— 优先于文件夹展示
              产品诉求：用户更常打开常用书签，文件夹是导航辅助；
              所以"书签 → 文件夹"的视觉顺序更符合使用频次

              所有 section 始终渲染该块：哪怕 0 书签也保留 + 占位，让"新建书签"
              的发现性在根 / 子级文件夹中保持一致（root + sub 同款交互）。 */}
          {(
            <div className={subFolders.length > 0 ? 'mb-4' : ''}>
              {/* 仅当下面有文件夹 + 上方至少有 1 张书签时给书签块加标题做视觉分隔；
                  只剩一个 + 占位时挂"书签"小标会显得奇怪 */}
              {subFolders.length > 0 && directCards.length > 0 && (
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
                // v0.21.14：MeasuringStrategy.Always 让 dnd-kit 在每次 rerender
                // 后立即重新测量 droppable rects。
                // 默认 WhileDragging 策略下，松手 + React rerender 后 DOM 已重排
                // 到新位置，但 sortable 内部的 rect 缓存还是旧位置，导致计算出
                // 非 0 的 transform 把 active 卡片"推"超出新位置再修正回来 →
                // 用户看到"卡片超出原前面位置然后回到前面位置"的来回动画。
                measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
              >
                <SortableContext
                  items={directCards.map((c) => c.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className={cardSize === 'compact' ? GRID_COLS_COMPACT : GRID_COLS}>
                    {directCards.map((card) => (
                      <BookmarkCardItem key={card.id} card={card} />
                    ))}
                    {/* + 占位（所有层级）：默认透明虚边、hover 切毛玻璃 + 上浮，
                        色阶对齐 header 文字（slate-700/dark:slate-200） */}
                    {(
                      <button
                        onClick={handleAddCard}
                        className={cn(
                          'group/add justify-self-start rounded-xl text-3xl flex items-center justify-center shrink-0',
                          'border border-dashed border-slate-300/60 dark:border-slate-600/50',
                          'text-slate-700 dark:text-slate-200',
                          'bg-transparent',
                          'transition-all duration-200 ease-out',
                          'hover:bg-white/60 dark:hover:bg-slate-800/55 hover:backdrop-blur',
                          'hover:border-transparent',
                          'hover:-translate-y-0.5',
                          'hover:shadow-[0_2px_4px_rgba(15,23,42,0.05),0_12px_24px_-4px_rgba(99,102,241,0.18)]',
                          'dark:hover:shadow-[0_2px_4px_rgba(0,0,0,0.3),0_14px_28px_-4px_rgba(99,102,241,0.35)]',
                          addCardSquareClass,
                        )}
                        title="新建书签"
                        aria-label="新建书签"
                      >
                        <span className="leading-none opacity-60 group-hover/add:opacity-100 transition-opacity">+</span>
                      </button>
                    )}
                  </div>
                </SortableContext>
                {/* v0.21.4 DragOverlay：把拖拽中的卡片视觉 portal 到 <body>，
                    逃出 main 容器 overflow 的裁剪。

                    v0.21.14 一路演进：
                    - 一开始默认 dropAnimation 会让 overlay 飞回 active.rect，
                      但 v0.21.4 时 active.rect 留在源位置 → 看似"飞回源位置"
                    - 临时改 dropAnimation=null 去掉飞回 → 但 active 卡片在
                      新位置 opacity 0→1 瞬间出现 → 用户感知"闪烁"
                    - 真正的修复链路：
                      · 乐观 setState（store action 先 set 再 await DB）
                      · flushSync 强制 React rerender 在 dnd-kit cleanup 前完成
                      · MeasuringStrategy.Always 让 rect 缓存同步
                      ↑ 三个加起来让 cleanup 时 active.rect 已经是新位置
                    - 此时恢复 dnd-kit 默认 dropAnimation 才正常：
                      浮层从指针位置平滑过渡到"新位置"的 active.rect → 自然吸附
                      active 元素同时 opacity 0→1 在新位置等着，无突兀 */}
                <DragOverlay zIndex={9999}>
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

/* AISearchView / AIHitCard：v0.21.x 抽到 ./BookmarkGridAISearch.tsx，
 * 通过本文件顶部的 React.lazy(() => import('./BookmarkGridAISearch')) 按需加载。
 * 这样未启用 AI 的用户首屏 chunk 完全不会拉到 embedder / providers / useAISettingsStore。 */
