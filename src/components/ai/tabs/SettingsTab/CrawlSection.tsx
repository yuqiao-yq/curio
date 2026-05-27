import { useEffect, useMemo, useState } from 'react'
import { useAISettingsStore } from '../../../../ai/useAISettingsStore'
import { useBookmarkStore } from '../../../../stores/useBookmarkStore'
import { useCrawlerStore } from '../../../../ai/services/useCrawlerStore'
import {
  CRAWL_RANGE_LABEL,
  isCrawlableUrl,
  runCrawler,
  selectCardsForCrawling,
} from '../../../../ai/services/crawler'
import {
  clearPageContents,
  countByStatus,
} from '../../../../repositories/PageContentsDB'
import { usePageIndex } from '../../../../ai/services/usePageIndex'
import { cn } from '../../../../utils/cn'
import { toast } from '../../../../stores/useToastStore'
import { confirmDialog } from '../../../Dialog'
import { ActionBtn, RangeChip, StatRow } from './shared'
import { IconView } from '../../../../utils/icon'

/* ─────────────────────────────────────────────────────────────
 * 内容抓取 section（V2.0 §6.1）
 *
 * 三态：
 * - 隐私未同意：显示蓝色 alert + 「同意并启用」按钮，点击弹完整说明
 * - 已同意 + 空闲：状态网格 + 范围选择 + 开始按钮 + 撤回同意小字
 * - 运行中：进度条 + 当前抓取标题 + 取消
 *
 * 不依赖 isAIConfigured：本 section 是纯 fetch + Readability 流程，
 * 不调用 LLM，没有 Provider 也能工作。
 * ───────────────────────────────────────────────────────────── */

interface CrawlStatus {
  total: number
  ok: number
  failed: number
  /** 卡片中能被抓取的（http(s)）数量 */
  crawlableTotal: number
  /** 缺失数 = crawlableTotal - ok */
  missing: number
}

