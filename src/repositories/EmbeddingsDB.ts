import Dexie, { type Table } from 'dexie'

/**
 * 书签 embedding 存储（V1.5 §5.1 语义搜索）
 *
 * 为什么用 IndexedDB 而不是 chrome.storage.local：
 * - chrome.storage.local 整体上限 5MB，且存的都是 JSON
 * - 1536 维 float32 ≈ 6KB / 书签；1000 个书签就 6MB，已经超限
 * - IndexedDB 没这个量级限制，且二进制写入不需要 JSON.stringify
 *
 * 表结构：
 *   embeddings: bookmarkId(主键) | vector(Float32Array) | model | contentHash | createdAt
 *
 * - vector 用 Float32Array 而非 number[]：体积 ≈ 1/3，序列化更快
 * - contentHash 用于增量判断：当 card.title/url/tags/description 任一变化时
 *   重算 hash 不一致 → 视为 stale，下次「补缺」会重生成
 * - model 写入向量来源的模型名；不同模型的向量不可比较，切换模型后必须全量重生成
 */

export interface EmbeddingRow {
  bookmarkId: string
  vector: Float32Array
  /** 用于增量判断 + 跨模型校验 */
  model: string
  /** 输入文本的内容指纹（djb2 hash 的 36 进制字符串） */
  contentHash: string
  createdAt: number
}

class EmbeddingsDexie extends Dexie {
  embeddings!: Table<EmbeddingRow, string>

  constructor() {
    super('curio-embeddings')
    // v1：只有 embeddings 表，主键 = bookmarkId
    this.version(1).stores({
      embeddings: 'bookmarkId, model, createdAt',
    })
  }
}

export const embeddingsDB = new EmbeddingsDexie()

// ─── 高层 API（业务侧统一走这层，不直接碰 dexie） ─────

/** 取所有 embedding 行（用于 search 或 dashboard 统计） */
export async function getAllEmbeddings(): Promise<EmbeddingRow[]> {
  return embeddingsDB.embeddings.toArray()
}

/** 取一批 bookmarkId → vector 的快查 map（仅返回命中的） */
export async function getEmbeddingsMap(
  bookmarkIds: string[],
): Promise<Map<string, EmbeddingRow>> {
  if (bookmarkIds.length === 0) return new Map()
  const rows = await embeddingsDB.embeddings.bulkGet(bookmarkIds)
  const map = new Map<string, EmbeddingRow>()
  for (const r of rows) {
    if (r) map.set(r.bookmarkId, r)
  }
  return map
}

/** 单条 upsert */
export async function putEmbedding(row: EmbeddingRow): Promise<void> {
  await embeddingsDB.embeddings.put(row)
}

/** 批量 upsert（生成器主流程用） */
export async function putEmbeddings(rows: EmbeddingRow[]): Promise<void> {
  if (rows.length === 0) return
  await embeddingsDB.embeddings.bulkPut(rows)
}

/** 删除一条 */
export async function deleteEmbedding(bookmarkId: string): Promise<void> {
  await embeddingsDB.embeddings.delete(bookmarkId)
}

/** 批量删除（用于级联删除分类时同步清理） */
export async function deleteEmbeddings(bookmarkIds: string[]): Promise<void> {
  if (bookmarkIds.length === 0) return
  await embeddingsDB.embeddings.bulkDelete(bookmarkIds)
}

/** 清空（更换模型或用户主动重生成时用） */
export async function clearEmbeddings(): Promise<void> {
  await embeddingsDB.embeddings.clear()
}

/** 当前已索引的 bookmarkId 集合（不读取 vector，避免大 payload） */
export async function getIndexedIds(): Promise<Set<string>> {
  const keys = await embeddingsDB.embeddings.toCollection().primaryKeys()
  return new Set(keys as string[])
}

/** 简易计数（给 UI dashboard 用） */
export async function countEmbeddings(): Promise<number> {
  return embeddingsDB.embeddings.count()
}
