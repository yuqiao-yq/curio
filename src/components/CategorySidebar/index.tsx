import { useState } from 'react'
import {
  DndContext,
  closestCenter,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import type { Category } from '../../types/bookmark'
import {
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from '../../types/bookmark'
import { useBookmarkStore } from '../../stores/useBookmarkStore'
import { collectDescendantIds } from '../../stores/useBookmarkStore/helpers'
import { cn } from '../../utils/cn'
import { confirmDialog, promptDialog } from '../Dialog'
import { IconView } from '../../utils/icon'
import {
  BulkSelectIcon,
  CategoriesIcon,
  CollapseAllIcon,
  ExpandAllIcon,
} from './icons'
import { SidebarStatsHint } from './SidebarStatsHint'
import { SortableSidebarRow } from './SortableSidebarRow'
import { useSidebarWidth } from './hooks/useSidebarWidth'
import { useExpandTree } from './hooks/useExpandTree'
import { useSelectMode } from './hooks/useSelectMode'
import { useSidebarDnd } from './hooks/useSidebarDnd'

/* ──────────────────────────────────────────────────────────────────────
 * 侧栏主组件：纯组合。
 *
 * 状态与副作用拆到 4 个 hook：
 *   - useSidebarWidth   宽度拖拽 + 持久化
 *   - useExpandTree     节点展开/折叠
 *   - useSelectMode     批量选择 + 删除
 *   - useSidebarDnd     dnd-kit sensors + before/after/inside 计算
 *
 * 行渲染与拖拽视觉拆到 SortableSidebarRow；底部统计拆到 SidebarStatsHint。
 * ────────────────────────────────────────────────────────────────────── */

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

  // 折叠整个侧栏
  const [collapsed, setCollapsed] = useState(false)
  // 过渡期间显示彩光
  const [animating, setAnimating] = useState(false)

  const { sidebarWidth, resizing, handleResizeStart, handleResizeReset } =
    useSidebarWidth(savedSidebarWidth, collapsed, updateSettings)

  const { expanded, toggleExpand, expand, collapseAll, expandIds } =
    useExpandTree()

  const {
    selectMode,
    selectedIds,
    effectiveSelectedIds,
    allSelected,
    enterSelectMode,
    exitSelectMode,
    toggleSelect,
    toggleSelectAll,
  } = useSelectMode(categories, expandIds)

  const { sensors, overInfo, handleDragMove, handleDragEnd, handleDragCancel } =
    useSidebarDnd(categories, moveCategory, expand)

  const handleToggle = () => {
    setAnimating(true)
    setCollapsed((v) => !v)
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
    expand(parent.id)
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

  // 是否存在任何"有子分类"的分类（用于显示/禁用一键展开按钮）
  const allParentIds = categories
    .filter((c) => categories.some((x) => x.parentId === c.id))
    .map((c) => c.id)
  const hasAnyChildren = allParentIds.length > 0
  const allExpanded =
    hasAnyChildren && allParentIds.every((id) => expanded.has(id))

  // 选择 / 重命名 模式下禁用拖拽，避免冲突
  const dragDisabled = selectMode || editingId !== null

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
            onIconChange={(icon) => void updateCategory(cat.id, { icon })}
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
                    if (allExpanded) collapseAll()
                    else expandIds(allParentIds)
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
            onDragCancel={handleDragCancel}
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
