/**
 * @mozilla/readability 体积约 52KB（约占首屏 chunk 5%）；
 * 仅在用户开启「内容抓取」并实际触发 crawlPage 时才需要。
 * 改为 dynamic import：UI 静态分析时不会把它打进首屏 chunk。
 */
let _ReadabilityCtor: typeof import('@mozilla/readability').Readability | null = null
async function getReadability() {
  if (_ReadabilityCtor) return _ReadabilityCtor
  const mod = await import('@mozilla/readability')
  _ReadabilityCtor = mod.Readability
  return _ReadabilityCtor
}
import {
  type PageContentRow,
  getFailedRows,
  getOkBookmarkIds,
  putPageContent,
} from '../../repositories/PageContentsDB'
import type { BookmarkCard, Category } from '../../types/bookmark'

/**
 * 网页内容抓取（V2.0 §6.1）
 *
 * 流程：
 *   1. 选范围（全库未索引 / 某分类 / 重试失败）
 *   2. 跳过浏览器内部页 / 非 http(s) / 已 ok 的（除非显式 retry）
 *   3. 工作池并发 fetch（默认 3 并发）+ 30s 超时
 *   4. DOMParser → Readability 提取正文 → 截断到 8000 字符
 *   5. 单条结果立即落库（不等批次完成；UI 进度更平滑）
 *
 * 失败兜底：
 *   - 任何失败（HTTP 4xx/5xx / 解析失败 / 超时 / 网络错）都写一行
 *     status='failed' + error 信息；下次"重试失败"时仍可重新抓取
 *   - 单条失败不影响其他条
 *
 * 隐私：
 *   - 仅 fetch 公开 HTML，不传 cookie / Authorization
 *   - 抓到的正文仅写入本机 IndexedDB
 *   - 用户必须先在 ⚙ 设置同意（agreed=true）才能调用本 service
 */

// ─── 范围 → 待处理书签 ─────────────────────────────────

export type CrawlRange =
  /** 全库未索引（不含 status='ok' 的；含 failed 的，因为可重试） */
  | { type: 'untouched' }
  /** 全部（含已 ok 的 → 视为重新抓取） */
  | { type: 'all' }
  /** 某分类（含后代）下的未索引 */
  | { type: 'category'; id: string }
  /** 重试所有 failed */
  | { type: 'failed' }

export const CRAWL_RANGE_LABEL: Record<CrawlRange['type'], string> = {
  untouched: '仅未抓取过的（推荐）',
  all: '全部书签（覆盖已索引）',
  category: '指定分类',
  failed: '重试上次失败的',
}

export async function selectCardsForCrawling(
  range: CrawlRange,
  cards: BookmarkCard[],
  categories: Category[],
): Promise<BookmarkCard[]> {
  // 先按 range 类型 / 分类选出候选
  let candidates: BookmarkCard[]
  switch (range.type) {
    case 'all':
      candidates = cards
      break
    case 'untouched':
      candidates = cards
      break
    case 'category': {
      const ids = collectDescendantIds([range.id], categories)
      candidates = cards.filter((c) => ids.has(c.categoryId))
      break
    }
    case 'failed':
      // failed 模式不依赖 cards 子集，直接从 DB 拿；这里用 cards 做 cardId 校验
      candidates = cards
      break
  }

  // 过滤 URL：仅 http(s)；跳过浏览器内部页
  candidates = candidates.filter((c) => isCrawlableUrl(c.url))

  // 增量过滤：untouched / category 模式下跳过已 ok 的
  if (range.type === 'untouched' || range.type === 'category') {
    const okIds = await getOkBookmarkIds()
    candidates = candidates.filter((c) => !okIds.has(c.id))
  }

  // failed 模式：仅保留 DB 中存在 status='failed' 的卡（其他的没必要重抓）
  if (range.type === 'failed') {
    const failedRows = await getFailedRows()
    const failedIdSet = new Set(failedRows.map((r) => r.bookmarkId))
    candidates = candidates.filter((c) => failedIdSet.has(c.id))
  }

  return candidates
}

function collectDescendantIds(ids: string[], cats: Category[]): Set<string> {
  const result = new Set(ids)
  const queue = [...ids]
  while (queue.length > 0) {
    const pid = queue.shift()!
    for (const c of cats) {
      if (c.parentId === pid && !result.has(c.id)) {
        result.add(c.id)
        queue.push(c.id)
      }
    }
  }
  return result
}

/** http / https 才抓；浏览器内部页 / 文件协议跳过 */
export function isCrawlableUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

// ─── 单条抓取核心 ───────────────────────────────────

const MAX_CONTENT_CHARS = 8000
const DEFAULT_TIMEOUT_MS = 30_000

/** 简单字符串 hash（djb2 → 36 进制），与 embedder 对齐 */
function djb2(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = (h * 33) ^ text.charCodeAt(i)
  }
  return (h >>> 0).toString(36)
}

interface FetchAndParseResult {
  ok: true
  title: string
  excerpt?: string
  content: string
  contentHash: string
}
interface FetchAndParseError {
  ok: false
  error: string
  httpStatus?: number
}

