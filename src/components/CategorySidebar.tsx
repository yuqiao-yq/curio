import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragMoveEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Category } from '../types/bookmark'
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from '../types/bookmark'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { useDropHintStore } from '../stores/useDropHintStore'
import { cn } from '../utils/cn'
import { IconPicker } from './IconPicker'
import { confirmDialog, promptDialog } from './Dialog'
import { IconView } from '../utils/icon'

// 拖到一行的"上 30% / 中 40% / 下 30%"分别表示三种放置语义
type DropPosition = 'before' | 'after' | 'inside'
interface OverInfo {
  id: string
  position: DropPosition
}

export function CategorySidebar() {
  const categories = useBookmarkStore((s) => s.categories)
  const cards = useBookmarkStore((s) => s.cards)
  const activeId = useBookmarkStore((s) => s.activeCategoryId)
  const setActive = useBookmarkStore((s) => s.setActiveCategory)
  const addCategory = useBookmarkStore((s) => s.addCategory)
  const renameCategory = useBookmarkStore((s) => s.renameCategory)
  const removeCategory = useBookmarkStore((s) => s.removeCategory)
  const removeCategories = useBookmarkStore((s) => s.removeCategories)
  const updateCategory = useBookmarkStore((s) => s.updateCategory)
  const moveCategory = useBookmarkStore((s) => s.moveCategory)
  const savedSidebarWidth = useBookmarkStore((s) => s.settings.sidebarWidth)
  const updateSettings = useBookmarkStore((s) => s.updateSettings)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // 折叠整个侧栏
  const [collapsed, setCollapsed] = useState(false)
  // 过渡期间显示彩光
  const [animating, setAnimating] = useState(false)
  // 树形节点的展开状态：存储已展开的分类 ID
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // ─── 侧栏宽度（可拖拽调整） ─────────────────────────
  // 持久化值放在 settings.sidebarWidth；这里维护一份本地 state，
  // 拖拽中实时更新（高频），松手时再持久化（低频）。
  //
  // ⚠ 时序坑（已修复）：
  //   App 首次 mount 时 store.init() 还没完成，savedSidebarWidth = undefined，
  //   这时如果用 useEffect([resizing]) 自动持久化会立即把 240 默认值写入 storage，
  //   覆盖之前真实保存的宽度（例如 320）。
  //   修复方案：拖拽 / 双击 这两个用户行为里**显式调用** updateSettings，
  //   不再依赖 useEffect 的隐式触发。useRef 用来在 pointerup 闭包里拿到最新宽度。
  const [sidebarWidth, setSidebarWidth] = useState<number>(
    () => clampSidebarWidth(savedSidebarWidth ?? SIDEBAR_WIDTH_DEFAULT),
  )
  const sidebarWidthRef = useRef(sidebarWidth)
  sidebarWidthRef.current = sidebarWidth
  // 是否正在拖拽 → 拖拽中关闭 width 过渡，否则会跟手抖动
  const [resizing, setResizing] = useState(false)

  // settings.sidebarWidth 异步加载完成后回填一次（首次 init 时本地 state 拿到的是默认值）。
  // 注意：拖拽过程中不要被外部回填覆盖（pointerup 后 updateSettings 会让 saved 变化，
  // 此时 saved === local，setSidebarWidth(saved) 等价 no-op，但仍要 guard 拖拽态以防万一）。
  useEffect(() => {
    if (resizing) return
    if (typeof savedSidebarWidth !== 'number') return
    const next = clampSidebarWidth(savedSidebarWidth)
    if (next !== sidebarWidthRef.current) {
      setSidebarWidth(next)
    }
  }, [savedSidebarWidth, resizing])

  // 全局监听 pointermove/up：避免拖到侧栏外面失焦后无法继续拖
  useEffect(() => {
    if (!resizing) return
    const onMove = (e: PointerEvent) => {
      // viewport 左边到指针的距离 = 侧栏新宽度（侧栏紧贴页面左边缘）
      setSidebarWidth(clampSidebarWidth(e.clientX))
    }
    const onUp = () => {
      setResizing(false)
      // 松手即持久化：用 ref 拿最新宽度，避免闭包 stale
      // 折叠态不覆盖展开偏好（理论上 resizing=true 时不会折叠，这里 guard 仅是兜底）
      if (!collapsed) {
        void updateSettings({ sidebarWidth: sidebarWidthRef.current })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    // 拖拽期间禁用文本选中，否则鼠标会一路选中页面文字
    const prevUserSelect = document.body.style.userSelect
    const prevCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.style.userSelect = prevUserSelect
      document.body.style.cursor = prevCursor
    }
  }, [resizing, collapsed, updateSettings])

  const handleResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    setResizing(true)
  }

  /** 双击调整柄 → 恢复默认宽度（与开发者工具的拖柄交互一致） */
  const handleResizeReset = () => {
    setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)
    if (!collapsed) void updateSettings({ sidebarWidth: SIDEBAR_WIDTH_DEFAULT })
  }

  const handleToggle = () => {
    setAnimating(true)
    setCollapsed((v) => !v)
  }

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const topLevel = categories
    .filter((c) => !c.parentId)
    .sort((a, b) => a.order - b.order)

  const childrenOf = (id: string) =>
    categories.filter((c) => c.parentId === id).sort((a, b) => a.order - b.order)

  const countOf = (id: string): number => {
    const subIds = categories.filter((c) => c.parentId === id).map((c) => c.id)
    const direct = cards.filter((c) => c.categoryId === id).length
    return direct + subIds.reduce((sum, sid) => sum + countOf(sid), 0)
  }

  const handleAdd = async () => {
    const name = await promptDialog({
      title: '新建顶层分类',
      placeholder: '分类名称',
      validate: (v) => (v.trim() ? null : '请输入分类名'),
    })
    if (!name?.trim()) return
    await addCategory(name.trim())
  }
  const handleAddSub = async (parent: Category) => {
    const name = await promptDialog({
      title: `在「${parent.name}」下新建子分类`,
      placeholder: '子分类名称',
      validate: (v) => (v.trim() ? null : '请输入分类名'),
    })
    if (!name?.trim()) return
    await addCategory(name.trim(), undefined, parent.id)
    // 自动展开父级，让新创建的子分类立刻可见
    setExpanded((prev) => new Set(prev).add(parent.id))
  }
  const startEdit = (id: string, name: string) => {
    setEditingId(id)
    setEditingName(name)
  }
  const commitEdit = async () => {
    if (editingId && editingName.trim())
      await renameCategory(editingId, editingName.trim())
    setEditingId(null)
  }

  const enterSelectMode = () => {
    setSelectMode(true)
    setSelectedIds(new Set())
    // 进入选择模式时自动展开所有有子分类的节点：
    // 否则用户想批量勾选子级还要先一个个 ▶ 展开，体验割裂
    const parentIds = categories
      .filter((c) => categories.some((x) => x.parentId === c.id))
      .map((c) => c.id)
    if (parentIds.length > 0) setExpanded(new Set(parentIds))
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
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return
    const allIds = collectDescendantIds(Array.from(selectedIds), categories)
    const totalCards = cards.filter((c) => allIds.has(c.categoryId)).length
    if (
      !(await confirmDialog({
        title: `删除 ${allIds.size} 个分类？`,
        message: `这些分类下所有子分类与 ${totalCards} 个书签将一并删除。`,
        confirmText: '删除',
        danger: true,
      }))
    )
      return
    await removeCategories(Array.from(selectedIds))
    exitSelectMode()
  }

  const allSelected =
    selectedIds.size === categories.length && categories.length > 0

  /**
   * 「有效选中」集合：selectedIds 展开到所有后代。
   * - 勾选了父 P → P 的所有后代都属于「选中作用域」（删除时一起被删）
   * - 用于子节点行渲染时显示"会被父一起删除"的浅色底 + 半选 checkbox，
   *   避免用户疑惑「为什么我没勾它，删了它的父它也没了」
   */
  const effectiveSelectedIds = useMemo(() => {
    if (!selectMode || selectedIds.size === 0) return new Set<string>()
    return collectDescendantIds(Array.from(selectedIds), categories)
  }, [selectMode, selectedIds, categories])

  // 是否存在任何"有子分类"的分类（用于显示/禁用一键展开按钮）
  const allParentIds = categories
    .filter((c) => categories.some((x) => x.parentId === c.id))
    .map((c) => c.id)
  const hasAnyChildren = allParentIds.length > 0
  const allExpanded =
    hasAnyChildren && allParentIds.every((id) => expanded.has(id))

  // ─── dnd-kit ─────────────────────────────────────
  // 距离阈值 6px：避免点击进入分类时误触发拖拽
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )
  // 选择 / 重命名 模式下禁用拖拽，避免冲突
  const dragDisabled = selectMode || editingId !== null

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

  /**
   * 拖动时持续计算"指针所在行的位置"——
   * 行上 30% → before，下 30% → after，中间 40% → inside（成为子节点）
   */
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
    let position: DropPosition
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
      // 自动展开目标节点，让放进去的子节点立刻可见
      setExpanded((prev) => new Set(prev).add(overCat.id))
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

  /** 渲染某父级下的兄弟节点列表（每层一个 SortableContext） */
  const renderSiblings = (
    parentId: string | undefined,
    depth: number,
  ): JSX.Element => {
    const siblings = categories
      .filter((c) => (c.parentId ?? '') === (parentId ?? ''))
      .sort((a, b) => a.order - b.order)
    return (
      <SortableContext
        items={siblings.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        {siblings.map((cat) => (
          <SortableSidebarRow
            key={cat.id}
            cat={cat}
            depth={depth}
            disabled={dragDisabled}
            dropIndicator={
              overInfo && overInfo.id === cat.id ? overInfo.position : null
            }
            renderChildren={() => renderSiblings(cat.id, depth + 1)}
            // ─── 行内交互所需上下文 ───
            activeId={activeId}
            selectMode={selectMode}
            selectedIds={selectedIds}
            effectiveSelectedIds={effectiveSelectedIds}
            editingId={editingId}
            editingName={editingName}
            expanded={expanded}
            childrenOf={childrenOf}
            countOf={countOf}
            onActivate={setActive}
            onToggleExpand={toggleExpand}
            onToggleSelect={toggleSelect}
            onStartEdit={startEdit}
            onCommitEdit={commitEdit}
            onCancelEdit={() => setEditingId(null)}
            onChangeEditingName={setEditingName}
            onIconChange={(icon) =>
              void updateCategory(cat.id, { icon })
            }
            onAddSub={handleAddSub}
            onRemove={(id) => void removeCategory(id)}
          />
        ))}
      </SortableContext>
    )
  }

  return (
    <aside
      className={cn(
        'relative shrink-0 flex flex-col',
        'border-r border-white/30 dark:border-white/10',
        'bg-white/10 dark:bg-slate-950/30 backdrop-blur-md',
        'overflow-hidden',
        // 拖拽中关闭过渡，避免跟手抖动；其他时机（折叠/展开/恢复默认）保留丝滑动画
        !resizing && 'transition-[width] duration-300 ease-in-out',
      )}
      style={{ width: collapsed ? 40 : sidebarWidth }}
      onTransitionEnd={() => setAnimating(false)}
    >
      {/* ── 流动彩光边缘 ───────────────────────────────────── */}
      <div
        className={cn(
          'sidebar-glow-edge animate-glow-flow',
          'absolute right-0 top-0 h-full w-[2px] pointer-events-none z-20',
          'transition-opacity duration-200',
          animating ? 'opacity-60' : 'opacity-0',
        )}
      />

      {/* ── 折叠状态：展开按钮 ─────────────────────────────── */}
      <div
        className={cn(
          'absolute inset-0 flex flex-col items-center pt-3 gap-2 z-10',
          'transition-opacity duration-100',
          collapsed ? 'opacity-100 delay-150' : 'opacity-0 pointer-events-none',
        )}
      >
        {/* 展开箭头 */}
        <button
          onClick={handleToggle}
          title="展开分类栏"
          className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center',
            'text-slate-500 hover:text-brand hover:bg-slate-100',
            'dark:hover:text-brand dark:hover:bg-slate-800',
            'transition-colors text-base font-light',
          )}
        >
          ›
        </button>
        {/* 折叠时小图标列（只显示顶层） */}
        <div className="flex flex-col gap-1 mt-1">
          {topLevel.slice(0, 6).map((cat) => {
            const inActivePath =
              activeId === cat.id ||
              collectDescendantIds([cat.id], categories).has(activeId ?? '')
            return (
              <button
                key={cat.id}
                onClick={() => {
                  setCollapsed(false)
                  setAnimating(true)
                  setActive(cat.id)
                }}
                title={cat.name}
                className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center text-sm',
                  'transition-colors',
                  inActivePath
                    ? 'bg-brand text-white'
                    : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                <IconView
                  value={cat.icon}
                  fallback="📁"
                  emojiClassName="text-base leading-none"
                  imgClassName="w-5 h-5 rounded-sm object-contain"
                />
              </button>
            )
          })}
        </div>
      </div>

      {/* ── 主内容（展开时显示） ────────────────────────────── */}
      <div
        className={cn(
          'flex flex-col flex-1 min-h-0 p-3',
          'transition-opacity',
          collapsed
            ? 'opacity-0 pointer-events-none duration-100'
            : 'opacity-100 duration-200 delay-150',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-2 mb-2 h-7">
          {selectMode ? (
            <>
              <span className="text-xs font-semibold text-brand">
                已选 {selectedIds.size}
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={toggleSelectAll}
                  className="btn-ghost !p-1 text-xs"
                >
                  {allSelected ? '✕全' : '✓全'}
                </button>
                <button
                  onClick={handleBatchDelete}
                  disabled={selectedIds.size === 0}
                  className={cn(
                    'btn-ghost !p-1 text-xs',
                    selectedIds.size > 0
                      ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
                      : 'opacity-40 cursor-not-allowed',
                  )}
                >
                  🗑
                </button>
                <button
                  onClick={exitSelectMode}
                  className="btn-ghost !p-1 text-xs"
                >
                  完成
                </button>
              </div>
            </>
          ) : (
            <>
              <h2
                className="flex items-center justify-center w-6 h-6 text-slate-500"
                title="分类"
              >
                <CategoriesIcon />
                <span className="sr-only">分类</span>
              </h2>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => {
                    if (allExpanded) setExpanded(new Set())
                    else setExpanded(new Set(allParentIds))
                  }}
                  className={cn(
                    'btn-ghost !p-1 h-6 w-6 flex items-center justify-center',
                    !hasAnyChildren && 'opacity-40 cursor-not-allowed',
                  )}
                  disabled={!hasAnyChildren}
                  title={
                    !hasAnyChildren
                      ? '当前没有任何子分类，从浏览器再导入或新建子分类后即可使用'
                      : allExpanded
                        ? '一键折叠全部子分类'
                        : '一键展开全部子分类'
                  }
                  aria-label={allExpanded ? '一键折叠全部' : '一键展开全部'}
                >
                  {allExpanded ? <CollapseAllIcon /> : <ExpandAllIcon />}
                </button>
                <button
                  onClick={enterSelectMode}
                  className="btn-ghost !p-1 h-6 w-6 flex items-center justify-center"
                  disabled={topLevel.length === 0}
                  title="批量管理"
                  aria-label="批量管理"
                >
                  <BulkSelectIcon />
                </button>
                <button
                  onClick={handleAdd}
                  className="btn-ghost !p-1 h-6 w-6 text-base leading-none"
                  title="新建顶层分类"
                >
                  +
                </button>
                {/* 收起按钮 */}
                <button
                  onClick={handleToggle}
                  className="btn-ghost !p-1 h-6 w-6 text-base leading-none"
                  title="收起分类栏"
                >
                  ‹
                </button>
              </div>
            </>
          )}
        </div>

        {topLevel.length === 0 && (
          <div className="px-2 py-4 text-sm text-slate-400">还没有分类</div>
        )}

        {/* DndContext 包整棵分类树。各层的 SortableContext 通过 renderSiblings 生成。
            选择/重命名模式下禁用拖拽。 */}
        <div className="flex flex-col gap-1 overflow-y-auto">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onDragCancel={() => updateOverInfo(null)}
          >
            {renderSiblings(undefined, 0)}
          </DndContext>
        </div>

        {/* 数据状态：默认收起为单行 i 信息条，hover 才浮出详情。
            放在 sidebar 底部对普通用户是噪音，所以做成被动展示。 */}
        {topLevel.length > 0 && (
          <SidebarStatsHint
            categoryCount={categories.length}
            topLevelCount={topLevel.length}
            cardCount={cards.length}
            parentCount={allParentIds.length}
            hasAnyChildren={hasAnyChildren}
          />
        )}
      </div>

      {/* ── 右边缘宽度调整柄 ─────────────────────────────────────
          - 折叠态隐藏（折叠后宽度固定 40px）
          - 6px 命中区，2px 视觉条；hover/拖拽中变为高亮 brand 色
          - 双击恢复默认宽度（240px） */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整侧栏宽度"
          aria-valuemin={SIDEBAR_WIDTH_MIN}
          aria-valuemax={SIDEBAR_WIDTH_MAX}
          aria-valuenow={sidebarWidth}
          tabIndex={-1}
          onPointerDown={handleResizeStart}
          onDoubleClick={handleResizeReset}
          title="拖动调整宽度（双击恢复默认）"
          className={cn(
            'group/resize absolute top-0 right-0 h-full w-1.5 -mr-[2px]',
            'cursor-col-resize z-30',
            // 不在拖拽态时不要拦截 onTransitionEnd 之类内部事件
            'select-none touch-none',
          )}
        >
          <div
            className={cn(
              'mx-auto h-full w-[2px] rounded-full',
              'transition-colors duration-150',
              resizing
                ? 'bg-brand'
                : 'bg-transparent group-hover/resize:bg-brand/60',
            )}
          />
        </div>
      )}
    </aside>
  )
}

