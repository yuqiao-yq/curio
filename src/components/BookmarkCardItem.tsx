import { memo, useEffect, useRef, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { BookmarkCard, UserSettings } from '../types/bookmark'
import { getHostname } from '../utils/favicon'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { usePageIndex } from '../ai/services/usePageIndex'
import { cn } from '../utils/cn'
import { IconPicker } from './IconPicker'
import { isImageIcon } from '../utils/icon'
import { CardMenu, MenuIcons, type CardMenuItem } from './CardMenu'
import { FaviconImg } from './FaviconImg'
import { RelatedReadingDialog } from './RelatedReadingDialog'
import { TagsEditorDialog, TagIcon } from './TagsEditorDialog'
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
 * 三档样式（v0.21.19 起）：
 * - compact 精简：走单独的 CompactBookmarkCard 渲染分支，不复用本表
 * - standard 标准：默认尺寸，含域名 / 备注 / tags
 * - large 大：信息更舒展
 *
 * 注：compact 也放进 Record 是为了类型完整性；CompactBookmarkCard 不读它。
 */
const CARD_SIZE_STYLES: Record<
  UserSettings['cardSize'],
  {
    card: string
    editingCard: string
    icon: string
    title: string
    host: string
    note: string
    addNote: string
  }
> = {
  // compact 在 BookmarkCardItemImpl 里走单独的 CompactBookmarkCard 分支，
  // 这里的值只在「编辑态退回标准卡渲染」时被读到 → 给个紧凑的兜底
  compact: {
    card: 'p-3 h-24 gap-2',
    editingCard: 'p-3 min-h-24 gap-2',
    icon: 'w-8 h-8 rounded',
    title: 'text-sm font-semibold leading-snug truncate text-slate-800 dark:text-slate-100',
    host: 'text-[11px]',
    // 用 truncate（单行 + nowrap + ellipsis）替代 line-clamp-1：
    // line-clamp + padding 在 webkit 下会让第 2 行字符的顶部 1~4px 漏出
    // 到 padding-bottom 区域（视觉上像被切了一半的下半截字）。truncate
    // 是 nowrap 的硬截断，根本不存在第 2 行，彻底无漏。
    note: 'text-[11px] leading-snug truncate rounded px-1.5 py-1 -mx-1.5',
    addNote: 'text-[11px] rounded px-1.5 py-1 -mx-1.5',
  },
  // standard = 原「小」(h-24) — 老 'sm' 用户迁移落到这里
  standard: {
    card: 'p-3 h-24 gap-2',
    editingCard: 'p-3 min-h-24 gap-2',
    icon: 'w-8 h-8 rounded',
    title: 'text-sm font-semibold leading-snug truncate text-slate-800 dark:text-slate-100',
    host: 'text-[11px]',
    // 同上：truncate 替代 line-clamp-1，规避 webkit line-clamp + padding 漏行
    note: 'text-[11px] leading-snug truncate rounded px-1.5 py-1 -mx-1.5',
    addNote: 'text-[11px] rounded px-1.5 py-1 -mx-1.5',
  },
  // large = 原「中」(h-32) — 老 'md' / 'lg' 用户迁移落到这里
  large: {
    card: 'p-3.5 h-32 gap-2.5',
    editingCard: 'p-3.5 min-h-32 gap-2.5',
    icon: 'w-9 h-9 rounded-lg',
    title: 'text-sm font-semibold leading-snug line-clamp-2 text-slate-800 dark:text-slate-100',
    host: 'text-[11px]',
    // large 允许 2 行，必须保留 line-clamp-2。同时显式约束 max-h 为 2 行的
    // 内容高度 + 上下 padding（leading-snug=1.375 × text-xs=12px = 16.5px/行
    // 2 行 = 33px + py-1.5 = 12px → max-h ≈ 45px），二次保险防止"半行字"
    // 漏到 padding 区。
    note: 'text-xs leading-snug line-clamp-2 max-h-[45px] overflow-hidden rounded-md px-2 py-1.5 -mx-2',
    addNote: 'text-xs rounded-md px-2 py-1.5 -mx-2',
  },
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
function BookmarkCardItemImpl({
  card,
  draggable = true,
  searchMeta,
}: Props) {
  const removeCard = useBookmarkStore((s) => s.removeCard)
  const updateCard = useBookmarkStore((s) => s.updateCard)
  const recordRecentOpen = useBookmarkStore((s) => s.recordRecentOpen)
  const setSearchKeyword = useBookmarkStore((s) => s.setSearchKeyword)
  const cardSize = useBookmarkStore((s) => s.settings.cardSize)
  const cardIconSize = useBookmarkStore((s) => s.settings.cardIconSize)
  const size = CARD_SIZE_STYLES[cardSize ?? 'standard'] ?? CARD_SIZE_STYLES.standard
  // v0.21.19：cardIconSize='small' 时把图标容器（含底图层）缩到 favicon 视觉权重
  const iconContainerCls = cardIconSize === 'small' ? 'w-6 h-6 rounded' : size.icon
  const iconVariant: 'small' | 'standard' = cardIconSize === 'small' ? 'small' : 'standard'
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
  // v0.22.x 卡片标签编辑弹层
  const [showTagsEditor, setShowTagsEditor] = useState(false)

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

  /**
   * v0.21.4：拖拽视觉改由 DragOverlay 接管（CategorySection 内挂载）
   *
   * 原 inline z-index/scale/shadow 方案修不了"被左侧菜单栏遮挡"，
   * 因为 main 容器 overflow-y: auto 会强制 overflow-x 也变 auto，
   * 卡片 transform 穿过主区边界后会被 main 直接 clip 掉。
   *
   * DragOverlay 把"被拖中的卡片视觉"portal 到 <body>，逃出 main 的裁剪，
   * 同时自带 dropAnimation（吸附效果）。
   *
   * v0.21.14：isDragging 时 opacity 0 让原 active 元素彻底不可见
   *（之前 0.3 ghost 在"前拖"方向的 sortable transform 让位 + 松手重置
   * 链路里会产生可见的中间帧 → 闪烁；后拖方向因 transform 方向恰好抵消
   * 没事）。0 全方向消除中间帧，反正用户看的是 DragOverlay 的浮层。
   */
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
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

  /**
   * v0.21.19 精简档：单独分支渲染。
   * - 不显示域名/备注/tags/hover 菜单（精简模式的核心是只看图标 + 名称）
   * - 编辑态仍走默认分支（标准卡），避免精简卡里塞两个输入框
   * - drop / drag 行为不受影响：dnd-kit ref 仍挂在外层 <div>
   */
  if (cardSize === 'compact' && !editing) {
    return (
      <CompactBookmarkCard
        card={card}
        setRefs={setRefs}
        style={style}
        dragProps={dragProps}
        iconVariant={iconVariant}
        onClick={(e) => {
          if (e.defaultPrevented) return
          openUrl()
        }}
      />
    )
  }

  return (
    <>
    <div
      ref={setRefs}
      style={style}
      {...dragProps}
      // 跨文件夹拖拽桥接：CategorySection 的 useEffect+mousemove
      // 用 elementsFromPoint 反查鼠标下方的 drop target；自己被拖时通过 matches
      // activeSelector 跳过。
      data-dnd-card={card.id}
      data-tour="bookmark-card-any"
      onClick={(e) => {
        if (editing) return
        if (e.defaultPrevented) return
        openUrl()
      }}
      className={cn(
        // relative 是为下方 absolute 定位的菜单按钮提供容器（v0.22.x：
        // 之前菜单在 flex 内占布局，小屏会把标题/tags 挤到只剩 4~5 字符宽度）
        'card group select-none overflow-hidden relative',
        'flex flex-col',
        editing
          ? cn('cursor-default ring-2 ring-brand/40 shadow-md', size.editingCard)
          : cn('cursor-pointer hover:border-brand/40 hover:shadow-brand/10', size.card),
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
                    iconContainerCls,
                    'shrink-0 flex items-center justify-center',
                    'bg-slate-100 dark:bg-slate-700 hover:ring-2 hover:ring-brand/40 transition',
                  )}
                >
                  <CardIconView
                    icon={draftIcon}
                    fallbackUrl={draftUrl || card.url}
                    variant={iconVariant}
                  />
                </button>
              )}
            />
          </div>
        ) : (
          <div
            className={cn(
              iconContainerCls,
              'shrink-0 flex items-center justify-center',
              'bg-slate-100 dark:bg-slate-700 ring-1 ring-slate-200/70 dark:ring-slate-600/60',
            )}
          >
            <CardIconView icon={card.icon} fallbackUrl={card.url} variant={iconVariant} />
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
            <div
              className={size.title}
              title={card.title}
            >
              {card.title}
            </div>
            <div className="mt-1 flex items-center gap-1 min-w-0">
              <span className={cn(size.host, 'text-slate-400 truncate min-w-0 flex-1')}>
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

      </div>

      {/*
        菜单按钮：绝对定位浮在卡片右上角，不占 flex 布局空间。
        小屏（grid-cols-2，约 160 px 卡宽）下标题/tags 因此能多吃 ~32 px，
        不再被压成 "首页-..." 那种 4~5 字的极限截断。
        hover 时菜单显示，会浮在标题最右端的字符上 —— 用户 hover 本来就是
        要操作菜单，可以接受这一点点视觉覆盖。
      */}
      {!editing && (
        <div
          className={cn(
            'absolute top-2 right-2 z-10',
            'opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity',
          )}
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
                key: 'tags',
                label: card.tags && card.tags.length > 0 ? '编辑标签' : '添加标签',
                icon: <TagIcon />,
                onSelect: () => setShowTagsEditor(true),
              } satisfies CardMenuItem,
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
              'w-full text-left text-slate-500 dark:text-slate-400',
              size.note,
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
              'w-full text-left',
              size.addNote,
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
    {/* v0.22.x 卡片标签编辑弹层 */}
    {showTagsEditor && (
      <TagsEditorDialog
        card={card}
        onClose={() => setShowTagsEditor(false)}
      />
    )}
    </>
  )
}

/**
 * v0.21.x：BookmarkCardItem 是渲染最频繁的叶子组件。整张网格通常 50+ 卡，
 * store 任意更新（拖拽、设置滑块、最近使用记录）都会触发 BookmarkGrid 重渲染，
 * 进而连带 N 张卡片全部 reconcile。这里用 React.memo + 自定义浅比较切断冒泡。
 *
 * - `card` 引用稳定：store 的 update/move 都走 `cards.map(c => c.id === id ? next : c)`，
 *   未变更的 card 引用保持不变 → 直接 === 即可。
 * - `searchMeta` 在搜索路径里由父组件内联构造（每次渲染都是新对象），
 *   需要按字段浅比；非搜索路径恒为 undefined，快路径直接命中。
 * - 内部读到的 store 状态（cardSize / isPageIndexed / actions）都通过
 *   useBookmarkStore 选择器订阅，React.memo 不会拦截这部分订阅更新。
 */
function arePropsEqual(prev: Props, next: Props): boolean {
  if (prev.card !== next.card) return false
  if (prev.draggable !== next.draggable) return false
  const a = prev.searchMeta
  const b = next.searchMeta
  if (a === b) return true
  if (!a || !b) return false
  if (a.categoryPath !== b.categoryPath) return false
  if (a.dupCount !== b.dupCount) return false
  // dupCategoryPaths 在搜索路径里也是每次渲染新数组；按内容比
  if (a.dupCategoryPaths.length !== b.dupCategoryPaths.length) return false
  for (let i = 0; i < a.dupCategoryPaths.length; i++) {
    if (a.dupCategoryPaths[i] !== b.dupCategoryPaths[i]) return false
  }
  return true
}

export const BookmarkCardItem = memo(BookmarkCardItemImpl, arePropsEqual)

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
            'inline-flex items-center px-1.5 h-4 rounded-full text-[10px] leading-none',
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
            'inline-flex items-center px-1.5 h-4 rounded-full text-[10px] leading-none',
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
 *
 * v0.21.4 export：DragOverlay 内的 CardDragPreview 也复用本组件，保持图标一致。
 */
export function CardIconView({
  icon,
  fallbackUrl,
  variant = 'standard',
}: {
  icon?: string
  fallbackUrl: string
  /** v0.21.19：'small' 让 emoji/图片/favicon 同步缩小（≈ 浏览器 favicon 视觉权重） */
  variant?: 'small' | 'standard'
}) {
  const small = variant === 'small'
  const imgCls = small
    ? 'w-4 h-4 rounded-sm object-contain'
    : 'w-7 h-7 rounded-sm object-contain'
  if (icon && !isImageIcon(icon)) {
    // emoji / 文本
    return (
      <span
        className={cn(small ? 'text-base' : 'text-xl', 'leading-none select-none')}
        aria-hidden
      >
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
        className={imgCls}
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
      size={small ? 18 : 28}
      className={imgCls}
      fallbackClassName={cn(small ? 'w-4 h-4 text-[10px]' : 'w-7 h-7 text-xs', 'rounded-sm')}
    />
  )
}

/**
 * v0.21.4：拖拽时的卡片预览（DragOverlay 内渲染）
 *
 * 不调 useSortable 避免与原 sortable 元素的 id 冲突；纯展示组件。
 * 视觉上比静态卡稍微"提"起：scale 1.04 + 大阴影 + cursor grabbing。
 *
 * 不展示 hover 操作按钮 / 编辑态 / tag chips（拖拽中用不到，反而干扰）；
 * 保留最关键的"图标 + 标题 + 域名 + 备注"四件套。
 */
function CardDragPreviewImpl({ card }: { card: BookmarkCard }) {
  const cardSize = useBookmarkStore((s) => s.settings.cardSize)
  const cardIconSize = useBookmarkStore((s) => s.settings.cardIconSize)
  const size = CARD_SIZE_STYLES[cardSize ?? 'standard'] ?? CARD_SIZE_STYLES.standard
  const iconContainerCls = cardIconSize === 'small' ? 'w-6 h-6 rounded' : size.icon
  const iconVariant: 'small' | 'standard' = cardIconSize === 'small' ? 'small' : 'standard'

  return (
    <div
      // v0.21.7：标记本节点是 DragOverlay 内的预览，
      // findDropTargetAt 扫元素栈时跳过这个子树，
      // 否则 elementsFromPoint 命中的最顶层就是它，永远查不到下方真实 drop target。
      data-drag-preview="true"
      className={cn('card select-none overflow-hidden flex flex-col', size.card)}
      style={{
        cursor: 'grabbing',
        boxShadow:
          '0 18px 40px -8px rgba(99, 102, 241, 0.5), 0 6px 16px -4px rgba(0, 0, 0, 0.25)',
        transform: 'scale(1.04)',
        transformOrigin: 'center',
      }}
    >
      <div className="flex items-start gap-2">
        <div
          className={cn(
            iconContainerCls,
            'shrink-0 flex items-center justify-center',
            'bg-slate-100 dark:bg-slate-700 ring-1 ring-slate-200/70 dark:ring-slate-600/60',
          )}
        >
          <CardIconView icon={card.icon} fallbackUrl={card.url} variant={iconVariant} />
        </div>
        <div className="flex-1 min-w-0">
          <div className={size.title} title={card.title}>
            {card.title}
          </div>
          <div className={cn('mt-1 text-slate-400 truncate', size.host)}>
            {getHostname(card.url)}
          </div>
        </div>
      </div>
      {card.description && (
        <div
          className={cn(
            'mt-auto w-full text-left text-slate-500 dark:text-slate-400',
            size.note,
          )}
        >
          {card.description}
        </div>
      )}
    </div>
  )
}

export const CardDragPreview = memo(CardDragPreviewImpl)

/**
 * v0.21.19 精简档书签卡片。
 *
 * 视觉：默认透明无边、只有居中图标 + 下方名称；hover 时切换到 ghost 灰底 + 阴影 + 轻浮起。
 * 交互：整卡点击打开（与标准卡一致）；不暴露 hover 菜单——精简模式信息密度优先，
 *      编辑 / 删除请通过卡片右键或临时切回标准档操作。
 */
function CompactBookmarkCard({
  card,
  setRefs,
  style,
  dragProps,
  iconVariant = 'standard',
  onClick,
}: {
  card: BookmarkCard
  setRefs: (el: HTMLDivElement | null) => void
  style: React.CSSProperties
  dragProps: Record<string, unknown>
  /** v0.21.19：'small' 把图标 + 底图层同步缩小 */
  iconVariant?: 'small' | 'standard'
  onClick: (e: React.MouseEvent) => void
}) {
  const small = iconVariant === 'small'
  return (
    <div
      ref={setRefs}
      style={style}
      {...dragProps}
      data-dnd-card={card.id}
      data-tour="bookmark-card-any"
      onClick={onClick}
      className={cn(
        'group/compact select-none cursor-pointer',
        'flex flex-col items-center justify-center gap-2.5',
        // 与 BookmarkGrid 中 + 占位 compact 档对齐：w/h 28（112px），整体方形
        'w-28 h-28 justify-self-center',
        'rounded-xl px-3 py-3',
        // 默认：完全透明（让背景墙纸/容器透出）
        'bg-transparent',
        // hover：毛玻璃方形 + 上浮 + 与 .card:hover 同款双层投影
        'transition-all duration-200 ease-out',
        'hover:bg-white/65 dark:hover:bg-slate-800/55 hover:backdrop-blur',
        'hover:-translate-y-0.5',
        'hover:shadow-[0_2px_4px_rgba(15,23,42,0.05),0_12px_24px_-4px_rgba(99,102,241,0.18)]',
        'dark:hover:shadow-[0_2px_4px_rgba(0,0,0,0.3),0_14px_28px_-4px_rgba(99,102,241,0.35)]',
      )}
      title={`${card.title}\n${card.url}`}
    >
      <div
        className={cn(
          small ? 'w-8 h-8 rounded-md' : 'w-11 h-11 rounded-lg',
          'shrink-0 flex items-center justify-center',
          'bg-slate-100/80 dark:bg-slate-700/60 ring-1 ring-slate-200/70 dark:ring-slate-600/60',
        )}
      >
        <CardIconView icon={card.icon} fallbackUrl={card.url} variant={iconVariant} />
      </div>
      <div
        className={cn(
          'w-full text-center text-xs leading-tight truncate',
          'text-slate-700 dark:text-slate-200',
        )}
      >
        {card.title}
      </div>
    </div>
  )
}
