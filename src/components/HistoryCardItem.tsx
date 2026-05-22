import { useBookmarkStore } from '../stores/useBookmarkStore'
import type { BrowserHistoryItem } from '../stores/useBookmarkStore'
import { toast } from '../stores/useToastStore'
import { getHostname } from '../utils/favicon'
import { cn } from '../utils/cn'
import { CardMenu, MenuIcons, type CardMenuItem } from './CardMenu'
import { FaviconImg } from './FaviconImg'
import { confirmDialog } from './Dialog'

interface Props {
  item: BrowserHistoryItem
}

/**
 * 「浏览器历史」卡片：
 * 与 BookmarkCardItem 视觉对齐，但语义不同：
 * - 不属于任何分类，无 cardId
 * - 不可拖拽、不可编辑、不可加备注
 * - 提供两个操作：
 *   1. 「加入书签」→ 添加为当前激活分类的书签（若没有激活分类则禁用）
 *   2. 「从历史删除」→ 同步删除浏览器原生历史 + 当前列表
 *
 * 视觉与书签卡区分：
 * - 标题左边加一个时钟小图标，并在底部加 "来自浏览器历史" 提示
 * - hover 时菜单按钮位置和样式与 BookmarkCardItem 完全一致，避免操作割裂感
 */
export function HistoryCardItem({ item }: Props) {
  const activeCategoryId = useBookmarkStore((s) => s.activeCategoryId)
  const addCardFromHistory = useBookmarkStore((s) => s.addCardFromHistory)
  const deleteHistoryUrl = useBookmarkStore((s) => s.deleteHistoryUrl)
  const cardSize = useBookmarkStore((s) => s.settings.cardSize)
  const cardIconSize = useBookmarkStore((s) => s.settings.cardIconSize)
  // v0.21.19：compact 走单独的方形分支（与 CompactBookmarkCard 对齐尺寸）
  // large = 原「中」(h-32)，standard = 原「小」(h-24)
  const size =
    cardSize === 'large'
      ? {
          card: 'p-3.5 h-32 gap-2.5',
          icon: 'w-9 h-9 rounded-lg',
          title: 'text-sm font-semibold leading-snug line-clamp-2',
          host: 'text-[11px]',
        }
      : {
          card: 'p-3 h-24 gap-2',
          icon: 'w-8 h-8 rounded',
          title: 'text-sm font-medium truncate',
          host: 'text-[11px]',
        }

  const openUrl = () => {
    window.open(item.url, '_blank', 'noopener,noreferrer')
  }

  const handleAddToBookmarks = async () => {
    if (!activeCategoryId) {
      toast.warning('请先选择分类', '在左侧选择一个分类后再把历史项加入书签')
      return
    }
    try {
      const card = await addCardFromHistory({ url: item.url, title: item.title })
      if (card) {
        toast.success('已加入书签', `已添加到当前分类：${item.title}`)
      }
    } catch (err) {
      toast.error('加入失败', err instanceof Error ? err.message : '未知错误')
    }
  }

  const handleDelete = async () => {
    if (
      !(await confirmDialog({
        title: `从浏览器历史中删除「${item.title}」？`,
        message: '这会同时影响浏览器其它地方的历史记录。',
        danger: true,
      }))
    ) {
      return
    }
    void deleteHistoryUrl(item.url)
  }

  const menuItems: CardMenuItem[] = [
    {
      key: 'add-bookmark',
      label: activeCategoryId ? '加入当前分类' : '加入书签（请先选分类）',
      icon: <MenuIcons.Note />,
      disabled: !activeCategoryId,
      onSelect: () => void handleAddToBookmarks(),
    },
    {
      key: 'delete-history',
      label: '从历史删除',
      icon: <MenuIcons.Trash />,
      danger: true,
      onSelect: () => void handleDelete(),
    },
  ]

  /**
   * v0.21.19 精简档：方形卡，居中图标 + 标题。
   * 与 CompactBookmarkCard 同尺寸/同 hover 动效，保证同一行 bookmark 与 history 视觉一致。
   * 右下角保留 🕒 角标用于区分历史项。
   */
  if (cardSize === 'compact') {
    const small = cardIconSize === 'small'
    return (
      <div
        onClick={openUrl}
        className={cn(
          'group/compact select-none cursor-pointer',
          'flex flex-col items-center justify-center gap-2.5',
          'w-28 h-28 justify-self-center',
          'rounded-xl px-3 py-3',
          'bg-transparent',
          'transition-all duration-200 ease-out',
          'hover:bg-white/65 dark:hover:bg-slate-800/55 hover:backdrop-blur',
          'hover:-translate-y-0.5',
          'hover:shadow-[0_2px_4px_rgba(15,23,42,0.05),0_12px_24px_-4px_rgba(99,102,241,0.18)]',
          'dark:hover:shadow-[0_2px_4px_rgba(0,0,0,0.3),0_14px_28px_-4px_rgba(99,102,241,0.35)]',
        )}
        title={`${item.title}\n${item.url}\n（来自浏览器历史）`}
      >
        <div
          className={cn(
            small ? 'w-8 h-8 rounded-md' : 'w-11 h-11 rounded-lg',
            'shrink-0 flex items-center justify-center relative',
            'bg-slate-100/80 dark:bg-slate-700/60 ring-1 ring-slate-200/70 dark:ring-slate-600/60',
          )}
        >
          <FaviconImg
            url={item.url}
            size={small ? 18 : 28}
            className={small ? 'w-4 h-4 rounded-sm object-contain' : 'w-7 h-7 rounded-sm object-contain'}
            fallbackClassName={small ? 'w-4 h-4 rounded-sm text-[10px]' : 'w-7 h-7 rounded-sm text-xs'}
          />
          {/* 历史项角标：右下角小时钟 */}
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full',
              'bg-white dark:bg-slate-900',
              'border border-slate-200 dark:border-slate-600',
              'flex items-center justify-center text-[8px] leading-none text-slate-400',
            )}
            aria-hidden
          >
            🕒
          </span>
        </div>
        <div
          className={cn(
            'w-full text-center text-xs leading-tight truncate',
            'text-slate-700 dark:text-slate-200',
          )}
        >
          {item.title}
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={openUrl}
      className={cn(
        'card group select-none cursor-pointer overflow-hidden flex flex-col',
        size.card,
        'hover:border-brand/40 hover:shadow-brand/10',
        // 加点淡的背景区分历史项 vs 真书签
        'bg-slate-50/40 dark:bg-slate-800/40',
      )}
      title={`点击打开：${item.url}`}
    >
      {/* 顶部：图标 + 标题/域名 + hover 菜单 */}
      <div className="flex items-start gap-2">
        <div
          className={cn(
            size.icon,
            'shrink-0 flex items-center justify-center',
            'bg-slate-100 dark:bg-slate-700 relative',
          )}
        >
          <FaviconImg
            url={item.url}
            size={28}
            className="w-7 h-7 rounded-sm object-contain"
            fallbackClassName="w-7 h-7 rounded-sm text-xs"
          />
          {/* 右下角小标记：表明这是历史项 */}
          <span
            className={cn(
              'absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full',
              'bg-white dark:bg-slate-900',
              'border border-slate-200 dark:border-slate-600',
              'flex items-center justify-center text-[8px] leading-none',
              'text-slate-400',
            )}
            title="来自浏览器历史"
            aria-hidden
          >
            🕒
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className={size.title} title={item.title}>
            {item.title}
          </div>
          <div className={cn('mt-1 text-slate-400 truncate', size.host)}>
            {getHostname(item.url)}
          </div>
        </div>

        <div
          className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <CardMenu
            ariaLabel={`历史项「${item.title}」操作菜单`}
            items={menuItems}
          />
        </div>
      </div>

      {/* 底部：来源提示，hover 才出现，避免视觉噪音 */}
      <div
        className={cn(
          'mt-auto text-[10px] leading-none text-slate-400 dark:text-slate-500',
          'opacity-0 group-hover:opacity-100 transition-opacity',
        )}
      >
        来自浏览器历史
      </div>
    </div>
  )
}