/** 把任意 width 收敛到 [SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX] 范围内 */
function clampSidebarWidth(w: number): number {
  if (!Number.isFinite(w)) return SIDEBAR_WIDTH_DEFAULT
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, Math.round(w)))
}

// ─── Sortable 子组件 ────────────────────────────────
interface RowProps {
  cat: Category
  depth: number
  disabled: boolean
  /** 当前拖动时该行需要展示的视觉指示位置（before/after/inside）；null 不展示 */
  dropIndicator: DropPosition | null
  renderChildren: () => JSX.Element

  activeId: string | null
  selectMode: boolean
  selectedIds: Set<string>
  /** 选中作用域（含所有后代）；用于子节点显示「会被父一起删除」的视觉提示 */
  effectiveSelectedIds: Set<string>
  editingId: string | null
  editingName: string
  expanded: Set<string>

  childrenOf: (id: string) => Category[]
  countOf: (id: string) => number

  onActivate: (id: string) => void
  onToggleExpand: (id: string) => void
  onToggleSelect: (id: string) => void
  onStartEdit: (id: string, name: string) => void
  onCommitEdit: () => Promise<void> | void
  onCancelEdit: () => void
  onChangeEditingName: (v: string) => void
  onIconChange: (icon?: string) => void
  onAddSub: (parent: Category) => void
  onRemove: (id: string) => void
}

