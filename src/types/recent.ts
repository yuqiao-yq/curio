/**
 * 「最近使用」与浏览器历史相关的共享类型与常量。
 *
 * 之所以独立成文件而不是放在 bookmark.ts：
 * - 这些数据并非"书签"本体，只是 UI 衍生的临时记录
 * - 让 stores 和 repositories 都能引用而不必互相 import
 */

/**
 * 最近使用记录：
 * - cardId: 引用 BookmarkCard.id；卡片被删除时会同步清理
 * - openedAt: 打开时间戳（ms），用于排序与去重决策
 */
export interface RecentEntry {
  cardId: string
  openedAt: number
}

/**
 * 浏览器历史条目（精简版，只保留 UI 渲染所需字段）。
 * 来自 browser.history.search()，不持久化到本地存储 —— 每次新开标签页时按需拉取。
 * 隐私考虑：浏览器原生历史本身已在用户掌控之中，我们只读不写、不复制到自己的存储里。
 */
export interface BrowserHistoryItem {
  url: string
  title: string
  /** 最后一次访问时间戳（ms）；某些浏览器返回的 lastVisitTime 可能为 undefined，统一兜底为 0 */
  lastVisit: number
}

/** 默认显示数量；用户可在 RecentSection 中修改并持久化 */
export const DEFAULT_RECENT_LIMIT = 8

/** 内存中保留的最大条目数：留出余量，方便用户调大 N 时仍能显示历史；显示时再切片 */
export const MAX_RECENT_BUFFER = 100
