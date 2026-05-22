import { useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Category } from '../types/bookmark'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { useDropHintStore } from '../stores/useDropHintStore'
import { cn } from '../utils/cn'
import { IconPicker } from './IconPicker'
import { IconView } from '../utils/icon'
import { CardMenu, MenuIcons } from './CardMenu'
import { confirmDialog, promptDialog } from './Dialog'

interface Props {
  category: Category
  /**
   * 是否参与 dnd-kit 排序拖拽。
   * 默认 false（旧用法兼容，不拖拽）；BookmarkGrid 的 root section 文件夹区块传 true，
   * 让用户能拖拽 FolderCard 在兄弟间排序，或拖到其他文件夹 / 侧栏行改变父级。
   */
  draggable?: boolean
}

/**
 * 文件夹卡片：在内容区展示子分类，点击进入该分类层级。
 * 不参与拖拽排序（区别于书签卡片）。
 *
 * 布局（与 BookmarkCardItem 视觉对齐）：
 *   ┌───────────────────────────────────┐
 *   │ [icon] 名称............... [⋮]    │
 *   │        X 个文件夹 · Y 个书签      │
 *   │                                   │
 *   │ 备注（已有则常显，无则 hover 才显）│
 *   └───────────────────────────────────┘
 *
 * 交互：
 * - 左侧图标 → 弹出 IconPicker
 * - 右上角 ⋮ → 重命名 / 添加(编辑)备注 / 删除
 * - 重命名：就地编辑（Enter 保存 / Esc 取消 / blur 提交）
 * - 备注：与书签卡同款，prompt 编辑（保留弹窗以便多行输入）
 */