function SortableSidebarRow(props: RowProps) {
  const {
    cat,
    depth,
    disabled,
    dropIndicator,
    renderChildren,
    activeId,
    selectMode,
    selectedIds,
    effectiveSelectedIds,
    editingId,
    editingName,
    expanded,
    childrenOf,
    countOf,
    onActivate,
    onToggleExpand,
    onToggleSelect,
    onStartEdit,
    onCommitEdit,
    onCancelEdit,
    onChangeEditingName,
    onIconChange,
    onAddSub,
    onRemove,
  } = props

  const children = childrenOf(cat.id)
  const hasChildren = children.length > 0
  const isExpanded = expanded.has(cat.id)
  const active = activeId === cat.id
  const isSelected = selectedIds.has(cat.id)
  // 「祖先被选中、自己未直接勾选」 → 显示"将被一起删除"的浅色底 + 半选 checkbox
  const isInScope = effectiveSelectedIds.has(cat.id) && !isSelected

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cat.id, disabled })

  // v0.21.3：与 BookmarkCardItem 同款拖拽视觉增强；
  // 但侧栏行是横向窄条，scale 1.04 在窄行上微妙更明显，改用 1.02。
  // zIndex 9999 同样高于侧栏内部所有元素，确保拖到主区时不被侧栏 z-30 元素遮挡。
  const baseTransform = CSS.Transform.toString(transform) ?? ''
  const enhancedTransform = isDragging
    ? `${baseTransform} scale(1.02)`.trim()
    : baseTransform || undefined
  const style: React.CSSProperties = {
    transform: enhancedTransform,
    transition,
    opacity: isDragging ? 0.92 : 1,
    zIndex: isDragging ? 9999 : undefined,
    cursor: isDragging ? 'grabbing' : undefined,
    boxShadow: isDragging
      ? '0 12px 28px -6px rgba(99, 102, 241, 0.45), 0 4px 12px -2px rgba(0, 0, 0, 0.22)'
      : undefined,
    willChange: isDragging ? 'transform' : undefined,
  }

  // v0.20.3 跨文件夹拖拽：当主网格里的某书签卡片悬停在本侧栏行上时高亮
  const isCardDropHovered = useDropHintStore(
    (s) => s.hoverCategoryId === cat.id,
  )

  // 阻止子按钮的 pointerdown 冒泡到 dnd-kit listeners，
  // 否则点子按钮会被识别为拖拽起点
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {/* 拖拽放置指示线：before / after */}
      {dropIndicator === 'before' && (
        <div className="pointer-events-none absolute -top-px left-1 right-1 h-[2px] bg-brand rounded-full z-10" />
      )}
      {dropIndicator === 'after' && (
        <div className="pointer-events-none absolute -bottom-px left-1 right-1 h-[2px] bg-brand rounded-full z-10" />
      )}
      <div
        // 整行作为 drag handle；同时仍保留 onClick 走 dnd-kit 距离阈值（6px 以下触发 click）
        {...attributes}
        {...listeners}
        // v0.20.3 跨文件夹拖拽：标记本行为"书签卡片"的可放置目标。
        // 与上方分类树自身的拖拽（dnd-kit before/after/inside）属不同语义、不同来源，
        // 由 BookmarkGrid CategorySection 的 onDragMove 用 elementFromPoint 反查。
        data-card-drop-target={cat.id}
        className={cn(
          'group relative flex items-center gap-1.5 pr-2 py-2 rounded-xl transition-colors',
          disabled ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
          selectMode
            ? isSelected
              // 自己被勾选：实底 brand
              ? 'bg-brand/10 dark:bg-brand/20'
              : isInScope
                // 祖先被勾选：浅蓝底，提示"会被父一起删除"
                ? 'bg-brand/[0.04] dark:bg-brand/10'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800'
            : active
              ? 'bg-brand/10 text-brand ring-1 ring-brand/20 shadow-sm dark:bg-brand/20 dark:text-brand-200 dark:ring-brand/30'
              : 'text-slate-600 hover:bg-white/60 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/80 dark:hover:text-slate-100',
          // 嵌入指示：被拖动节点放下时会成为该行的子节点
          dropIndicator === 'inside' &&
            'ring-2 ring-brand ring-inset bg-brand/10 dark:bg-brand/20',
          // 跨文件夹拖拽落点高亮（淡蓝色，与上面 brand 紫蓝区分）
          isCardDropHovered &&
            'ring-2 ring-sky-400/70 dark:ring-sky-400/60 ring-inset bg-sky-50/70 dark:bg-sky-500/15',
        )}
        style={{ paddingLeft: 6 + depth * 16 }}
        onClick={() => {
          if (selectMode) {
            // 任意层级都可勾选；祖先已选时点子级会"显式追加"该子级到 selectedIds，
            // 删除结果一致（去重 + 级联），但语义上让用户能精确反勾后再操作
            onToggleSelect(cat.id)
            return
          }
          onActivate(cat.id)
          // 点击有子节点的分类时自动展开，方便一次性看到下级
          if (hasChildren && !isExpanded) onToggleExpand(cat.id)
        }}
      >
        {/* 展开/折叠按钮（无子节点时占位保持对齐） */}
        {hasChildren ? (
          <button
            className={cn(
              'w-5 h-5 flex items-center justify-center text-[11px] shrink-0 leading-none rounded',
              'transition-transform duration-150 font-bold',
              isExpanded ? 'rotate-90' : '',
              !selectMode && active
                ? 'text-brand hover:bg-brand/10 dark:text-brand-200 dark:hover:bg-brand/20'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-700',
            )}
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand(cat.id)
            }}
            onPointerDown={stop}
            title={isExpanded ? '折叠子分类' : '展开子分类'}
          >
            ▶
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}

        {selectMode ? (
          <span
            className={cn(
              'w-4 h-4 rounded border flex items-center justify-center text-[10px] shrink-0',
              isSelected
                ? 'bg-brand border-brand text-white'
                : isInScope
                  // 祖先已选 → 半选态：浅 brand 底 + 短横，明示"会被一起删除"
                  ? 'bg-brand/30 border-brand/40 text-white'
                  : 'border-slate-300 dark:border-slate-600',
            )}
            title={
              isSelected
                ? '已选中'
                : isInScope
                  ? '祖先已选中，会被一起删除（点击可单独显式勾选）'
                  : '未选中'
            }
          >
            {isSelected ? '✓' : isInScope ? '–' : ''}
          </span>
        ) : (
          <span
            className="shrink-0"
            onClick={stop}
            onPointerDown={stop}
          >
            <IconPicker
              value={cat.icon}
              defaultEmoji={depth === 0 ? '📁' : '📂'}
              onChange={onIconChange}
              trigger={(open) => (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    open()
                  }}
                  onPointerDown={stop}
                  title="点击修改图标"
                  className={cn(
                    'flex items-center justify-center w-6 h-6 rounded-lg',
                    'hover:bg-slate-200/70 dark:hover:bg-slate-700/60',
                    !selectMode && active && 'bg-white/60 hover:bg-white/80 dark:bg-white/10 dark:hover:bg-white/15',
                  )}
                >
                  <IconView
                    value={cat.icon}
                    fallback={depth === 0 ? '📁' : '📂'}
                    emojiClassName="text-base leading-none"
                    imgClassName="w-4 h-4 rounded-sm object-contain"
                  />
                </button>
              )}
            />
          </span>
        )}

        {editingId === cat.id ? (
          <input
            autoFocus
            value={editingName}
            onChange={(e) => onChangeEditingName(e.target.value)}
            onBlur={() => void onCommitEdit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onCommitEdit()
              if (e.key === 'Escape') onCancelEdit()
            }}
            onClick={stop}
            onPointerDown={stop}
            className="flex-1 min-w-0 bg-transparent outline-none text-sm"
          />
        ) : (
          <span
            className={cn(
              'flex-1 min-w-0 text-sm truncate',
              active ? 'font-semibold' : 'font-medium',
            )}
            title={cat.name}
            onDoubleClick={(e) => {
              if (selectMode) return
              e.stopPropagation()
              onStartEdit(cat.id, cat.name)
            }}
          >
            {cat.name}
          </span>
        )}

        <span
          className={cn(
            'inline-flex min-w-5 h-5 px-1.5 items-center justify-center rounded-full text-[11px] shrink-0 tabular-nums',
            !selectMode && active
              ? 'bg-brand/15 text-brand dark:bg-brand/25 dark:text-brand-100'
              : 'bg-slate-100/80 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
          )}
        >
          {countOf(cat.id)}
        </span>

        {!selectMode && (
          <>
            {/* 新建子分类（hover 整行时显示，减少视觉噪音） */}
            <button
              className={cn(
                'w-5 h-5 flex items-center justify-center rounded text-base leading-none shrink-0',
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity',
                active
                  ? 'text-brand hover:text-brand-700 hover:bg-brand/10 dark:text-brand-100 dark:hover:bg-brand/20'
                  : 'text-slate-400 hover:text-brand hover:bg-slate-200/80 dark:hover:bg-slate-700',
              )}
              onClick={(e) => {
                e.stopPropagation()
                onAddSub(cat)
              }}
              onPointerDown={stop}
              title={`在「${cat.name}」下新建子分类`}
            >
              +
            </button>
            {/* 删除（hover 整行时显示，垃圾桶 icon 比 ✕ 语义更直观） */}
            <button
              className={cn(
                'w-5 h-5 flex items-center justify-center rounded shrink-0',
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity',
                active
                  ? 'text-brand/80 hover:text-red-500 hover:bg-red-50 dark:text-brand-100 dark:hover:bg-red-500/15'
                  : 'text-slate-400 hover:text-red-500 hover:bg-slate-200/80 dark:hover:bg-slate-700',
              )}
              onClick={async (e) => {
                e.stopPropagation()
                const ok = await confirmDialog({
                  title: `删除分类「${cat.name}」？`,
                  message: hasChildren
                    ? '该分类下还有子文件夹和书签，删除将一并清除。'
                    : '该分类下所有书签也会被一并删除。',
                  confirmText: '删除',
                  danger: true,
                })
                if (ok) onRemove(cat.id)
              }}
              onPointerDown={stop}
              title="删除"
            >
              <TrashIcon />
            </button>
          </>
        )}
      </div>

      {/* 子节点：选择模式下也照常展开，让用户能批量勾选任意层级 */}
      {hasChildren && isExpanded && (
        <div>{renderChildren()}</div>
      )}
    </div>
  )
}

