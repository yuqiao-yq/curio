import { useEffect, useMemo, useState } from 'react'
import type { BookmarkCard, Category } from '../types/bookmark'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { useAISettingsStore, useIsAIConfigured } from '../ai/useAISettingsStore'
import {
  searchByEmbedding,
  type EmbedSearchHit,
} from '../ai/services/embedder'
import { BookmarkCardItem } from './BookmarkCardItem'
import { cn } from '../utils/cn'

/* ─────────────────────────────────────────────────────────────
 * AISearchView：@ai 模式下的语义检索结果视图（V1.5 §5.1）
 *
 * v0.21.x 抽离自 BookmarkGrid：embedder.ts + useAISettingsStore + 各 provider
 * 体积可观，让没用 @ai 前缀的用户首屏不为这部分付钱。BookmarkGrid 仅在
 * 解析出 @ai 查询时才 React.lazy 加载本模块。
 *
 * - debounce 350ms 调 embedder.searchByEmbedding（避免每次按键都打 API）
 * - 主结果：按余弦相似度倒序，每条带百分比 score
 * - 兜底（fallback）：embedding 缺失但 substring 命中的卡片，作为次级结果展示
 * - 未配置 AI / 库为空时给出引导
 * ───────────────────────────────────────────────────────────── */

// 与 BookmarkGrid 内部 GRID_COLS 保持一致；故意复制而不是 export，
// 让本模块在物理上独立（lazy chunk 不再回头依赖 BookmarkGrid）。
const GRID_COLS =
  'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3'

interface AISearchViewProps {
  query: string
  cards: BookmarkCard[]
  categories: Category[]
}

type AISearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; hits: EmbedSearchHit[] }
  | { status: 'error'; message: string }

