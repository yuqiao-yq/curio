import { useEffect, useRef, useState } from 'react'
import type { Category } from '../types/bookmark'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { cn } from '../utils/cn'
import { IconPicker } from './IconPicker'
import { IconView } from '../utils/icon'
import { CardMenu, MenuIcons } from './CardMenu'
import { confirmDialog, promptDialog } from './Dialog'

interface Props {
  category: Category
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
export function FolderCard({ category }: Props) {
  const setActive = useBookmarkStore((s) => s.setActiveCategory)
  const cards = useBookmarkStore((s) => s.cards)
  const categories = useBookmarkStore((s) => s.categories)
  const removeCategory = useBookmarkStore((s) => s.removeCategory)
  const updateCategory = useBookmarkStore((s) => s.updateCategory)

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

  return (
    <div
      className={cn(
        'card group p-3 select-none',
        'flex flex-col gap-2',
        renaming
          ? 'cursor-default min-h-24 ring-2 ring-brand/40 shadow-md'
          : 'cursor-pointer h-24 hover:border-brand/40 hover:shadow-brand/10',
      )}
      onClick={() => {
        if (renaming) return
        setActive(category.id)
      }}
      title={renaming ? undefined : `打开文件夹：${category.name}`}
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
                  'flex items-center justify-center w-8 h-8 rounded shrink-0',
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
