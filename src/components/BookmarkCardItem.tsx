import { useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { BookmarkCard } from '../types/bookmark'
import { getHostname } from '../utils/favicon'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { usePageIndex } from '../ai/services/usePageIndex'
import { cn } from '../utils/cn'
import { IconPicker } from './IconPicker'
import { isImageIcon } from '../utils/icon'
import { CardMenu, MenuIcons, type CardMenuItem } from './CardMenu'
import { FaviconImg } from './FaviconImg'
import { RelatedReadingDialog } from './RelatedReadingDialog'
import { confirmDialog, promptDialog } from './Dialog'

interface Props {
  card: BookmarkCard
  /**
   * 是否参与 dnd-kit 排序拖拽。默认 true（在 BookmarkGrid 的常规分类区域使用）。
   * "最近使用"模块需要传 false：顺序由 openedAt 决定，不允许用户手动排序。
   */
  draggable?: boolean
  /**
   * 仅在「全库搜索」结果中传入的额外元信息。
   * - 让用户在搜索结果里清晰看到「这条来自哪个分类」
   * - 同一 URL 在多个分类下都有副本时，提示「+ N 个副本所在分类」
   */
  searchMeta?: SearchMeta
}

export interface SearchMeta {
  /** 该卡片所在分类的完整路径（如 "工作 / 收藏 / 导航"） */
  categoryPath: string
  /** 同一 URL 还存在于其他分类下的副本数（去重前 - 1） */
  dupCount: number
  /** 副本所在分类路径列表（去重，按出现顺序） */
  dupCategoryPaths: string[]
}

/**
 * 书签卡片：
 * - 整张卡片点击 → 在新标签页打开 URL
 *   （dnd-kit 已配置 5px 拖拽阈值；下方 useEffect 再做一道保险，
 *    若 pointerdown→up 位移 > 5px 则标记为「拖拽刚结束」，本次 click 跳过打开）
 * - hover 时右上角显示编辑/删除按钮，✎ 进入「就地编辑」模式：
 *   - 同时编辑「标题」和「URL」两个字段
 *   - 编辑时禁用 dnd 拖拽与整卡 click（避免干扰输入）
 *   - Enter 保存 / Esc 取消
 * - 底部备注区始终可见（描述/Description）：
 *   - 已有备注 → 直接展示备注文本（最多 2 行），点击进入编辑
 *   - 无备注  → 展示低调的「+ 添加备注」占位按钮
 */
export function BookmarkCardItem({
  card,
  draggable = true,
  searchMeta,
}: Props) {
  const removeCard = useBookmarkStore((s) => s.removeCard)
  const updateCard = useBookmarkStore((s) => s.updateCard)
  const recordRecentOpen = useBookmarkStore((s) => s.recordRecentOpen)
  const setSearchKeyword = useBookmarkStore((s) => s.setSearchKeyword)
  /**
   * 该卡是否已被 §6.1 抓取过正文（成功状态）。
   * 由 usePageIndex store 统一广播，避免每张卡片各自查 dexie。
   * 内容抓取属于"附加增强"，未配置 / 未抓取时该角标完全不显示。
   */
  const isPageIndexed = usePageIndex((s) => s.indexedIds.has(card.id))

  // disabled 让 useSortable 不响应拖拽，但仍保留 ref 用于其他逻辑（最近使用模块场景）
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, disabled: !draggable })

  const cardRef = useRef<HTMLDivElement | null>(null)
  const draggedRecently = useRef(false)

  // 就地编辑状态
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(card.title)
  const [draftUrl, setDraftUrl] = useState(card.url)
  const [draftIcon, setDraftIcon] = useState<string | undefined>(card.icon)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  // §7.4 相关阅读弹层显隐
  const [showRelated, setShowRelated] = useState(false)

  // 合并 ref（既给 dnd-kit，也给本组件用）
  const setRefs = (el: HTMLDivElement | null) => {
    cardRef.current = el
    setNodeRef(el)
  }

  // 用原生事件捕获 pointerdown/up，不干扰 dnd-kit 的 listeners
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    let downX = 0
    let downY = 0
    const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY }
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

  // 进入编辑模式时聚焦标题
  useEffect(() => {
    if (editing) titleInputRef.current?.focus()
  }, [editing])

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const openUrl = () => {
    if (draggedRecently.current) return
    // 记录"最近使用"——这是用户在本扩展内主动打开书签的唯一入口
    void recordRecentOpen(card.id)
    window.open(card.url, '_blank', 'noopener,noreferrer')
  }

  const startEdit = () => {
    setDraftTitle(card.title)
    setDraftUrl(card.url)
    setDraftIcon(card.icon)
    setEditing(true)
  }
  const cancelEdit = () => {
    setEditing(false)
  }
  const saveEdit = async () => {
    const title = draftTitle.trim()
    const url = draftUrl.trim()
    if (!title || !url) return
    // 没有任何变化时直接退出，不写库
    if (title === card.title && url === card.url && draftIcon === card.icon) {
      setEditing(false)
      return
    }
    await updateCard(card.id, { title, url, icon: draftIcon })
    setEditing(false)
  }

  const handleEditNote = async () => {
    const next = await promptDialog({
      title: card.description ? '编辑备注' : '为该书签添加备注',
      defaultValue: card.description ?? '',
      placeholder: '一句话描述这个书签…',
      allowEmpty: true,
      multiline: true,
    })
    if (next === null) return
    void updateCard(card.id, { description: next.trim() || undefined })
  }

  const handleDelete = async () => {
    if (
      await confirmDialog({
        title: `删除「${card.title}」？`,
        message: card.url,
        confirmText: '删除',
        danger: true,
      })
    )
      void removeCard(card.id)
  }

  // 编辑模式下：解绑 dnd 拖拽 listeners、禁用整卡 click
  // draggable=false 时也不绑定（避免 sortable 的视觉抖动 / 无意义事件）
  const dragProps = editing || !draggable ? {} : { ...attributes, ...listeners }
  const canSave =
    draftTitle.trim().length > 0 &&
    draftUrl.trim().length > 0 &&
    (
      draftTitle.trim() !== card.title ||
      draftUrl.trim() !== card.url ||
      draftIcon !== card.icon
    )

  return (
    <>
    <div
      ref={setRefs}
      style={style}
      {...dragProps}
      // v0.20.3 跨文件夹拖拽桥接：CategorySection 的 DndContext.onDragMove
      // 用 elementFromPoint 反查鼠标下方的 drop target，先把本卡 pointer-events
      // 临时禁掉再调，避免命中自己。这里给一个稳定的查找属性。
      data-dnd-card={card.id}
      onClick={(e) => {
        if (editing) return
        if (e.defaultPrevented) return
        openUrl()
      }}
      className={cn(
        'card group p-3 select-none',
        'flex flex-col gap-2',
        editing
          ? 'cursor-default min-h-24 ring-2 ring-brand/40 shadow-md'
          : 'cursor-pointer h-24 hover:border-brand/40 hover:shadow-brand/10',
      )}
      title={editing ? undefined : `点击打开：${card.url}`}
    >
      {/* 顶部：图标 + 标题/域名（或编辑表单） + hover 操作 */}
      <div className="flex items-start gap-2">
        {editing ? (
          <div
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <IconPicker
              value={draftIcon}
              defaultEmoji="🔗"
              onChange={(icon) => setDraftIcon(icon)}
              trigger={(open) => (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); open() }}
                  title="点击修改图标"
                  className={cn(
                    'w-8 h-8 rounded shrink-0 flex items-center justify-center',
                    'bg-slate-100 dark:bg-slate-700 hover:ring-2 hover:ring-brand/40 transition',
                  )}
                >
                  <CardIconView
                    icon={draftIcon}
                    fallbackUrl={draftUrl || card.url}
                  />
                </button>
              )}
            />
          </div>
        ) : (
          <div
            className={cn(
              'w-8 h-8 rounded shrink-0 flex items-center justify-center',
              'bg-slate-100 dark:bg-slate-700',
            )}
          >
            <CardIconView icon={card.icon} fallbackUrl={card.url} />
          </div>
        )}

        {editing ? (
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <input
              ref={titleInputRef}
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') void saveEdit()
                if (e.key === 'Escape') cancelEdit()
              }}
              placeholder="标题"
              className={cn(
                'w-full text-sm font-medium px-2 py-1 rounded',
                'bg-white dark:bg-slate-900',
                'border border-slate-200 dark:border-slate-700',
                'focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
              )}
            />
            <input
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') void saveEdit()
                if (e.key === 'Escape') cancelEdit()
              }}
              placeholder="https://..."
              spellCheck={false}
              className={cn(
                'w-full text-xs px-2 py-1 rounded font-mono',
                'bg-white dark:bg-slate-900',
                'border border-slate-200 dark:border-slate-700',
                'focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
              )}
            />
          </div>
        ) : (
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate" title={card.title}>
              {card.title}
            </div>
            <div className="flex items-center gap-1 min-w-0">
              <span className="text-xs text-slate-400 truncate min-w-0 flex-1">
                {getHostname(card.url)}
              </span>
              {/* §6.1 已抓取正文角标：低调一点，仅 hover 卡片时变实
                  hover 角标自身可看 tooltip；不可点击（V2.0 §6.2 RAG 上线后再赋予点击行为） */}
              {isPageIndexed && (
                <span
                  className={cn(
                    'shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 rounded text-[9px] leading-none',
                    'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300',
                    'opacity-60 group-hover:opacity-100 transition-opacity',
                  )}
                  aria-hidden
                  title="已索引正文 · 可参与 AI 语义搜索"
                  onClick={(e) => e.stopPropagation()}
                >
                  📄
                </span>
              )}
              {/* 标签 chips：紧贴 hostname 右侧；超过 2 个用 +N 收纳。
                  点击 chip → 设置全局 searchKeyword=#tag 触发 BookmarkGrid 切换为 tag 筛选视图。
                  draggable=false 的搜索结果卡片仍然显示，方便用户继续按 tag 收敛 */}
              {card.tags && card.tags.length > 0 && (
                <CardTagChips
                  tags={card.tags}
                  onPickTag={(t) => setSearchKeyword(`#${t}`)}
                />
              )}
            </div>
          </div>
        )}

        {!editing && (
          <div
            className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0"
            // 菜单触发器自身不应触发卡片打开
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <CardMenu
              ariaLabel={`书签「${card.title}」操作菜单`}
              items={[
                {
                  key: 'edit',
                  label: '编辑',
                  icon: <MenuIcons.Edit />,
                  onSelect: startEdit,
                },
                {
                  key: 'note',
                  label: card.description ? '编辑备注' : '添加备注',
                  icon: <MenuIcons.Note />,
                  onSelect: () => void handleEditNote(),
                },
                {
                  key: 'related',
                  label: '相关阅读',
                  icon: <MenuIcons.Sparkle />,
                  onSelect: () => setShowRelated(true),
                } satisfies CardMenuItem,
                {
                  key: 'delete',
                  label: '删除',
                  icon: <MenuIcons.Trash />,
                  danger: true,
                  onSelect: () => void handleDelete(),
                } satisfies CardMenuItem,
              ]}
            />
          </div>
        )}
      </div>

      {/* 底部区：编辑 → 保存取消；搜索模式 → 分类来源 chip；常态 → 备注 */}
      <div className="mt-auto">
        {editing ? (
          <div className="flex items-center justify-end gap-1.5 pt-1">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); cancelEdit() }}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                'px-2.5 py-1 rounded text-xs',
                'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700',
              )}
            >取消</button>
            <button
              type="button"
              disabled={!canSave}
              onClick={(e) => { e.stopPropagation(); void saveEdit() }}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                'px-2.5 py-1 rounded text-xs font-medium',
                canSave
                  ? 'bg-brand text-white hover:bg-brand-600'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-slate-700 dark:text-slate-500',
              )}
            >保存</button>
          </div>
        ) : searchMeta ? (
          <SearchSourceChip meta={searchMeta} />
        ) : card.description ? (
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
            {card.description}
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
              // 仅 hover 卡片时显示，避免空状态干扰阅读
              'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              'transition-opacity',
            )}
            title="为该书签添加备注"
          >
            + 添加备注
          </button>
        )}
      </div>
    </div>
    {/* §7.4 相关阅读弹层；createPortal 自挂 body，不受卡片 overflow 限制 */}
    {showRelated && (
      <RelatedReadingDialog
        card={card}
        onClose={() => setShowRelated(false)}
      />
    )}
    </>
  )
}

