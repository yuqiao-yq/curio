import Dexie, { type Table } from 'dexie'

/**
 * 网页内容存储（V2.0 §6.1 网页正文抓取）
 *
 * 与 EmbeddingsDB 解耦：放独立 db 避免 schema 升级互相影响；体积也不一样
 * （单条正文最多 8KB，千条 ≈ 8MB；远低于 IndexedDB 上限）。
 *
 * 表结构：
 *   pageContents:
 *     bookmarkId(主键) | url | title | excerpt | content | contentHash
 *                     | status | error? | httpStatus? | fetchedAt
 *
 * - status='ok' 时 content 是 readability 提取的正文（截断至 8000 字符）
 * - status='failed' 时 content 为空，error 字段记录失败原因，下次仍可重试
 * - contentHash 是「响应正文的简单 hash」，用于跨次抓取识别"内容是否变了"
 */

export type PageContentStatus = 'ok' | 'failed'

export interface PageContentRow {
  bookmarkId: string
  /** 抓取时使用的 URL（与卡片 URL 一致；存一份方便排查） */
  url: string
  title: string
  excerpt?: string
  /** 正文（截断到 8000 字符）；status='failed' 时为空字符串 */
  content: string
  /** 响应正文的简单 hash；status='failed' 时为空 */
  contentHash: string
  status: PageContentStatus
  /** 失败原因（HTTP 状态描述 / readability 解析失败 / 超时 / 网络错） */
  error?: string
  /** HTTP 状态码（4xx / 5xx 时填） */
  httpStatus?: number
  fetchedAt: number
}

class PageContentsDexie extends Dexie {
  pageContents!: Table<PageContentRow, string>

  constructor() {
    super('curio-pages')
    this.version(1).stores({
      // 主键 bookmarkId；status 加索引便于"按状态过滤"
      pageContents: 'bookmarkId, status, fetchedAt',
    })
  }
}

export const pageContentsDB = new PageContentsDexie()

// ─── 高层 API ─────────────────────────────────────

export async function getAllPageContents(): Promise<PageContentRow[]> {
  return pageContentsDB.pageContents.toArray()
}

export async function getPageContent(
  bookmarkId: string,
): Promise<PageContentRow | undefined> {
  return pageContentsDB.pageContents.get(bookmarkId)
}

export async function getPageContentsMap(
  bookmarkIds: string[],
): Promise<Map<string, PageContentRow>> {
  if (bookmarkIds.length === 0) return new Map()
  const rows = await pageContentsDB.pageContents.bulkGet(bookmarkIds)
  const map = new Map<string, PageContentRow>()
  for (const r of rows) {
    if (r) map.set(r.bookmarkId, r)
  }
  return map
}

export async function putPageContent(row: PageContentRow): Promise<void> {
  await pageContentsDB.pageContents.put(row)
}

export async function putPageContents(rows: PageContentRow[]): Promise<void> {
  if (rows.length === 0) return
  await pageContentsDB.pageContents.bulkPut(rows)
}

export async function deletePageContent(bookmarkId: string): Promise<void> {
  await pageContentsDB.pageContents.delete(bookmarkId)
}

export async function deletePageContents(bookmarkIds: string[]): Promise<void> {
  if (bookmarkIds.length === 0) return
  await pageContentsDB.pageContents.bulkDelete(bookmarkIds)
}

export async function clearPageContents(): Promise<void> {
  await pageContentsDB.pageContents.clear()
}

/** 状态计数：给 UI dashboard 用 */
export async function countByStatus(): Promise<{
  ok: number
  failed: number
  total: number
}> {
  const [ok, failed, total] = await Promise.all([
    pageContentsDB.pageContents.where('status').equals('ok').count(),
    pageContentsDB.pageContents.where('status').equals('failed').count(),
    pageContentsDB.pageContents.count(),
  ])
  return { ok, failed, total }
}

/** 取所有 status='failed' 的行（给"重试失败"按钮用） */
export async function getFailedRows(): Promise<PageContentRow[]> {
  return pageContentsDB.pageContents.where('status').equals('failed').toArray()
}

/** 已索引的 bookmarkId 集合（仅 status='ok'） */
export async function getOkBookmarkIds(): Promise<Set<string>> {
  const rows = await pageContentsDB.pageContents
    .where('status')
    .equals('ok')
    .primaryKeys()
  return new Set(rows as string[])
}