export function FolderCard({ category, draggable = false }: Props) {
  const setActive = useBookmarkStore((s) => s.setActiveCategory)
  const cards = useBookmarkStore((s) => s.cards)
  const categories = useBookmarkStore((s) => s.categories)
  const removeCategory = useBookmarkStore((s) => s.removeCategory)
  const updateCategory = useBookmarkStore((s) => s.updateCategory)
  const cardSize = useBookmarkStore((s) => s.settings.cardSize)
  // 跨文件夹拖拽（v0.21.0+）：当某书签卡片 / 文件夹卡片悬停在本卡上时，订阅 hint 高亮
  const isDropHovered = useDropHintStore(
    (s) => s.hoverCategoryId === category.id,
  )

  // 该文件夹下的直接书签数 + 子文件夹数
  const directCards = cards.filter((c) => c.categoryId === category.id).length
  const subFolders = categories.filter((c) => c.parentId === category.id).length
  const subtitle =
    [
      subFolders > 0 && `${subFolders} 个文件夹`,
      directCards > 0 && `${directCards} 个书签`,
    ]
      .filter(Boolean)
      .join(' · ') || '空'

  // ─── 就地重命名 ───────────────────────────────
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState(category.name)
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (renaming) {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    }
  }, [renaming])

  const startRename = () => {
    setDraftName(category.name)
    setRenaming(true)
  }
  const cancelRename = () => {
    setDraftName(category.name)
    setRenaming(false)
  }
  const commitRename = () => {
    const name = draftName.trim()
    if (!name || name === category.name) {
      cancelRename()
      return
    }
    void updateCategory(category.id, { name })
    setRenaming(false)
  }

  // ─── 备注 ───────────────────────────────
  const handleEditNote = async () => {
    const next = await promptDialog({
      title: category.description ? '编辑备注' : '为该文件夹添加备注',
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

  const handleDelete = async () => {
    const hasChildren = categories.some((c) => c.parentId === category.id)
    if (
      await confirmDialog({
        title: `删除文件夹「${category.name}」？`,
        message: hasChildren
          ? '该文件夹下还有子文件夹和书签，删除将一并清除。'
          : '该文件夹下所有书签也会被一并删除。',
        confirmText: '删除',
        danger: true,
      })
    )
      void removeCategory(category.id)
  }

  // v0.21.1：FolderCard 也参与 dnd-kit 排序拖拽（同 BookmarkCardItem 同款）。
  // 重命名时禁用，避免 input 与 drag 互相干扰。
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: category.id, disabled: !draggable || renaming })
  // v0.21.3：与 BookmarkCardItem 同款拖拽视觉增强（zIndex/scale/shadow/cursor）
  const baseTransform = CSS.Transform.toString(transform) ?? ''
  const enhancedTransform = isDragging
    ? `${baseTransform} scale(1.04)`.trim()
    : baseTransform || undefined
  const style: React.CSSProperties = {
    transform: enhancedTransform,
    transition,
    opacity: isDragging ? 0.92 : 1,
    zIndex: isDragging ? 9999 : undefined,
    cursor: isDragging ? 'grabbing' : undefined,
    boxShadow: isDragging
      ? '0 18px 40px -8px rgba(99, 102, 241, 0.45), 0 6px 16px -4px rgba(0, 0, 0, 0.25)'
      : undefined,
    willChange: isDragging ? 'transform' : undefined,
  }
  // 拖动自己时本卡不应该高亮自己（hint 检测里已防护，这里再做一道兜底）
  const showDropHint = isDropHovered && !isDragging
  // FolderCard 不参与 compact 模式（文件夹本身需要展示子项数量），compact 落到「小」尺寸
  // large = 原「中」(h-32)，standard/compact = 原「小」(h-24)
  const size =
    cardSize === 'large'
      ? {
          card: 'p-3.5 h-32 gap-2.5',
          editingCard: 'p-3.5 min-h-32 gap-2.5',
          icon: 'w-9 h-9 rounded-lg',
        }
      : {
          card: 'p-3 h-24 gap-2',
          editingCard: 'p-3 min-h-24 gap-2',
          icon: 'w-8 h-8 rounded',
        }

  // 防止"拖拽结束 → mouseup 触发 onClick → 误进入子文件夹"
  // 与 BookmarkCardItem 同款保护：原生 pointerdown/up 监听位移 > 5px 标记
  const cardRef = useRef<HTMLDivElement | null>(null)
  const draggedRecently = useRef(false)
  const setRefs = (el: HTMLDivElement | null) => {
    cardRef.current = el
    setNodeRef(el)
  }
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    let downX = 0
    let downY = 0
    const onDown = (e: PointerEvent) => {
      downX = e.clientX
      downY = e.clientY
    }
    const onUp = (e: PointerEvent) => {
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY)
      draggedRecently.current = moved > 5
    }
    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointerup', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointerup', onUp)
    }
  }, [])

  return (
    <div
      ref={setRefs}
      style={style}
      // v0.21.0+ 跨文件夹拖拽：标记本卡为可放置目标，
      // CategorySection 的 onDragMove 用 elementFromPoint 查询此属性。
      data-card-drop-target={category.id}
      // v0.21.1：FolderCard 自身被拖时的"我是谁"标识，让 findDropTargetAt 排除自己。
      data-dnd-folder={category.id}
      // 拖拽 listeners 挂在根 div（与 BookmarkCardItem 同款；
      // 子按钮 / IconPicker / CardMenu 已 stopPropagation pointerdown）
      {...(draggable && !renaming ? { ...attributes, ...listeners } : {})}
      className={cn(
        'card group select-none overflow-hidden transition-shadow',
        'flex flex-col',
        renaming
          ? cn('cursor-default ring-2 ring-brand/40 shadow-md', size.editingCard)
          : draggable
            ? cn('cursor-grab active:cursor-grabbing hover:border-brand/40 hover:shadow-brand/10', size.card)
            : cn('cursor-pointer hover:border-brand/40 hover:shadow-brand/10', size.card),
        // 拖拽落点高亮（淡蓝色，与卡片自身的 brand 紫蓝区分开）
        showDropHint &&
          'ring-2 ring-sky-400/70 dark:ring-sky-400/60 bg-sky-50/60 dark:bg-sky-500/10 shadow-md',
      )}
      onClick={() => {
        if (renaming) return
        if (draggedRecently.current) return // 防拖拽误触
        setActive(category.id)
      }}
      title={
        showDropHint
          ? `放入文件夹：${category.name}`
          : renaming
            ? undefined
            : `打开文件夹：${category.name}`
      }
    >
      {/* 顶部：图标 + 名称(+副标题 / 或编辑 input) + ⋮ */}
      <div className="flex items-start gap-2">
        <div
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <IconPicker
            value={category.icon}
            defaultEmoji="📂"
            onChange={(icon) => void updateCategory(category.id, { icon })}
            trigger={(open) => (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); open() }}
                title="点击修改图标"
                className={cn(
                  'flex items-center justify-center shrink-0',
                  size.icon,
                  'bg-slate-100 dark:bg-slate-700',
                  'hover:ring-2 hover:ring-brand/40 transition',
                )}
              >
                <IconView
                  value={category.icon}
                  fallback="📂"
                  emojiClassName="text-2xl leading-none"
                  imgClassName="w-7 h-7 rounded object-contain"
                />
              </button>
            )}
          />
        </div>

        {renaming ? (
          <div className="flex-1 min-w-0">
            <input
              ref={nameInputRef}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') cancelRename()
              }}
              placeholder="文件夹名称"
              className={cn(
                'w-full text-sm font-medium px-2 py-1 rounded',
                'bg-white dark:bg-slate-900',
                'border border-slate-200 dark:border-slate-700',
                'focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
              )}
            />
            <div className="text-xs text-slate-400 mt-1 px-1">{subtitle}</div>
          </div>
        ) : (
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate" title={category.name}>
              {category.name}
            </div>
            <div className="text-xs text-slate-400 truncate">{subtitle}</div>
          </div>
        )}

        {!renaming && (
          <div
            className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <CardMenu
              ariaLabel={`文件夹「${category.name}」操作菜单`}
              items={[
                {
                  key: 'rename',
                  label: '重命名',
                  icon: <MenuIcons.Edit />,
                  onSelect: startRename,
                },
                {
                  key: 'note',
                  label: category.description ? '编辑备注' : '添加备注',
                  icon: <MenuIcons.Note />,
                  onSelect: () => void handleEditNote(),
                },
                {
                  key: 'delete',
                  label: '删除',
                  icon: <MenuIcons.Trash />,
                  danger: true,
                  onSelect: () => void handleDelete(),
                },
              ]}
            />
          </div>
        )}
      </div>

      {/* 底部：备注（已有 → 常显；无 → hover 才显） */}
      {!renaming && (
        <div className="mt-auto">
          {category.description ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                void handleEditNote()
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                'w-full text-left text-xs text-slate-500 dark:text-slate-400',
                'leading-snug line-clamp-2',
                'rounded px-1.5 py-1 -mx-1.5',
                'hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors',
              )}
              title="点击编辑备注"
            >
              {category.description}
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                void handleEditNote()
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                'w-full text-left text-xs',
                'rounded px-1.5 py-1 -mx-1.5',
                'text-slate-300 dark:text-slate-600',
                'hover:text-brand hover:bg-slate-100 dark:hover:bg-slate-700/60',
                'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                'transition-opacity',
              )}
              title="为该文件夹添加备注"
            >
              + 添加备注
            </button>
          )}
        </div>
      )}
    </div>
  )
}
