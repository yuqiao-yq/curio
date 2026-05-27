import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Category } from '../../types/bookmark'
import { useDropHintStore } from '../../stores/useDropHintStore'
import { cn } from '../../utils/cn'
import { IconPicker } from '../IconPicker'
import { confirmDialog } from '../Dialog'
import { IconView } from '../../utils/icon'
import { TrashIcon } from './icons'
import type { DropPosition } from './utils'

/* ──────────────────────────────────────────────────────────────────────
 * 侧栏分类树中的一行：dnd-kit 可拖拽 + 内嵌交互（IconPicker / 重命名 /
 * 计数徽章 / 新建子分类 / 删除）。
 *
 * 所有交互通过 props 注入；本组件不读 store，只渲染。这样可以保持
 * 拖拽行的纯粹性，逻辑层（CategorySidebar 主组件）拿到 store 后统一分发。
 * ────────────────────────────────────────────────────────────────────── */

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

export function SortableSidebarRow(props: RowProps) {
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
    <div
      ref={setNodeRef}
      style={style}
      className="relative"
      data-tour="sidebar-category-row"
    >
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
              ? 'bg-brand/10 dark:bg-brand/20'
              : isInScope
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
