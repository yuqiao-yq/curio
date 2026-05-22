import { useEffect, useMemo, useState } from 'react'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import type { BrowserHistoryItem } from '../stores/useBookmarkStore'
import type { BookmarkCard } from '../types/bookmark'
import { BookmarkCardItem } from './BookmarkCardItem'
import { HistoryCardItem } from './HistoryCardItem'
import { confirmDialog, promptDialog } from './Dialog'
import { cn } from '../utils/cn'
import { IconView } from '../utils/icon'

const GRID_COLS =
  'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3'

/**
 * 最近使用 模块：常驻在主页面顶部（搜索模式与无激活分类时不渲染）
 *
 * 数据来源：
 * - 「扩展内」点击过的书签卡片（store.recentEntries）
 * - 可选：浏览器全局历史（store.browserHistoryItems）—— 由 settings.recentIncludeBrowserHistory 开关控制
 *
 * 合并策略（开启浏览器历史时）：
 * - 按 url 去重：同一 url 已存在为书签卡片时，仅保留书签项（保留用户的标题/图标自定义）
 * - 时间排序：书签项用 entry.openedAt，历史项用 item.lastVisit，倒序
 * - 截断到 recentLimit
 */
export function RecentSection() {
  const recentEntries = useBookmarkStore((s) => s.recentEntries)
  const recentLimit = useBookmarkStore((s) => s.recentLimit)
  const setRecentLimit = useBookmarkStore((s) => s.setRecentLimit)
  const clearRecent = useBookmarkStore((s) => s.clearRecent)
  const cards = useBookmarkStore((s) => s.cards)

  const includeHistory = useBookmarkStore(
    (s) => !!s.settings.recentIncludeBrowserHistory,
  )
  const browserHistoryItems = useBookmarkStore((s) => s.browserHistoryItems)
  const updateSettings = useBookmarkStore((s) => s.updateSettings)
  const loadBrowserHistory = useBookmarkStore((s) => s.loadBrowserHistory)

  const [collapsed, setCollapsed] = useState(false)

  // 开启状态下：每次组件挂载、用户切回该新标签页时刷新历史
  // 通过 visibilitychange 兜底，避免长时间停留后看到陈旧数据
  useEffect(() => {
    if (!includeHistory) return
    void loadBrowserHistory()
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadBrowserHistory()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [includeHistory, loadBrowserHistory])

  // 合并 + 去重 + 截断
  const visibleItems = useMemo<RecentRenderItem[]>(() => {
    const cardMap = new Map(cards.map((c) => [c.id, c]))
    const bookmarkUrlSet = new Set<string>()
    const merged: RecentRenderItem[] = []

    // 1. 先把扩展内的"打开记录"展开为书签项（顺便记录 url 用于去重）
    for (const entry of recentEntries) {
      const card = cardMap.get(entry.cardId)
      if (!card) continue
      bookmarkUrlSet.add(card.url)
      merged.push({
        kind: 'bookmark',
        card,
        time: entry.openedAt,
      })
    }

    // 2. 开启历史时叠加：同 url 已被书签覆盖的跳过
    if (includeHistory) {
      for (const item of browserHistoryItems) {
        if (bookmarkUrlSet.has(item.url)) continue
        merged.push({
          kind: 'history',
          item,
          time: item.lastVisit,
        })
      }
    }

    // 3. 按时间倒序，截断到 N
    merged.sort((a, b) => b.time - a.time)
    return merged.slice(0, recentLimit)
  }, [recentEntries, recentLimit, cards, includeHistory, browserHistoryItems])

  const handleConfigLimit = async () => {
    const next = await promptDialog({
      title: '展示几个最近使用？',
      message: '取值范围 1 ~ 100',
      defaultValue: String(recentLimit),
      placeholder: '例如 8',
      validate: (v) => {
        const n = parseInt(v.trim(), 10)
        if (!Number.isFinite(n) || n <= 0) return '请输入大于 0 的整数'
        if (n > 100) return '最多 100'
        return null
      },
    })
    if (next === null) return
    const n = parseInt(next.trim(), 10)
    await setRecentLimit(n)
  }

  const handleClear = async () => {
    if (recentEntries.length === 0) return
    if (
      !(await confirmDialog({
        title: '清空最近使用记录？',
        message: '仅清空扩展内的打开记录，不会影响浏览器历史。',
        confirmText: '清空',
        danger: true,
      }))
    )
      return
    await clearRecent()
  }

  const handleToggleHistory = async () => {
    if (!includeHistory) {
      // 关 → 开：提示一次隐私影响，避免用户误操作后看到全部历史被吓到
      const ok = await confirmDialog({
        title: '开启「合并浏览器历史」？',
        message:
          '开启后，「最近使用」会显示你在浏览器中访问过的任意网站（不限于书签）。\n\n这只是读取本地历史用于展示，不会上传任何数据。',
        confirmText: '开启',
      })
      if (!ok) return
    }
    await updateSettings({ recentIncludeBrowserHistory: !includeHistory })
  }

  return (
    <section className="mb-6">
      {/* Header：与 CategorySection 子 section 视觉一致 */}
      <header className="flex items-center gap-2 mb-3 group/sec">
        <button
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? '展开' : '折叠'}
          className={cn(
            'w-7 h-7 flex items-center justify-center text-base rounded',
            'text-slate-500 hover:text-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800',
            'opacity-0 group-hover/sec:opacity-100 focus-visible:opacity-100 transition-[opacity,transform] duration-150',
            collapsed ? '' : 'rotate-90',
          )}
        >
          ▸
        </button>
        <IconView
          fallback="🕒"
          boxed
          boxClassName="w-6 h-6"
          emojiClassName="text-sm leading-none"
        />
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          最近使用
        </span>
        <span className="text-xs text-slate-400 tabular-nums">
          {visibleItems.length} / {recentLimit}
        </span>
        <div className="flex-1" />

        {/* 开关：包含浏览器历史 */}
        <button
          onClick={handleToggleHistory}
          className={cn(
            'opacity-0 group-hover/sec:opacity-100 focus-visible:opacity-100 transition-opacity',
            'btn-ghost !p-1 h-6 px-1.5 text-[11px] leading-none whitespace-nowrap',
            'inline-flex items-center gap-1',
            includeHistory && 'text-brand !opacity-100',
          )}
          title={
            includeHistory
              ? '已包含浏览器历史，点击关闭'
              : '点击开启：把浏览器全局历史也合并进来'
          }
        >
          <span aria-hidden>{includeHistory ? '🌐' : '🌐'}</span>
          <span>历史 {includeHistory ? 'ON' : 'OFF'}</span>
        </button>

        <button
          onClick={handleConfigLimit}
          className="opacity-0 group-hover/sec:opacity-100 transition-opacity btn-ghost !p-1 h-6 px-1.5 text-[11px] leading-none whitespace-nowrap"
          title="设置展示数量"
        >
          N={recentLimit}
        </button>
        <button
          onClick={handleClear}
          disabled={recentEntries.length === 0}
          className={cn(
            'opacity-0 group-hover/sec:opacity-100 transition-opacity btn-ghost !p-1 h-6 w-6 text-xs',
            recentEntries.length === 0 && 'cursor-not-allowed opacity-30',
          )}
          title="清空扩展内的打开记录（不影响浏览器历史）"
        >
          🗑
        </button>
      </header>

      {!collapsed && (
        <>
          {visibleItems.length > 0 ? (
            <div className={GRID_COLS}>
              {visibleItems.map((it) =>
                it.kind === 'bookmark' ? (
                  <BookmarkCardItem
                    key={`recent-bm-${it.card.id}`}
                    card={it.card}
                    draggable={false}
                  />
                ) : (
                  <HistoryCardItem
                    key={`recent-hist-${it.item.url}`}
                    item={it.item}
                  />
                ),
              )}
            </div>
          ) : (
            <div className="text-xs text-slate-400 pl-7 py-1">
              {includeHistory
                ? '暂无最近访问记录'
                : '点击任意书签后会出现在这里；也可以打开右上角「历史」开关，叠加浏览器全局历史'}
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** 渲染时统一的"最近项"代数视图：要么是书签卡，要么是历史项 */
type RecentRenderItem =
  | { kind: 'bookmark'; card: BookmarkCard; time: number }
  | { kind: 'history'; item: BrowserHistoryItem; time: number }
