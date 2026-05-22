import type {
  BookmarkCard,
  Category,
  ExportData,
  SyncResult,
  UserSettings,
} from '../types/bookmark'
import type { BrowserHistoryItem, RecentEntry } from '../types/recent'

/** 批量导入模式 */
export type BulkImportMode = 'merge' | 'replace'

/** 批量导入结果统计 */
export interface BulkImportResult {
  mode: BulkImportMode
  categoriesAdded: number
  categoriesUpdated: number
  cardsAdded: number
  cardsUpdated: number
}

/**
 * 存储抽象层接口
 *
 * 业务层只依赖此接口，便于在以下实现间切换/共存：
 * - LocalRepository（chrome.storage.local + IndexedDB）
 * - DriveRepository（Google Drive appdata，V2）
 * - SupabaseRepository（Supabase，V2）
 */
export interface BookmarkRepository {
  // ---------- 分类 ----------
  getCategories(): Promise<Category[]>
  saveCategory(cat: Category): Promise<void>
  /** 批量保存（避免并发"读-改-写"竞态） */
  saveCategories(cats: Category[]): Promise<void>
  deleteCategory(id: string): Promise<void>
  /** 批量删除分类（连同分类下卡片一并删除） */
  deleteCategories(ids: string[]): Promise<void>

  // ---------- 卡片 ----------
  getCards(categoryId?: string): Promise<BookmarkCard[]>
  saveCard(card: BookmarkCard): Promise<void>
  saveCards(cards: BookmarkCard[]): Promise<void>
  deleteCard(id: string): Promise<void>

  // ---------- 设置 ----------
  getSettings(): Promise<UserSettings>
  saveSettings(settings: UserSettings): Promise<void>

  // ---------- 批量 ----------
  /**
   * 批量导入数据。
   * - mode='merge'（默认，安全）：与本地数据合并，同 ID 取 updatedAt 更新者，新 ID 追加并重排 order；不覆盖本地 settings
   * - mode='replace'：完全替换本地数据（含 settings），慎用
   */
  bulkImport(data: ExportData, mode?: BulkImportMode): Promise<BulkImportResult>
  bulkExport(): Promise<ExportData>
  clear(): Promise<void>

  // ---------- 同步（V2 实现） ----------
  sync?(): Promise<SyncResult>
}

/**
 * 「最近使用」存储抽象。
 *
 * 当前唯一实现是基于 browser.storage.local 的 LocalRecentRepository。
 * 把它独立成接口的好处：
 * - 与 BookmarkRepository 的写盘解耦（最近记录是行为日志，与书签数据语义不同）
 * - 未来若要换到 IndexedDB / 云端同步，store 层无需改动
 * - 测试中可以 mock 一份内存实现，避免污染 browser.storage
 */
export interface RecentRepository {
  loadEntries(): Promise<RecentEntry[]>
  saveEntries(entries: RecentEntry[]): Promise<void>
  loadLimit(): Promise<number>
  saveLimit(limit: number): Promise<void>
}

/**
 * 浏览器原生历史只读适配。
 *
 * 我们不存储这些数据，只在用户开启「最近使用包含浏览器历史」时按需拉取。
 * 抽成接口便于：
 * - 在不支持 history API 的浏览器（含部分 Firefox 权限场景）下静默降级
 * - 在测试中喂入固定的 fixture
 */
export interface BrowserHistoryRepository {
  /** 拉取最近的浏览器历史；不可用时返回空数组而不是抛错 */
  search(maxResults: number): Promise<BrowserHistoryItem[]>
  /** best-effort 删除某条 url；不可用时静默忽略 */
  deleteUrl(url: string): Promise<void>
}