/** 批量多选 icon（左侧三个 ✓、右侧三条横线，经典 list-checks 形态） */
function BulkSelectIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* 左侧 3 个勾选 */}
      <polyline points="3 5 5 7 8 4" />
      <polyline points="3 12 5 14 8 11" />
      <polyline points="3 19 5 21 8 18" />
      {/* 右侧 3 条横线 */}
      <line x1="11" y1="5.5" x2="20" y2="5.5" />
      <line x1="11" y1="12.5" x2="20" y2="12.5" />
      <line x1="11" y1="19.5" x2="20" y2="19.5" />
    </svg>
  )
}

/** 分类列表 icon（左侧三圆点 + 三横线，经典 list-menu 形态） */
function CategoriesIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** 双下箭头：一键展开全部（语义为"全部向下打开") */
function ExpandAllIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="7 6 12 11 17 6" />
      <polyline points="7 13 12 18 17 13" />
    </svg>
  )
}

/** 双上箭头：一键折叠全部（语义为"全部向上收起") */
function CollapseAllIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="7 11 12 6 17 11" />
      <polyline points="7 18 12 13 17 18" />
    </svg>
  )
}

/** 12x12 垃圾桶图标（stroke 风格，与侧栏行高/+号视觉重量协调） */
function TrashIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