export function CrawlSection() {
  const settings = useAISettingsStore()
  const cards = useBookmarkStore((s) => s.cards)
  const categories = useBookmarkStore((s) => s.categories)

  const stage = useCrawlerStore((s) => s.stage)
  const range = useCrawlerStore((s) => s.range)
  const progress = useCrawlerStore((s) => s.progress)
  const lastResult = useCrawlerStore((s) => s.lastResult)
  const errorMessage = useCrawlerStore((s) => s.errorMessage)
  const setRange = useCrawlerStore((s) => s.setRange)
  const start = useCrawlerStore((s) => s.start)
  const setProgress = useCrawlerStore((s) => s.setProgress)
  const finish = useCrawlerStore((s) => s.finish)
  const fail = useCrawlerStore((s) => s.fail)
  const cancel = useCrawlerStore((s) => s.cancel)
  const reset = useCrawlerStore((s) => s.reset)
  const refreshPageIndex = usePageIndex((s) => s.refresh)
  const clearPageIndex = usePageIndex((s) => s.clear)

  const [status, setStatus] = useState<CrawlStatus | null>(null)
  const [showPrivacyDialog, setShowPrivacyDialog] = useState(false)
  const topCategories = useMemo(
    () => categories.filter((c) => !c.parentId),
    [categories],
  )

  // 拉一次状态：mount 时 + 任务结束后 + cards 变了
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const counts = await countByStatus()
      const crawlableTotal = cards.filter((c) => isCrawlableUrl(c.url)).length
      if (!cancelled) {
        setStatus({
          total: counts.total,
          ok: counts.ok,
          failed: counts.failed,
          crawlableTotal,
          missing: Math.max(0, crawlableTotal - counts.ok),
        })
      }
    })()
    return () => {
      cancelled = true
    }
    // 仅在 cards 数量 / 任务结束后刷新；任务运行中靠 progress 显示，不重拉
  }, [cards, stage])

  const running = stage === 'running'
  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  // 选定范围下的待处理预估数（用于按钮上的 "(N)" 显示）
  const [estimatedPending, setEstimatedPending] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    void selectCardsForCrawling(range, cards, categories).then((list) => {
      if (!cancelled) setEstimatedPending(list.length)
    })
    return () => {
      cancelled = true
    }
  }, [range, cards, categories, stage])

  const handleRun = async () => {
    if (!settings.crawl.agreed) {
      // 没同意 → 弹隐私窗
      setShowPrivacyDialog(true)
      return
    }
    const targets = await selectCardsForCrawling(range, cards, categories)
    if (targets.length === 0) {
      toast.info('无可抓取项', '该范围内没有需要抓取的书签')
      return
    }
    if (
      targets.length > 50 &&
      !(await confirmDialog({
        title: `本次将抓取 ${targets.length} 个网页`,
        message: `每条最多 ~30s，预计总耗时约 ${Math.ceil(targets.length / 3)} 秒。开始？`,
        confirmText: '开始抓取',
      }))
    ) {
      return
    }

    const controller = new AbortController()
    start(controller)
    try {
      const result = await runCrawler({
        cards: targets,
        signal: controller.signal,
        onProgress: setProgress,
      })
      finish({ total: result.total, ok: result.ok, failed: result.failed })
      // 通知卡片角标层：indexedIds 集合可能变了
      void refreshPageIndex()
      if (result.failed === 0) {
        toast.success(
          '内容抓取完成',
          `成功 ${result.ok} / ${result.total} 条`,
        )
      } else {
        toast.warning(
          '内容抓取部分失败',
          `成功 ${result.ok} · 失败 ${result.failed}（可在「⚙ 设置」点击「重试失败」）`,
        )
      }
      // §6.3 autoSummarize 联动：开关开着就提示用户去触发批量备注
      // （故意不"自动跑"，避免静默消费 token；用户在 toast 上点 action 才真的跑）
      if (settings.autoSummarize && result.ok > 0) {
        toast.show({
          kind: 'info',
          title: '可继续生成 AI 备注',
          message: `${result.ok} 个新抓取的网页可以一键生成简短摘要`,
          duration: 8000,
          action: {
            label: '前往',
            variant: 'primary',
            onClick: () => {
              // 滚动到 SummarySection（用 location.hash 取巧；section 加 id 即可）
              document
                .getElementById('summary-section')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            },
          },
        })
      }
    } catch (err) {
      if (controller.signal.aborted) {
        reset()
        return
      }
      const msg = err instanceof Error ? err.message : '未知错误'
      fail(msg)
      toast.error('内容抓取出错', msg)
    }
  }

  const handleClear = async () => {
    if (
      !(await confirmDialog({
        title: '清空所有已抓取的网页正文？',
        message:
          '清空后语义搜索 / RAG 问答的「内容召回」将不可用，需要重新抓取。',
        confirmText: '清空',
        danger: true,
      }))
    ) {
      return
    }
    await clearPageContents()
    clearPageIndex()
    toast.success('已清空', '内容索引已重置')
    reset()
  }

  const handleAgree = () => {
    settings.setCrawlAgreed(true)
    setShowPrivacyDialog(false)
    toast.success('已同意', '可以开始抓取了')
  }

  const handleRevoke = async () => {
    if (
      !(await confirmDialog({
        title: '撤回内容抓取同意？',
        message:
          '撤回后，下次再次启动抓取时会重新弹隐私说明。本地已抓取的内容保留。',
        confirmText: '撤回同意',
        danger: true,
      }))
    ) {
      return
    }
    settings.setCrawlAgreed(false)
    toast.info('已撤回同意', '本地已抓取的内容仍保留；不会再有新的抓取')
  }

  return (
    <section>
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
        内容抓取
      </h4>
      <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
        抓取已收藏网页的正文（用 Mozilla Readability 提取主体内容），写入本机
        IndexedDB，供 V2.0 RAG 问答 / 语义搜索召回。
        <span className="text-slate-500"> 不会上传任何内容到服务器。</span>
      </p>

      {/* 状态网格 */}
      <div
        className={cn(
          'rounded-md border p-2.5 text-xs',
          'bg-slate-50 dark:bg-slate-800/40',
          'border-slate-200 dark:border-slate-700',
        )}
      >
        {status ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <StatRow label="可抓取书签" value={status.crawlableTotal} />
            <StatRow
              label="已成功索引"
              value={status.ok}
              tone={status.ok > 0 ? 'ok' : 'normal'}
            />
            <StatRow
              label="待抓取"
              value={status.missing}
              tone={status.missing > 0 ? 'warn' : 'ok'}
            />
            <StatRow
              label="失败"
              value={status.failed}
              tone={status.failed > 0 ? 'warn' : 'normal'}
            />
          </div>
        ) : (
          <div className="text-slate-400 py-1">读取索引状态…</div>
        )}
      </div>

      {/* 范围选择（仅未运行时） */}
      {!running && (
        <div className="mt-2 space-y-1.5">
          <RangeChip
            checked={range.type === 'untouched'}
            onClick={() => setRange({ type: 'untouched' })}
            label={CRAWL_RANGE_LABEL.untouched}
          />
          <RangeChip
            checked={range.type === 'failed'}
            onClick={() => setRange({ type: 'failed' })}
            label={CRAWL_RANGE_LABEL.failed}
            disabled={!status || status.failed === 0}
          />
          <RangeChip
            checked={range.type === 'all'}
            onClick={() => setRange({ type: 'all' })}
            label={CRAWL_RANGE_LABEL.all}
          />
          {topCategories.length > 0 && (
            <details className="group">
              <summary
                className={cn(
                  'cursor-pointer text-[11px] text-slate-500 dark:text-slate-400 px-2 py-1 rounded',
                  'hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                按某个顶层分类抓取…
              </summary>
              <div className="pl-2 mt-1 space-y-1 border-l-2 border-slate-100 dark:border-slate-700">
                {topCategories.map((c) => (
                  <RangeChip
                    key={c.id}
                    checked={range.type === 'category' && range.id === c.id}
                    onClick={() => setRange({ type: 'category', id: c.id })}
                    label={
                      <>
                        <IconView
                          value={c.icon}
                          fallback="📁"
                          emojiClassName="text-sm leading-none"
                          imgClassName="w-4 h-4 rounded-sm object-contain"
                        />
                        <span className="truncate">{c.name}</span>
                      </>
                    }
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* 进度条 */}
      {running && (
        <div className="mt-2 rounded-md border border-brand/30 bg-brand/5 px-2.5 py-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-brand font-medium">📥 正在抓取…</span>
            <span className="tabular-nums text-slate-500">
              {progress.done} / {progress.total} ({pct}%)
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
            <div
              className="h-full bg-brand transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          {progress.currentTitle && (
            <div
              className="text-[10px] text-slate-500 dark:text-slate-400 truncate"
              title={progress.currentTitle}
            >
              · {progress.currentTitle}
            </div>
          )}
          <button
            type="button"
            onClick={cancel}
            className="text-[10px] text-slate-400 hover:text-red-500"
          >
            取消任务（已完成项保留）
          </button>
        </div>
      )}

      {/* 错误条 */}
      {stage === 'error' && (
        <div className="mt-2 rounded-md border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-600 dark:text-red-300 break-words">
          {errorMessage}
          <button
            type="button"
            onClick={reset}
            className="ml-2 underline hover:no-underline"
          >
            知道了
          </button>
        </div>
      )}

      {/* 上次结果摘要 */}
      {stage === 'done' && lastResult && (
        <div className="mt-2 rounded-md border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
          ✓ 上次抓取：成功 {lastResult.ok} / {lastResult.total}
          {lastResult.failed > 0 && (
            <span className="text-amber-600 dark:text-amber-300">
              （失败 {lastResult.failed}）
            </span>
          )}
        </div>
      )}

      {/* 操作按钮区 */}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <ActionBtn
          primary
          disabled={running || estimatedPending === 0}
          onClick={() => void handleRun()}
          title={
            !settings.crawl.agreed
              ? '首次使用前需要同意隐私说明'
              : estimatedPending === 0
                ? '该范围内没有需要抓取的书签'
                : '开始抓取所选范围'
          }
        >
          {!settings.crawl.agreed ? '✓ 同意并开始' : '📥 开始抓取'}
          {estimatedPending !== null && estimatedPending > 0 && (
            <span className="ml-1 tabular-nums opacity-80">
              ({estimatedPending})
            </span>
          )}
        </ActionBtn>
        <div className="flex-1" />
        <ActionBtn
          danger
          disabled={running || !status || status.total === 0}
          onClick={() => void handleClear()}
          title="清空所有已抓取的正文（不删书签本身）"
        >
          清空
        </ActionBtn>
      </div>

      {/* 已同意状态 + 撤回入口 */}
      {settings.crawl.agreed && (
        <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-2">
          <span>
            ✓ 已同意抓取
            {settings.crawl.agreedAt && (
              <> · {new Date(settings.crawl.agreedAt).toLocaleDateString()}</>
            )}
          </span>
          <button
            type="button"
            onClick={() => void handleRevoke()}
            className="text-slate-400 hover:text-red-500 underline"
          >
            撤回同意
          </button>
        </div>
      )}

      {/* 隐私说明弹窗 */}
      {showPrivacyDialog && (
        <CrawlPrivacyDialog
          pendingCount={estimatedPending ?? 0}
          onCancel={() => setShowPrivacyDialog(false)}
          onAgree={handleAgree}
        />
      )}
    </section>
  )
}

/**
 * 隐私同意弹窗（§6.1 强制要求）：
 * 第一次开启抓取前显示，文案明确说"将下载 N 个网页内容到本地"。
 * 同意后写入 settings.crawl.agreed=true，后续不再弹（除非用户撤回）。
 */
function CrawlPrivacyDialog({
  pendingCount,
  onCancel,
  onAgree,
}: {
  pendingCount: number
  onCancel: () => void
  onAgree: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[10200] flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          // v0.21.16：max-h 自适应屏幕 + 内部滚动
          'w-[440px] max-w-[92vw] max-h-[calc(100vh-2rem)] flex flex-col rounded-lg shadow-2xl',
          'bg-white dark:bg-slate-800',
          'border border-slate-200 dark:border-slate-700',
        )}
      >
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span aria-hidden>🔒</span>
            内容抓取隐私说明
          </h3>
        </div>
        <div className="px-5 py-4 space-y-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed flex-1 min-h-0 overflow-y-auto">
          <p>
            Curio 即将代你访问已收藏的{' '}
            <span className="font-semibold text-brand tabular-nums">
              {pendingCount}
            </span>{' '}
            个网页，下载其 HTML，用 Mozilla Readability 提取正文并保存到{' '}
            <span className="font-mono text-slate-500">本机 IndexedDB</span>。
          </p>
          <ul className="list-disc list-inside space-y-1 text-slate-500 dark:text-slate-400">
            <li>
              <span className="text-slate-700 dark:text-slate-200 font-medium">绝不上传</span>
              ：内容只存在你这台浏览器里
            </li>
            <li>
              <span className="text-slate-700 dark:text-slate-200 font-medium">不带登录态</span>
              ：fetch 时显式 <code className="font-mono">credentials: 'omit'</code>，
              不会发送 cookie / Authorization
            </li>
            <li>
              <span className="text-slate-700 dark:text-slate-200 font-medium">仅在你主动操作时</span>
              ：默认完全关闭；后台不会自动跑
            </li>
            <li>
              <span className="text-slate-700 dark:text-slate-200 font-medium">可随时撤回</span>
              ：撤回后不会再发起新的抓取
            </li>
          </ul>
          <p className="text-slate-500">
            浏览器层的「读取所有网站的数据」权限是 manifest 必需声明，
            实际行为由本扩展严格自我约束。
          </p>
        </div>
        <div className="px-5 py-3 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-700 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              'px-3 py-1.5 text-sm rounded',
              'text-slate-600 dark:text-slate-300',
              'hover:bg-slate-100 dark:hover:bg-slate-700/60',
            )}
          >
            取消
          </button>
          <button
            type="button"
            onClick={onAgree}
            className={cn(
              'px-3 py-1.5 text-sm rounded font-medium',
              'bg-brand text-white hover:bg-brand-600',
            )}
          >
            我已了解并同意
          </button>
        </div>
      </div>
    </div>
  )
}
