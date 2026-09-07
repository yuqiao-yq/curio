import type { AISettings } from '../types'
import { getProviderFor } from '../manager'
import {
  type EmbeddingRow,
  deleteEmbeddings,
  getAllEmbeddings,
  getEmbeddingsMap,
  getIndexedIds,
  putEmbeddings,
} from '../../repositories/EmbeddingsDB'
import { getPageContentsMap } from '../../repositories/PageContentsDB'
import type { BookmarkCard } from '../../types/bookmark'

/**
 * 书签 embedding 服务（V1.5 §5.1 语义搜索）
 *
 * 核心能力：
 * - 把"卡片 → 向量"批量生成并落库
 * - 把"用户的 query → 向量"做 cosine 检索
 * - contentHash 增量识别：只补"新增 / 内容变了"的卡，避免重复花钱
 *
 * 与 organizer / tagger 对齐：
 * - 通过 getProviderFor('embedding', settings) 取 Provider；不存在 / 不支持 embedding 时报错
 * - 分批：每批 16 条（OpenAI embeddings API 推荐 ≤ 2048 输入字符 / 请求；
 *   书签平均文本短，16 条上限是 4-5KB 量级，远低于上限）
 * - signal 支持取消；onProgress 回调用于 UI 进度条
 */

// ─── 文本构造（embedding 输入） ─────────────────────

/**
 * 把一张书签卡组装为 embedding 输入文本：
 * - title 是核心信号
 * - hostname 提供领域提示（"medium.com" 暗示是文章）
 * - tags / description 是用户已经标好的"主题压缩"，对召回非常有用
 * - 若 §6.1 已抓取了正文（pageBody 非空），追加正文前 N 字
 *   → 这样 query 与"正文关键词"也能召回，给 §6.2 RAG 提供基础
 *
 * 截断阈值：无正文时 300 字符（成本优先）；
 *           有正文时整体 ≤ 4000 字符（OpenAI text-embedding-3-small 上限 8191 tokens 远大于此）。
 */
export function buildContent(card: BookmarkCard, pageBody?: string): string {
  let domain = ''
  try {
    domain = new URL(card.url).hostname.replace(/^www\./, '')
  } catch {
    /* ignore */
  }
  const tagPart = card.tags?.length ? ` [${card.tags.join(', ')}]` : ''
  const descPart = card.description ? ` — ${card.description}` : ''
  const head = `${card.title || '(无标题)'} (${domain})${tagPart}${descPart}`
  if (!pageBody) return head.slice(0, 300)
  // 用 \n\n 分隔头部元数据与正文，让 embedding 能学到"主题"与"细节"两层
  const combined = `${head}\n\n${pageBody}`
  return combined.slice(0, 4000)
}

/**
 * 内容指纹：djb2 hash → 36 进制；
 * - 不需要密码学强度，只是用于"是否需要重新生成"的二进制判断
 * - 36 进制让字符串短一点（dashboard 显示也省地方）
 */
export function contentHashOf(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = (h * 33) ^ text.charCodeAt(i)
  }
  // 转为无符号 32-bit，再 toString(36)
  return (h >>> 0).toString(36)
}

// ─── Cosine 相似度 ─────────────────────────────────

/**
 * 余弦相似度。两个等长向量：a · b / (|a| × |b|)。
 * Float32Array 直接 .reduce 会被装箱很慢，手写循环最快。
 */
