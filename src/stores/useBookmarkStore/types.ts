import type { BookmarkCard, Category, UserSettings } from '../../types/bookmark'
import type { BrowserHistoryItem, RecentEntry } from '../../types/recent'
import type { ExportOptions, ExportResult } from '../../services/bookmarkExporter'

/* ──────────────────────────────────────────────────────────────────────
 * 主书签 store 的接口定义；按职责分组对应到各 slice：
 *   - state ───── 数据
 *   - lifecycle ─ init / 浏览器书签导入导出
 *   - categories ─ 分类 CRUD + 排序
 *   - cards ────── 卡片 CRUD + 排序
 *   - tags ─────── 标签批量操作
 *   - recent ───── 最近使用 + 浏览器历史
 *   - settings ─── 用户设置
 *   - sync ─────── 远端拉回应用
 * ────────────────────────────────────────────────────────────────────── */

export type { BrowserHistoryItem, RecentEntry }

export interface BookmarkState {
  // ─── data ───────────────────────────────
  categories: Category[]
  cards: BookmarkCard[]
  activeCategoryId: string | null
  searchKeyword: string
  loading: boolean
  initialized: boolean

  /** 「最近使用」记录：按 openedAt 倒序（最新在前） */
  recentEntries: RecentEntry[]
  /** 「最近使用」展示的最大条目数（缓冲区可能多于此值） */
  recentLimit: number
  /**
   * 从浏览器历史拉取的条目（按 lastVisit 倒序）。
   * 仅当 settings.recentIncludeBrowserHistory 为 true 时才会被填充；
   * 关闭后会立即被清空，避免内存中残留隐私数据。
   */
  browserHistoryItems: BrowserHistoryItem[]
  /** 用户设置（主题 / 背景 等） */
  settings: UserSettings

  // ─── lifecycle ──────────────────────────
  init: () => Promise<void>
  /**
   * 从浏览器原生书签批量导入（合并模式）。
   * - 返回新增统计供调用方做 toast 反馈
   * - 失败时抛出原始 Error，由调用方捕获并提示
   */
  importFromBrowser: () => Promise<{
    categoriesAdded: number
    cardsAdded: number
    cardsSkipped: number
  }>
  /**
   * 把当前所有 categories + cards 同步到浏览器原生书签（镜像模式）。
   * - 在 options.root（书签栏 / 其他书签）下的 options.folderName 子文件夹内镜像
   * - 会把新生成的 bookmarkId 回写到对应 Category / BookmarkCard 并持久化
   * - 失败时抛原始 Error 由调用方 toast
   */
  exportToBrowser: (options: ExportOptions) => Promise<ExportResult>

  // ─── selection ──────────────────────────
  setActiveCategory: (id: string | null) => void
  setSearchKeyword: (kw: string) => void

  // ─── categories ─────────────────────────
  addCategory: (name: string, icon?: string, parentId?: string) => Promise<Category>
  renameCategory: (id: string, name: string) => Promise<void>
  /** 通用更新：可改 icon / color / 任意字段（不能改 id/parentId 结构） */
  updateCategory: (id: string, patch: Partial<Category>) => Promise<void>
  removeCategory: (id: string) => Promise<void>
  removeCategories: (ids: string[]) => Promise<void>
  reorderCategories: (orderedIds: string[]) => Promise<void>
  /** 仅在同一父级（parentId 相同）的兄弟节点中重排，不影响其他分类 */
  reorderSiblings: (
    parentId: string | undefined,
    orderedIds: string[],
  ) => Promise<void>
  /**
   * 通用移动：把分类 activeId 移到 targetParentId 下的 targetIndex 位置。
   * - 自动重排新父级与旧父级（如不同）的所有兄弟 order
   * - 校验循环引用：禁止把节点移到自己的后代下
   * - targetParentId 为 undefined 表示移到顶层
   */
  moveCategory: (
    activeId: string,
    targetParentId: string | undefined,
    targetIndex: number,
  ) => Promise<void>