function collectDescendantIds(
  ids: string[],
  allCats: Category[],
): Set<string> {
  const result = new Set(ids)
  const queue = [...ids]
  while (queue.length > 0) {
    const pid = queue.shift()!
    for (const c of allCats) {
      if (c.parentId === pid && !result.has(c.id)) {
        result.add(c.id)
        queue.push(c.id)
      }
    }
  }
  return result
}

/* ─────────────────────────────────────────────────────────────
 * 侧栏底部统计：默认只显示一行 i + 摘要，hover 后弹出详细面板。
 * 设计取舍：
 * - 普通用户不关心"含子分类的 20 个"这种数据；常驻显示是噪音
 * - 但仍有诊断价值（"为什么没看到子分类？"）；hover 兜底即可
 * - 弹层用 absolute 定位在按钮上方，避免被 sidebar 的 overflow 裁剪
 * ───────────────────────────────────────────────────────────── */
function SidebarStatsHint({
  categoryCount,
  topLevelCount,
  cardCount,
  parentCount,
  hasAnyChildren,
}: {
  categoryCount: number
  topLevelCount: number
  cardCount: number
  parentCount: number
  hasAnyChildren: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2 px-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className={cn(
          'w-full flex items-center justify-between gap-2',
          'text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300',
          'transition-colors',
        )}
        title="点击或悬停查看详细统计"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-1.5">
          <InfoIconMini />
          <span className="tabular-nums">
            {categoryCount} 分类 · {cardCount} 书签
          </span>
        </span>
        <span className="text-[10px] opacity-50">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className={cn(
            'absolute left-2 right-2 bottom-full mb-1 z-30 p-2.5 rounded-md',
            'bg-white dark:bg-slate-800',
            'border border-slate-200 dark:border-slate-700 shadow-lg',
            'text-[11px] leading-relaxed text-slate-500 dark:text-slate-300',
          )}
        >
          <div className="flex items-center justify-between">
            <span>分类总数</span>
            <span className="tabular-nums text-slate-700 dark:text-slate-100">
              {categoryCount}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>顶层分类</span>
            <span className="tabular-nums text-slate-700 dark:text-slate-100">
              {topLevelCount}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>含子分类的</span>
            <span
              className={cn(
                'tabular-nums',
                hasAnyChildren
                  ? 'text-brand font-medium'
                  : 'text-slate-700 dark:text-slate-100',
              )}
            >
              {parentCount}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>书签总数</span>
            <span className="tabular-nums text-slate-700 dark:text-slate-100">
              {cardCount}
            </span>
          </div>
          {!hasAnyChildren && (
            <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/60 text-slate-400 leading-snug">
              没有子分类时，鼠标 hover 到分类右侧的{' '}
              <span className="font-bold">+</span> 可新建子分类。
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function InfoIconMini() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="12" y1="7.5" x2="12" y2="7.51" />
    </svg>
  )
}