export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  const len = Math.min(a.length, b.length)
  if (len === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < len; i++) {
    const x = a[i]
    const y = b[i]
    dot += x * y
    na += x * x
    nb += y * y
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

// ─── 状态计算（给 UI dashboard 用） ───────────────────

export interface EmbedStatus {
  /** 当前书签总数 */
  totalCards: number
  /** 已经生成 embedding 的书签数 */
  indexedCards: number
  /** 内容已变（hash 不一致）需要重新生成的书签数 */
  staleCards: number
  /** 缺失的书签数 = totalCards - indexedCards */
  missingCards: number
  /** 当前向量库使用的模型（多模型并存时取出现最多的；UI 只是给参考） */
  currentModel?: string
  /** 用其他模型生成的、与当前期望模型不一致的数量（建议清空重生成） */
  mismatchCards: number
  /** DB 中已经孤立（卡片已被删除）的 embedding 行数 */
  orphanRows: number
}

export async function computeEmbedStatus(
  cards: BookmarkCard[],
  settings: AISettings,
): Promise<EmbedStatus> {
  const [rows, pageMap] = await Promise.all([
    getAllEmbeddings(),
    getPageContentsMap(cards.map((c) => c.id)),
  ])
  const rowMap = new Map(rows.map((r) => [r.bookmarkId, r]))
  const cardIdSet = new Set(cards.map((c) => c.id))

  // 期望模型：当前 Provider 设置的 embedding 模型；取不到时用第一行的 model 兜底
  const expectedModel = getExpectedEmbeddingModel(settings)

  let stale = 0
  let mismatch = 0
  let indexed = 0
  for (const card of cards) {
    const row = rowMap.get(card.id)
    if (!row) continue
    indexed++
    // 把已抓取的正文也纳入 hash：抓取后 hash 会变 → 提示 stale → 用户主动「补缺」
    const page = pageMap.get(card.id)
    const pageBody =
      settings.privacy.sendPageContent && page?.status === 'ok' ? page.content : undefined
    const hash = contentHashOf(buildContent(card, pageBody))
    if (row.contentHash !== hash) stale++
    if (expectedModel && row.model !== expectedModel) mismatch++
  }

  const orphan = rows.filter((r) => !cardIdSet.has(r.bookmarkId)).length

  // 主流模型（取出现次数最多的）
  const modelCount = new Map<string, number>()
  for (const r of rows) {
    modelCount.set(r.model, (modelCount.get(r.model) ?? 0) + 1)
  }
  const sorted = Array.from(modelCount.entries()).sort((a, b) => b[1] - a[1])

  return {
    totalCards: cards.length,
    indexedCards: indexed,
    staleCards: stale,
    missingCards: cards.length - indexed,
    currentModel: sorted[0]?.[0],
    mismatchCards: mismatch,
    orphanRows: orphan,
  }
}

/**
 * 取「当前期望使用的 embedding 模型名」：
 * - 优先用 routing.embedding 指向的 provider 的 embeddingModel
 * - 缺省（provider 没填 embeddingModel）时返回 OpenAI 默认 'text-embedding-3-small'
 *   —— 与 OpenAICompatibleProvider.embedding() 内的兜底一致
 * - 完全没配 provider 时返回 undefined
 */
function getExpectedEmbeddingModel(settings: AISettings): string | undefined {
  const id = settings.routing.embedding ?? settings.providers[0]?.id
  if (!id) return undefined
  const provider = settings.providers.find((p) => p.id === id)
  if (!provider) return undefined
  return provider.embeddingModel || 'text-embedding-3-small'
}

// ─── 哪些卡片需要生成 / 重生成 ──────────────────────

interface PendingItem {
  card: BookmarkCard
  content: string
  hash: string
}

async function selectPending(
  cards: BookmarkCard[],
  mode: 'all' | 'missing',
  allowBody: boolean,
): Promise<PendingItem[]> {
  // 预加载 page contents：让 buildContent 一次性吃到正文，避免逐条查 db
  const pageMap = await getPageContentsMap(cards.map((c) => c.id))
  const bodyOf = (id: string): string | undefined => {
    const p = pageMap.get(id)
    return allowBody && p?.status === 'ok' ? p.content : undefined
  }
  if (mode === 'all') {
    return cards.map((c) => {
      const content = buildContent(c, bodyOf(c.id))
      return { card: c, content, hash: contentHashOf(content) }
    })
  }
  // missing：缺失 + 内容已变（stale）的都补
  const rows = await getAllEmbeddings()
  const rowMap = new Map(rows.map((r) => [r.bookmarkId, r]))
  const out: PendingItem[] = []
  for (const c of cards) {
    const content = buildContent(c, bodyOf(c.id))
    const hash = contentHashOf(content)
    const row = rowMap.get(c.id)
    if (!row || row.contentHash !== hash) {
      out.push({ card: c, content, hash })
    }
  }
  return out
}

// ─── 核心：runEmbed{All,Missing} ─────────────────────

const BATCH_SIZE = 16

export interface RunEmbedOptions {
  mode: 'all' | 'missing'
  cards: BookmarkCard[]
  settings: AISettings
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
}

export interface RunEmbedResult {
  generated: number
  /** 实际成功落库的条数（生成 - 失败） */
  saved: number
  model: string
  /** 各批次错误：让 UI 给用户提示，但不会因单批失败终止任务 */
  errors: string[]
}

export async function runEmbed(opts: RunEmbedOptions): Promise<RunEmbedResult> {
  const provider = getProviderFor('embedding', opts.settings)
  if (!provider) {
    throw new Error('未配置可用的 AI Provider，请先在「⚙ 设置」添加')
  }
  if (!provider.embedding) {
    throw new Error(
      '当前 Provider 不支持 embedding（如 Chrome 内置 AI 没有 embedding 接口），请改用 OpenAI / DeepSeek / 智谱 / 通义千问 等',
    )
  }

  // 模型名：先 dummy 调一次拿不到，OpenAICompatibleProvider 内部默认 text-embedding-3-small
  // 这里读 settings 推导，与 status 显示一致
  const model = getExpectedEmbeddingModel(opts.settings) ?? 'text-embedding-3-small'

  const pending = await selectPending(
    opts.cards,
    opts.mode,
    opts.settings.privacy.sendPageContent === true,
  )
  if (pending.length === 0) {
    return { generated: 0, saved: 0, model, errors: [] }
  }

  // mode='all' 时把旧库一并删了，避免新模型与旧模型并存
  if (opts.mode === 'all') {
    const allCardIds = opts.cards.map((c) => c.id)
    // 这里只删 cards 里出现过的；孤立行（cards 中已不存在的）单独提供 cleanOrphans
    await deleteEmbeddings(allCardIds)
  }

  const errors: string[] = []
  let saved = 0
  const total = pending.length
  let done = 0

  // 分批
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    if (opts.signal?.aborted) {
      throw new Error('用户已取消')
    }
    const batch = pending.slice(i, i + BATCH_SIZE)
    try {
      const vectors = await provider.embedding(batch.map((b) => b.content))
      // OpenAI 官方：data 顺序与 input 一一对应；防御式校验长度
      if (!Array.isArray(vectors) || vectors.length !== batch.length) {
        errors.push(
          `批次 ${Math.floor(i / BATCH_SIZE) + 1}：返回向量数量与输入不匹配（${vectors?.length ?? 0} vs ${batch.length}）`,
        )
        done += batch.length
        opts.onProgress?.(done, total)
        continue
      }
      const now = Date.now()
      const rows: EmbeddingRow[] = batch.map((b, idx) => ({
        bookmarkId: b.card.id,
        vector: new Float32Array(vectors[idx] ?? []),
        model,
        contentHash: b.hash,
        createdAt: now,
      }))
      await putEmbeddings(rows)
      saved += rows.length
    } catch (err) {
      // 单批失败不中止整个任务，让用户能看到部分成功
      const msg = err instanceof Error ? err.message : '未知错误'
      errors.push(`批次 ${Math.floor(i / BATCH_SIZE) + 1}：${msg}`)
    }
    done += batch.length
    opts.onProgress?.(done, total)
  }

  return { generated: total, saved, model, errors }
}