/**
 * 搜索结果卡片底部的「分类来源」小标。
 * - 单一来源：📂 工作 / 收藏 / 导航
 * - 有副本：右侧追加「+N」徽标，title 列出所有副本分类，
 *   让用户清楚「这个 URL 在 N 个分类下都存了，看到的只是其中一份」
 */
function SearchSourceChip({ meta }: { meta: SearchMeta }) {
  const tooltip =
    meta.dupCount > 0
      ? `分类：${meta.categoryPath}\n该 URL 还存在于 ${meta.dupCount} 个其他分类：\n  • ${meta.dupCategoryPaths.join('\n  • ')}`
      : `分类：${meta.categoryPath}`
  return (
    <div
      className={cn(
        'w-full flex items-center gap-1.5 text-[11px] leading-none',
        'text-slate-500 dark:text-slate-400',
        'rounded px-1.5 py-1 -mx-1.5',
      )}
      title={tooltip}
      onClick={(e) => e.stopPropagation()}
    >
      <span aria-hidden>📂</span>
      <span className="flex-1 min-w-0 truncate">{meta.categoryPath}</span>
      {meta.dupCount > 0 && (
        <span
          className={cn(
            'shrink-0 inline-flex items-center justify-center px-1 h-4 rounded',
            'text-[10px] font-medium tabular-nums',
            'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300',
          )}
        >
          +{meta.dupCount}
        </span>
      )}
    </div>
  )
}

