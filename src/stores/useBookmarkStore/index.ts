import { create } from 'zustand'
import { DEFAULT_SETTINGS } from '../../types/bookmark'
import { DEFAULT_RECENT_LIMIT } from '../../types/recent'
import { getMeta as getSyncMeta } from '../../services/SyncService'

import type { BookmarkState } from './types'
import { createLifecycleSlice } from './slices/lifecycleSlice'
import { createCategoriesSlice } from './slices/categoriesSlice'
import { createCardsSlice } from './slices/cardsSlice'
import { createTagsSlice } from './slices/tagsSlice'
import { createRecentSlice } from './slices/recentSlice'
import { createSettingsSlice } from './slices/settingsSlice'
import { createSyncSlice } from './slices/syncSlice'
import {
  installFlushHandlers,
  scheduleBookmarksSyncPush,
} from './scheduler'

/* ──────────────────────────────────────────────────────────────────────
 * 主书签 store：装配壳。
 *
 * v0.21.x 起的演进史：
 *   - 初版：单文件 963 行（state + 全部 action + 调度器）
 *   - 第一次拆：helpers.ts / types/recent.ts / 两个 repository 抽出
 *   - 本次拆：把 40+ action 按职责切到 7 个 slice、3 个 debounce 调度器抽到
 *     scheduler.ts。本文件只负责：
 *       1) 装配 initial state + 所有 slice
 *       2) 重导出 types / 常量 / 公开工具函数
 *       3) 调用 installFlushHandlers() 挂载 beforeunload/visibilitychange
 *
 * 外部 import path 保持不变（folder-with-index 解析）：
 *   import { useBookmarkStore } from '@/stores/useBookmarkStore'
 * ────────────────────────────────────────────────────────────────────── */

// 公共类型 / 常量重导出，保持原对外 API 不变
export type { BrowserHistoryItem, RecentEntry } from './types'
export { DEFAULT_RECENT_LIMIT }

// 调度器公开 API 透传（兼容老的导入路径）
export {
  flushPendingSyncPush,
  cancelPendingSyncPush,
} from './scheduler'

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
  // ─── initial state ──────────────────────────
  categories: [],
  cards: [],
  activeCategoryId: null,
  searchKeyword: '',
  loading: false,
  initialized: false,
  recentEntries: [],
  recentLimit: DEFAULT_RECENT_LIMIT,
  browserHistoryItems: [],
  settings: DEFAULT_SETTINGS,

  // ─── trivial selectors ──────────────────────
  setActiveCategory(id) {
    set({ activeCategoryId: id })
  },
  setSearchKeyword(kw) {
    set({ searchKeyword: kw })
  },

  // ─── slices ────────────────────────────────
  ...createLifecycleSlice(set, get),
  ...createCategoriesSlice(set, get),
  ...createCardsSlice(set, get),
  ...createTagsSlice(set, get),
  ...createRecentSlice(set, get),
  ...createSettingsSlice(set, get),
  ...createSyncSlice(set, get),
}))

// 挂 unload / visibility 监听，避免用户拖完滑块立刻关掉标签页时丢失最新值
installFlushHandlers()

/**
 * 暴露给所有产生 categories/cards 变更的外部入口（如 importFromBrowser、
 * AI organize、批量打标签 setCardTagsBatch / renameTag / mergeTags / removeTag、
 * exportToBrowser 回写 bookmarkId 等）。
 *
 * 内部 store 里的简单 CRUD 已经各自统一在 set() 后调用 scheduleBookmarksSyncPush。
 */
export function notifyBookmarksChanged() {
  scheduleBookmarksSyncPush()
}

/** 暴露给外部用：检查当前 meta.enabled 状态（如 onChanged listener 启动检测） */
export async function isSyncEnabled(): Promise<boolean> {
  const m = await getSyncMeta()
  return !!m.enabled
}