async function fetchAndParse(
  url: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<FetchAndParseResult | FetchAndParseError> {
  // 二级 timeout：服务端不响应时，把 fetch 强制中断
  const localCtl = new AbortController()
  const timer = setTimeout(() => localCtl.abort(), timeoutMs)
  // 桥接外层 abort
  const onOuterAbort = () => localCtl.abort()
  signal.addEventListener('abort', onOuterAbort)

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: localCtl.signal,
      redirect: 'follow',
      // 不带 credentials：避免把用户登录态发给目标网站
      credentials: 'omit',
      // 显式声明 Accept，部分站点对默认 fetch 头会返 406
      headers: { Accept: 'text/html,application/xhtml+xml' },
    })
    if (!res.ok) {
      return {
        ok: false,
        error: `HTTP ${res.status}: ${res.statusText || '无法访问'}`,
        httpStatus: res.status,
      }
    }
    // content-type 校验：只处理 HTML / XHTML
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (ct && !ct.includes('html')) {
      return { ok: false, error: `非 HTML 内容（${ct.split(';')[0]}）` }
    }
    const html = await res.text()
    if (!html || html.length < 200) {
      return { ok: false, error: '响应过短，可能不是正常网页' }
    }

    // DOMParser 在 newtab 普通页面环境可用
    const doc = new DOMParser().parseFromString(html, 'text/html')
    // Readability 需要 baseURI 才能正确处理相对链接；用 base 标签注入
    const base = doc.createElement('base')
    base.setAttribute('href', url)
    doc.head?.prepend(base)

    const Readability = await getReadability()
    const article = new Readability(doc).parse()
    if (!article || !article.textContent) {
      return { ok: false, error: 'Readability 未能提取出正文' }
    }

    const content = article.textContent.trim().slice(0, MAX_CONTENT_CHARS)
    if (content.length < 50) {
      return { ok: false, error: '提取的正文过短（<50 字），跳过' }
    }
    return {
      ok: true,
      title: (article.title || '').trim(),
      excerpt: article.excerpt?.trim(),
      content,
      contentHash: djb2(content),
    }
  } catch (err) {
    if (localCtl.signal.aborted) {
      // 区分外部主动取消 vs 内部超时
      return {
        ok: false,
        error: signal.aborted ? '用户已取消' : '超时',
      }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : '未知错误',
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onOuterAbort)
  }
}

// ─── 工作池：受限并发 ──────────────────────────────

interface WorkerPoolOptions {
  cards: BookmarkCard[]
  concurrency: number
  signal: AbortSignal
  timeoutMs: number
  onItemDone: (card: BookmarkCard, row: PageContentRow) => void
}

async function runWorkerPool(opts: WorkerPoolOptions): Promise<void> {
  const queue = [...opts.cards]
  const workers: Promise<void>[] = []

  const worker = async () => {
    while (queue.length > 0) {
      if (opts.signal.aborted) return
      const card = queue.shift()
      if (!card) return
      const result = await fetchAndParse(card.url, opts.signal, opts.timeoutMs)
      const now = Date.now()
      const row: PageContentRow = result.ok
        ? {
            bookmarkId: card.id,
            url: card.url,
            title: result.title || card.title,
            excerpt: result.excerpt,
            content: result.content,
            contentHash: result.contentHash,
            status: 'ok',
            fetchedAt: now,
          }
        : {
            bookmarkId: card.id,
            url: card.url,
            title: card.title,
            content: '',
            contentHash: '',
            status: 'failed',
            error: result.error,
            httpStatus: result.httpStatus,
            fetchedAt: now,
          }
      // 立即落库：让 UI 即时看到进展、即使中途取消也保留已完成项
      try {
        await putPageContent(row)
      } catch {
        /* DB 写入失败不阻断其他任务 */
      }
      opts.onItemDone(card, row)
    }
  }

  for (let i = 0; i < opts.concurrency; i++) {
    workers.push(worker())
  }
  await Promise.all(workers)
}

// ─── 核心：runCrawler ──────────────────────────────

export interface RunCrawlerOptions {
  cards: BookmarkCard[]
  signal?: AbortSignal
  onProgress?: (
    done: number,
    total: number,
    currentTitle?: string,
  ) => void
  /** 并发数，默认 3。超过 5 容易被部分网站限流 / 拒绝服务 */
  concurrency?: number
  /** 单条超时，默认 30s */
  timeoutMs?: number
}

export interface RunCrawlerResult {
  total: number
  ok: number
  failed: number
  /** 实际写入的所有行（含 failed），调用方按需更新 UI */
  rows: PageContentRow[]
}

export async function runCrawler(
  opts: RunCrawlerOptions,
): Promise<RunCrawlerResult> {
  const total = opts.cards.length
  const concurrency = Math.max(1, Math.min(5, opts.concurrency ?? 3))
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const signal = opts.signal ?? new AbortController().signal

  const rows: PageContentRow[] = []
  let done = 0
  let okCount = 0
  let failedCount = 0

  await runWorkerPool({
    cards: opts.cards,
    concurrency,
    signal,
    timeoutMs,
    onItemDone: (card, row) => {
      rows.push(row)
      done++
      if (row.status === 'ok') okCount++
      else failedCount++
      opts.onProgress?.(done, total, row.title || card.title)
    },
  })

  return { total, ok: okCount, failed: failedCount, rows }
}
