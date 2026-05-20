import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BookmarkCard } from '../types/bookmark'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { useAIPanelStore } from '../ai/panel/usePanelStore'
import {
  findSimilarCards,
  type SimilarCardHit,
} from '../ai/services/embedder'
import { getHostname } from '../utils/favicon'
import { cn } from '../utils/cn'
import { FaviconImg } from './FaviconImg'

/**
 * 相关阅读弹层（V3.0 §7.4）
 *
 * 用户在卡片菜单点「✨ 相关阅读」触发；基于 embedding cosine 在全库找 top 3
 * 不调任何外部 API；不引入外部数据 —— 完全用用户自己的书签构成推荐池。
 *
 * 三态：
 *  - loading：异步加载中
 *  - empty (no-self-embedding)：目标卡未 embed → 引导去 ⚙ 设置
 *  - empty (no-candidates)：全库太空或都 < minScore → 引导补全 embedding
 *  - ready：渲染推荐列表
 */
export function RelatedReadingDialog({
  card,
  onClose,
}: {
  card: BookmarkCard
  onClose: () => void
}) {
  const allCards = useBookmarkStore((s) => s.cards)
  const recordRecentOpen = useBookmarkStore((s) => s.recordRecentOpen)
  const openPanel = useAIPanelStore((s) => s.open)

  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ready'; hits: SimilarCardHit[] }
    | { kind: 'empty'; reason: 'no-self-embedding' | 'no-candidates' }
  >({ kind: 'loading' })

  // 仅 mount 时拉一次（cards 改变也不重算 —— 用户开了 dialog 后基本不会改库）
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const r = await findSimilarCards(card.id, allCards, {
        topK: 3,
        minScore: 0.4,
      })
      if (cancelled) return
      if (r.hits.length > 0) {
        setState({ kind: 'ready', hits: r.hits })
      } else {
        setState({
          kind: 'empty',
          reason: r.reason ?? 'no-candidates',
        })
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id])

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const goToSettings = () => {
    openPanel('settings')
    onClose()
  }
  const handleHitClick = (c: BookmarkCard) => {
    void recordRecentOpen(c.id)
    window.open(c.url, '_blank', 'noopener,noreferrer')
    onClose()
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="fixed inset-0 z-[10180] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          // v0.21.16：max-h 自适应屏幕；flex 让 Header 固定、Body 滚动
          'w-[440px] max-w-[92vw] max-h-[calc(100vh-2rem)] flex flex-col rounded-lg shadow-2xl',
          'bg-white dark:bg-slate-800',
          'border border-slate-200 dark:border-slate-700',
        )}
      >
        {/* Header：目标卡 + ✕（高度固定） */}
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-start gap-3 shrink-0">
          <FaviconImg
            url={card.url}
            size={20}
            className="w-5 h-5 rounded-sm shrink-0 mt-0.5"
            fallbackClassName="w-5 h-5 rounded-sm text-[10px] shrink-0 mt-0.5"
          />
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-slate-400">
              ✨ 相关阅读
            </div>
            <div
              className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate"
              title={card.title}
            >
              {card.title}
            </div>
            <div className="text-[11px] text-slate-400 truncate font-mono">
              {getHostname(card.url)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'shrink-0 w-7 h-7 inline-flex items-center justify-center rounded text-sm',
              'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
              'hover:bg-slate-100 dark:hover:bg-slate-700/60',
            )}
            title="关闭 (Esc)"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* Body（可滚动） */}
        <div className="px-4 py-3 flex-1 min-h-0 overflow-y-auto">
          {state.kind === 'loading' && (
            <div className="text-center py-8 text-xs text-slate-400">
              正在计算相似度…
            </div>
          )}

          {state.kind === 'empty' && (
            <div className="text-center py-6 space-y-2">
              <div className="text-3xl">🤔</div>
              {state.reason === 'no-self-embedding' ? (
                <>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    这张卡片还没有生成 embedding，无法计算相似度。
                  </p>
                  <button
                    type="button"
                    onClick={goToSettings}
                    className="mt-1 h-7 px-3 inline-flex items-center justify-center rounded text-xs font-medium bg-brand text-white hover:bg-brand-600"
                  >
                    去 ⚙ 设置生成
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    全库里没找到内容相似度 ≥ 40% 的其他书签。
                    <br />
                    可能原因：相关书签还未生成 embedding；或者它们确实和这张卡没什么关系。
                  </p>
                  <button
                    type="button"
                    onClick={goToSettings}
                    className="mt-1 h-7 px-3 inline-flex items-center justify-center rounded text-xs border border-slate-200 dark:border-slate-700 hover:border-brand hover:text-brand"
                  >
                    去 ⚙ 设置补全 embedding
                  </button>
                </>
              )}
            </div>
          )}

          {state.kind === 'ready' && (
            <div className="space-y-2">
              <div className="text-[11px] text-slate-400 mb-1">
                基于 embedding 余弦相似度，从你的书签库里挑出 {state.hits.length} 张
                <span className="text-slate-300 dark:text-slate-600">
                  （纯本地计算，不调外部服务）
                </span>
              </div>
              {state.hits.map(({ card: c, score }) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleHitClick(c)}
                  className={cn(
                    'w-full flex items-start gap-2 p-2 rounded-md text-left',
                    'border border-slate-200 dark:border-slate-700',
                    'hover:border-brand/40 hover:bg-brand/5',
                    'transition-colors',
                  )}
                  title={`打开：${c.url}`}
                >
                  <FaviconImg
                    url={c.url}
                    size={20}
                    className="w-5 h-5 rounded-sm shrink-0 mt-0.5"
                    fallbackClassName="w-5 h-5 rounded-sm text-[10px] shrink-0 mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-slate-700 dark:text-slate-200 truncate">
                      {c.title}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate font-mono">
                      {getHostname(c.url)}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 inline-flex items-center px-1.5 h-4 rounded text-[10px] tabular-nums font-medium',
                      score >= 0.7
                        ? 'bg-fuchsia-100 dark:bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
                    )}
                    title={`相似度 ${Math.round(score * 100)}%`}
                  >
                    {Math.round(score * 100)}%
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