// ─── 检索：searchByEmbedding ──────────────────────────

export interface EmbedSearchHit {
  cardId: string
  /** [0, 1] 的余弦相似度（越大越相似；归一化后 0.5 以下基本是噪音） */
  score: number
}

export interface SearchByEmbeddingOptions {
  query: string
  cards: BookmarkCard[]
  settings: AISettings
  /** 默认 20；UI 想拿全量再排自己设 cards.length */
  topK?: number
  /** 低于该阈值不返回，避免完全无关的也排进去；默认 0.2 */
  minScore?: number
  signal?: AbortSignal
}

/**
 * 语义搜索：把 query embedding 化 → 与 DB 里所有 vectors 做 cosine → 取 topK
 *
 * 没有命中 vector 的书签会被忽略（兜底由调用方做 substring 补丁）。
 */
export async function searchByEmbedding(opts: SearchByEmbeddingOptions): Promise<EmbedSearchHit[]> {
  const q = opts.query.trim()
  if (!q) return []

  const provider = getProviderFor('embedding', opts.settings)
  if (!provider?.embedding) {
    throw new Error('Provider 不支持 embedding')
  }

  const [vectors, rows] = await Promise.all([provider.embedding([q]), getAllEmbeddings()])
  if (opts.signal?.aborted) throw new Error('aborted')

  const queryVec = vectors[0]
  if (!queryVec || queryVec.length === 0) return []

  // 只对当前 cards 中存在的 bookmarkId 计算（防止孤立行干扰）
  const cardIdSet = new Set(opts.cards.map((c) => c.id))
  const minScore = opts.minScore ?? 0.2
  const topK = opts.topK ?? 20

  const scored: EmbedSearchHit[] = []
  for (const row of rows) {
    if (!cardIdSet.has(row.bookmarkId)) continue
    const score = cosineSimilarity(queryVec, row.vector)
    if (score < minScore) continue
    scored.push({ cardId: row.bookmarkId, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

// ─── 维护：清孤立行 ────────────────────────────────

/** 删掉 DB 里那些 cards 已经不存在的孤立 embedding 行 */
export async function cleanOrphans(cards: BookmarkCard[]): Promise<number> {
  const indexed = await getIndexedIds()
  const cardIdSet = new Set(cards.map((c) => c.id))
  const orphans: string[] = []
  for (const id of indexed) {
    if (!cardIdSet.has(id)) orphans.push(id)
  }
  if (orphans.length > 0) await deleteEmbeddings(orphans)
  return orphans.length
}

// ─── 相关阅读推荐（V3.0 §7.4） ────────────────────

export interface SimilarCardHit {
  card: BookmarkCard
  /** [0, 1] 余弦相似度 */
  score: number
}

export interface FindSimilarOptions {
  /** 取 top K；默认 3 */
  topK?: number
  /** 低于此分数不返回；默认 0.4（比 RAG 严一点：详情页推荐质量比召回数量更重要） */
  minScore?: number
}

/**
 * 为某张卡片找"内容相似的 top K 张卡"（不含目标卡自身）。
 *
 * 与 §6.2 RAG 检索的差别：那个用 query → 即时 embed → 全量比；
 * 这里目标 card 已经有 embedding row（依赖 §5.1 提前生成），不再调 LLM，
 * 完全本地 cosine，零成本零延迟。
 *
 * 返回空数组的常见情形：
 *  1. 目标卡未生成 embedding（用户没在 ⚙ 设置点过「补缺」）
 *  2. 全库 embedding 太少；或所有候选 score < minScore
 * UI 应区分提示，引导用户去 ⚙ 设置生成。
 *
 * 设计红线：纯本地算 + 仅复用已有书签数据，不引入外部数据源
 * （文档 §7.4：避免推荐质量失控 / 商业化嫌疑）
 */
export async function findSimilarCards(
  cardId: string,
  cards: BookmarkCard[],
  opts: FindSimilarOptions = {},
): Promise<{ hits: SimilarCardHit[]; reason?: 'no-self-embedding' | 'no-candidates' }> {
  const topK = opts.topK ?? 3
  const minScore = opts.minScore ?? 0.4

  // 取目标卡 + 全库 embedding 行
  const ids = cards.map((c) => c.id)
  const map = await getEmbeddingsMap(ids)
  const selfRow = map.get(cardId)
  if (!selfRow || selfRow.vector.length === 0) {
    return { hits: [], reason: 'no-self-embedding' }
  }

  const cardMap = new Map(cards.map((c) => [c.id, c]))
  const scored: SimilarCardHit[] = []
  for (const [id, row] of map) {
    if (id === cardId) continue
    if (row.vector.length === 0) continue
    const card = cardMap.get(id)
    if (!card) continue // 孤立 embedding，跳过
    const score = cosineSimilarity(selfRow.vector, row.vector)
    if (score < minScore) continue
    scored.push({ card, score })
  }
  if (scored.length === 0) {
    return { hits: [], reason: 'no-candidates' }
  }
  scored.sort((a, b) => b.score - a.score)
  return { hits: scored.slice(0, topK) }
}
