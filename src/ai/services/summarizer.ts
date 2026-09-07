import type { AISettings, ChatMessage } from '../types'
import { getProviderFor } from '../manager'
import { getPageContentsMap } from '../../repositories/PageContentsDB'
import type { BookmarkCard } from '../../types/bookmark'

/**
 * AI 自动备注（V2.0 §6.3）
 *
 * 输入：cards（已抓取且 description 为空的子集）
 * 输出：cardId → 1 句话摘要 (≤30 字)
 *
 * 设计原则：
 * - **不覆盖**用户已写的 description（在 selectCardsForSummarizing 阶段就过滤掉）
 * - 必须有抓取过的正文（否则降级用 title + domain 也行，但召回质量低；
 *   产品上选择 stricter：只为有正文的卡片做总结，避免"凭标题瞎编"）
 * - 单条调用而不是分批 JSON：单文本输入更短、成本可控、错单条不影响整体
 *   （tagger 是批量 JSON 因为同时返回多条更经济；summarizer 是 1 输入 1 输出，逐条更稳）
 *
 * 不做的事（V2 阶段）：
 * - 不在 addCard / crawler 里隐式触发：避免后台静默消耗 token
 *   仅由用户在 ⚙ 设置主动 "批量生成"，或在 crawler 完成后用 autoSummarize 开关串联
 */

export interface SummaryResult {
  cardId: string
  /** AI 给的摘要；空字符串表示该条失败 / 无内容 */
  summary: string
  error?: string
}

// ─── 选择待处理卡片 ────────────────────────────────

export type SummaryRange =
  | { type: 'untouched' } // 已抓取且 description 为空
  | { type: 'all' } // 已抓取的全部（覆盖已写的 description）
  | { type: 'category'; id: string } // 某分类（含后代）下已抓取且 description 为空

export const SUMMARY_RANGE_LABEL: Record<SummaryRange['type'], string> = {
  untouched: '仅"已抓取正文且没有备注"的卡片（推荐）',
  all: '所有已抓取的卡片（覆盖已有备注）',
  category: '指定分类',
}

export async function selectCardsForSummarizing(
  range: SummaryRange,
  cards: BookmarkCard[],
  categories: Array<{ id: string; parentId?: string }>,
): Promise<BookmarkCard[]> {
  // 先按 type 类型筛
  let candidates: BookmarkCard[] = cards
  if (range.type === 'category') {
    const ids = collectDescendantIds([range.id], categories)
    candidates = cards.filter((c) => ids.has(c.categoryId))
  }

  // 必须有 page content（status=ok）
  const pageMap = await getPageContentsMap(candidates.map((c) => c.id))
  candidates = candidates.filter((c) => {
    const p = pageMap.get(c.id)
    return p?.status === 'ok' && p.content.length > 50
  })

  // 默认仅未写 description 的；'all' 模式才允许覆盖
  if (range.type !== 'all') {
    candidates = candidates.filter((c) => !c.description || c.description.trim().length === 0)
  }

  return candidates
}

function collectDescendantIds(
  ids: string[],
  cats: Array<{ id: string; parentId?: string }>,
): Set<string> {
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

// ─── Prompt ──────────────────────────────────────

function buildPrompt(input: { title: string; domain: string; excerpt: string }): ChatMessage[] {
  const system = `你是浏览器书签备注助手。基于网页的标题和正文摘录，
生成一句话简短摘要（中文，≤ 25 字），描述这个网页是关于什么的。

约束：
- 输出纯文本，不要任何 JSON / 引号 / 前缀
- 不要复述标题；要从正文中提炼"用户为什么会收藏它"
- 不要使用"该网页讲述了..."这种空话开头，直接给信息密度
- 实在判断不出主题时输出空字符串`

  const user = `标题：${input.title}
域名：${input.domain}

正文摘录：
${input.excerpt}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

// ─── 单条总结 ────────────────────────────────────

const MAX_EXCERPT_CHARS = 1500

async function summarizeOne(
  card: BookmarkCard,
  excerpt: string,
  settings: AISettings,
  signal?: AbortSignal,
): Promise<SummaryResult> {
  const provider = getProviderFor('chat', settings)
  if (!provider) {
    return { cardId: card.id, summary: '', error: '未配置 chat Provider' }
  }
  let domain = ''
  try {
    domain = new URL(card.url).hostname.replace(/^www\./, '')
  } catch {
    /* ignore */
  }
  try {
    const res = await provider.chat({
      messages: buildPrompt({
        title: (card.title || '(无标题)').slice(0, 80),
        domain: domain || '(unknown)',
        excerpt: excerpt.slice(0, MAX_EXCERPT_CHARS),
      }),
      temperature: 0.2,
      maxTokens: 80,
      signal,
    })
    const summary = (res.text || '').trim().slice(0, 60)
    return { cardId: card.id, summary }
  } catch (err) {
    return {
      cardId: card.id,
      summary: '',
      error: err instanceof Error ? err.message : '未知错误',
    }
  }
}

// ─── 批量主流程 ──────────────────────────────────

export interface RunSummarizerOptions {
  cards: BookmarkCard[]
  settings: AISettings
  signal?: AbortSignal
  onProgress?: (done: number, total: number, currentTitle?: string) => void
  /** 并发度（默认 2；总结是单文档，不需要太多并发） */
  concurrency?: number
}

export interface RunSummarizerResult {
  total: number
  ok: number
  failed: number
  results: SummaryResult[]
}

export async function runSummarizer(opts: RunSummarizerOptions): Promise<RunSummarizerResult> {
  if (!opts.settings.privacy.sendPageContent) {
    throw new Error(
      '请先在 AI 设置中开启「允许 AI 使用已抓取正文」；摘要需要将正文片段发送给所选模型。',
    )
  }
  const concurrency = Math.max(1, Math.min(4, opts.concurrency ?? 2))
  const total = opts.cards.length
  if (total === 0) {
    return { total: 0, ok: 0, failed: 0, results: [] }
  }

  // 一次性预加载所有 page contents（不重复查 dexie）
  const pageMap = await getPageContentsMap(opts.cards.map((c) => c.id))

  const queue = [...opts.cards]
  const results: SummaryResult[] = []
  let done = 0
  let ok = 0
  let failed = 0

  const worker = async () => {
    while (queue.length > 0) {
      if (opts.signal?.aborted) return
      const card = queue.shift()
      if (!card) return
      const page = pageMap.get(card.id)
      // selectCardsForSummarizing 已经过滤过；防御性检查
      if (!page || page.status !== 'ok') {
        failed++
        done++
        opts.onProgress?.(done, total, card.title)
        continue
      }
      const r = await summarizeOne(card, page.content, opts.settings, opts.signal)
      results.push(r)
      if (r.summary) ok++
      else failed++
      done++
      opts.onProgress?.(done, total, card.title)
    }
  }

  const workers: Promise<void>[] = []
  for (let i = 0; i < concurrency; i++) workers.push(worker())
  await Promise.all(workers)

  return { total, ok, failed, results }
}