/**
 * 卡片标签 chips（紧凑展示）
 * - 默认显示前 2 个 chip；超过用 +N 收纳
 * - hover chip → tooltip 显示完整 tag；hover +N → tooltip 列出所有
 * - click chip → 触发 onPickTag（在主区切换为 tag 筛选视图）
 *
 * 这里不与卡片整体的 click 共享事件 —— stopPropagation 避免误打开 URL；
 * 也禁用 dnd-kit 拖拽（pointerdown stopPropagation），让用户能稳定点中。
 */
function CardTagChips({
  tags,
  onPickTag,
}: {
  tags: string[]
  onPickTag: (tag: string) => void
}) {
  const MAX_VISIBLE = 2
  const visible = tags.slice(0, MAX_VISIBLE)
  const overflow = tags.length - visible.length

  return (
    <span
      className="inline-flex items-center gap-0.5 shrink-0"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      title={tags.map((t) => `#${t}`).join(' ')}
    >
      {visible.map((t) => (
        <button
          key={t}
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onPickTag(t)
          }}
          className={cn(
            'inline-flex items-center px-1 h-3.5 rounded text-[9px] leading-none',
            'bg-brand/10 text-brand hover:bg-brand/20',
            'max-w-[64px] truncate transition-colors',
          )}
          title={`筛选含 #${t} 的书签`}
        >
          {t}
        </button>
      ))}
      {overflow > 0 && (
        <span
          className={cn(
            'inline-flex items-center px-1 h-3.5 rounded text-[9px] leading-none',
            'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
            'tabular-nums',
          )}
          title={tags.slice(MAX_VISIBLE).map((t) => `#${t}`).join(' ')}
        >
          +{overflow}
        </span>
      )}
    </span>
  )
}

/**
 * 卡片图标统一渲染：
 * - 用户自定义 icon 是 emoji/字符 → 文本展示
 * - 用户自定义 icon 是 https:// 或 data:image/ → 图片展示
 * - 没设置 → 走 favicon（基于 fallbackUrl）
 */
function CardIconView({
  icon,
  fallbackUrl,
}: {
  icon?: string
  fallbackUrl: string
}) {
  if (icon && !isImageIcon(icon)) {
    // emoji / 文本
    return (
      <span className="text-xl leading-none select-none" aria-hidden>
        {icon}
      </span>
    )
  }
  // 用户上传了图片图标 → 直接渲染（失败时 hidden 兜底，与之前行为一致）
  if (icon) {
    return (
      <img
        src={icon}
        alt=""
        className="w-7 h-7 rounded-sm object-contain"
        onError={(e) => {
          ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
        }}
      />
    )
  }
  // 没设置 icon → 走 favicon；失败时显示域名首字母占位块（FaviconImg 内置）
  return (
    <FaviconImg
      url={fallbackUrl}
      size={28}
      className="w-7 h-7 rounded-sm object-contain"
      fallbackClassName="w-7 h-7 rounded-sm text-xs"
    />
  )
}