export default function AISearchView({ query, cards, categories }: AISearchViewProps) {
  const setSearchKeyword = useBookmarkStore((s) => s.setSearchKeyword)
  const aiReady = useIsAIConfigured()
  // 仅订阅与「embedding 路由 + provider 列表大小」相关的两个标识量；
  // 真正的 settings 对象在 debounce fire 时通过 getState() 读，避免
  // 任何 AI 设置字段（apiKey 等）变更都触发本组件 re-render。
  const embeddingProviderId = useAISettingsStore((s) => s.routing.embedding)
  const providersCount = useAISettingsStore((s) => s.providers.length)

  const [state, setState] = useState<AISearchState>({ status: 'idle' })

  // debounce 调 search
  useEffect(() => {
    if (!aiReady) {
      setState({ status: 'error', message: '尚未配置可用的 AI Provider' })
      return
    }
    setState({ status: 'loading' })
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const hits = await searchByEmbedding({
          query,
          cards,
          settings: useAISettingsStore.getState(),
          topK: 30,
          minScore: 0.2,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        setState({ status: 'ready', hits })
      } catch (err) {
        if (controller.signal.aborted) return
        const msg = err instanceof Error ? err.message : '未知错误'
        setState({ status: 'error', message: msg })
      }
    }, 350)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [query, aiReady, embeddingProviderId, providersCount, cards])

  // 分类路径快查（与主搜索分支同款实现）
  const pathOf = useMemo(() => {
    const catMap = new Map(categories.map((c) => [c.id, c]))
    return (catId: string): string => {
      const parts: string[] = []
      let cur = catMap.get(catId)
      while (cur) {
        parts.unshift(cur.name)
        cur = cur.parentId ? catMap.get(cur.parentId) : undefined
      }
      return parts.join(' / ') || '(未分类)'
    }
  }, [categories])

  const cardMap = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

  // 主结果：按 hits 排
  const primaryItems = useMemo(() => {
    if (state.status !== 'ready') return []
    return state.hits
      .map((h) => {
        const card = cardMap.get(h.cardId)
        if (!card) return null
        return { card, score: h.score, categoryPath: pathOf(card.categoryId) }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
  }, [state, cardMap, pathOf])

  /**
   * Fallback：embedding 没覆盖到的书签 + substring 命中的，作为次级结果。
   * 让用户在 embedding 还没补齐时也有兜底结果，避免"AI 模式 = 空白"。
   */
  const fallbackItems = useMemo(() => {
    if (state.status !== 'ready') return []
    const kw = query.toLowerCase()
    const hitIds = new Set(state.hits.map((h) => h.cardId))
    const subMatches = cards.filter(
      (c) =>
        !hitIds.has(c.id) &&
        (c.title.toLowerCase().includes(kw) || c.url.toLowerCase().includes(kw)),
    )
    return subMatches.slice(0, 20).map((card) => ({
      card,
      categoryPath: pathOf(card.categoryId),
    }))
  }, [state, cards, pathOf, query])

  return (
    <div>
      {/* 顶部模式横幅 */}
      <div
        className={cn(
          'mb-3 px-2.5 py-1.5 rounded-md inline-flex items-center gap-2',
          'bg-fuchsia-50 dark:bg-fuchsia-500/10',
          'border border-fuchsia-200 dark:border-fuchsia-500/30',
          'text-xs text-fuchsia-700 dark:text-fuchsia-300',
        )}
      >
        <span className="text-[10px] uppercase tracking-wider opacity-70">
          AI 语义搜索
        </span>
        <span className="font-medium truncate max-w-[280px]" title={query}>
          {query}
        </span>
        {state.status === 'loading' && (
          <span className="text-fuchsia-400 animate-pulse">检索中…</span>
        )}
        {state.status === 'ready' && (
          <span className="text-fuchsia-400 tabular-nums">
            · {primaryItems.length} 命中
            {fallbackItems.length > 0 && ` + ${fallbackItems.length} 兜底`}
          </span>
        )}
        <button
          type="button"
          onClick={() => setSearchKeyword('')}
          className={cn(
            'ml-1 w-4 h-4 inline-flex items-center justify-center rounded text-[11px]',
            'text-fuchsia-400 hover:text-fuchsia-700 dark:hover:text-fuchsia-100',
            'hover:bg-fuchsia-100 dark:hover:bg-fuchsia-500/20',
          )}
          title="清除搜索"
          aria-label="清除搜索"
        >
          ✕
        </button>
      </div>

      {/* 状态分支 */}
      {state.status === 'error' ? (
        <div className="rounded-md p-3 text-xs text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 break-words">
          AI 检索失败：{state.message}
          {!aiReady && (
            <div className="mt-1 text-[11px] text-slate-500">
              请到浮窗 ⚙ 设置添加并启用 Provider
            </div>
          )}
        </div>
      ) : state.status === 'loading' ? (
        <div className="text-center py-12 text-slate-400 text-sm">
          ✨ 正在做语义检索…
        </div>
      ) : (
        <>
          {/* 主结果 */}
          {primaryItems.length > 0 ? (
            <div className={GRID_COLS}>
              {primaryItems.map(({ card, score, categoryPath }) => (
                <AIHitCard
                  key={`p-${card.id}`}
                  card={card}
                  score={score}
                  categoryPath={categoryPath}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-slate-400 text-sm space-y-2">
              <div>没有找到语义相似的书签</div>
              <div className="text-[11px] text-slate-300 dark:text-slate-600">
                如果是新装或刚清空了 embedding，先到 ⚙ 设置点「✨ 补缺」生成索引
              </div>
            </div>
          )}

          {/* 兜底（substring）：仅在主结果不空时也显示 —— 让用户感知"还有非语义命中"
              主结果空时只展示空状态，避免兜底唱主角让用户误以为 AI 没接通 */}
          {primaryItems.length > 0 && fallbackItems.length > 0 && (
            <div className="mt-6">
              <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-2 px-1">
                · 关键字兜底匹配（embedding 未覆盖）
              </div>
              <div className={GRID_COLS}>
                {fallbackItems.map(({ card, categoryPath }) => (
                  <BookmarkCardItem
                    key={`f-${card.id}`}
                    card={card}
                    draggable={false}
                    searchMeta={{
                      categoryPath,
                      dupCount: 0,
                      dupCategoryPaths: [],
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * AI 命中的单卡：复用 BookmarkCardItem，但额外覆盖一个角标显示 score（百分比）。
 * 没把 score 塞到 BookmarkCardItem.searchMeta 里是因为该接口语义是「分类副本」，
 * AI score 是另一码事；用包一层的方式让两边都纯净。
 */
function AIHitCard({
  card,
  score,
  categoryPath,
}: {
  card: BookmarkCard
  score: number
  categoryPath: string
}) {
  const pct = Math.round(score * 100)
  return (
    <div className="relative">
      <BookmarkCardItem
        card={card}
        draggable={false}
        searchMeta={{ categoryPath, dupCount: 0, dupCategoryPaths: [] }}
      />
      {/* 右上角分数徽标：高 score 用 brand 色，低 score 灰色 */}
      <span
        className={cn(
          'absolute top-1 right-1 inline-flex items-center px-1 h-3.5 rounded text-[9px] leading-none',
          'tabular-nums font-medium pointer-events-none',
          pct >= 60
            ? 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300'
            : 'bg-slate-100 dark:bg-slate-700 text-slate-400',
        )}
        title={`相似度 ${pct}%`}
      >
        {pct}
      </span>
    </div>
  )
}