  // ─── cards ──────────────────────────────
  addCard: (input: {
    categoryId: string
    title: string
    url: string
    /** 可选：备注（AI 建议 / popup 表单都用得到） */
    description?: string
    /** 可选：初始 tags（AI 建议时一次性写入） */
    tags?: string[]
    /** 可选：自定义图标（emoji / image url），缺省走 favicon */
    icon?: string
  }) => Promise<BookmarkCard>
  updateCard: (id: string, patch: Partial<BookmarkCard>) => Promise<void>
  removeCard: (id: string) => Promise<void>
  moveCard: (cardId: string, targetCategoryId: string, targetIndex: number) => Promise<void>
  reorderCardsInCategory: (categoryId: string, orderedIds: string[]) => Promise<void>

  // ─── tags ───────────────────────────────
  /** 设置某张卡片的 tags（覆盖式；空数组 = 清空） */
  setCardTags: (cardId: string, tags: string[]) => Promise<void>
  /** 批量设置 tags：{ cardId: tags }；用于 AI 一次性写入多条 */
  setCardTagsBatch: (entries: Array<{ cardId: string; tags: string[] }>) => Promise<void>
  /** 全库改名：把所有卡片中的 oldTag 替换为 newTag（去重） */
  renameTag: (oldTag: string, newTag: string) => Promise<void>
  /** 全库合并：把多个 tag 合并到一个目标 tag */
  mergeTags: (tagsToMerge: string[], target: string) => Promise<void>
  /** 全库删除：从所有卡片中移除该 tag */
  removeTag: (tag: string) => Promise<void>

  // ─── recent / browser history ───────────
  /** 记录一次"打开书签"，用于"最近使用"模块；自动去重并截断到 buffer 上限 */
  recordRecentOpen: (cardId: string) => Promise<void>
  /** 修改最近使用展示数量（持久化） */
  setRecentLimit: (n: number) => Promise<void>
  /** 清空所有最近使用记录 */
  clearRecent: () => Promise<void>
  /**
   * 拉取浏览器历史（chrome.history.search）并写入 browserHistoryItems。
   * - 仅在 settings.recentIncludeBrowserHistory 为 true 时调用才有意义
   * - 失败（无权限 / 用户拒绝）时静默吞掉，仅返回空列表，不污染状态
   */
  loadBrowserHistory: (maxResults?: number) => Promise<void>
  /** 从历史中删除一条 url（同步清理 browserHistoryItems） */
  deleteHistoryUrl: (url: string) => Promise<void>
  /**
   * 把一条历史项加入当前 activeCategory 作为书签卡片。
   * - 已经存在 (categoryId, url) 相同的卡片时跳过（与 importFromBrowser 的去重一致）
   * - 返回新建（或命中复用）的卡片；如果当前没有 activeCategory 则返回 null
   */
  addCardFromHistory: (input: {
    url: string
    title: string
  }) => Promise<BookmarkCard | null>

  // ─── settings ───────────────────────────
  /** 局部更新用户设置（自动持久化） */
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>
  /**
   * 把来自云端的可同步字段应用到本机。
   * 与 updateSettings 的差别：不会再触发 sync push（避免回声），
   * 也不会重复落 chrome.storage.local（应用本地持久化由 scheduleSettingsSave 兜底）。
   */
  applyRemoteSettings: (patch: Partial<UserSettings>) => Promise<void>

  // ─── sync ───────────────────────────────
  /**
   * 把来自云端的整套书签 payload 应用到本机（整包 LWW）。
   * - 不会回推（避免回声）
   * - 用 repo.bulkImport(mode='replace') 同时落盘，保证重启后看到的就是云端版本
   * - settings 不受影响（settings 走另一条管线）
   */
  applyRemoteBookmarks: (payload: {
    categories: Category[]
    cards: BookmarkCard[]
  }) => Promise<void>
}

/**
 * Slice 工厂函数签名：
 * - 接收 zustand 的 set/get
 * - 返回 BookmarkState 的部分（仅本 slice 负责的字段/action）
 *
 * 用 `Pick` 锁定每个 slice 的精确 surface，比 `Partial` 安全（漏写时会编译报错）。
 */
export type StoreSet = (
  partial:
    | BookmarkState
    | Partial<BookmarkState>
    | ((state: BookmarkState) => BookmarkState | Partial<BookmarkState>),
) => void
export type StoreGet = () => BookmarkState
