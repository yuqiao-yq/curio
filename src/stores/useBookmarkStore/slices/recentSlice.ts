import { getBrowserHistoryRepository, getRecentRepository } from '../../../repositories'
import { MAX_RECENT_BUFFER } from '../../../types/recent'
import type { RecentEntry } from '../../../types/recent'
import type { BookmarkState, StoreGet, StoreSet } from '../types'

/* ──────────────────────────────────────────────────────────────────────
 * 最近使用 + 浏览器历史。
 *
 * 隐私边界：
 *   - browserHistoryItems 仅在 settings.recentIncludeBrowserHistory=true 时填充
 *   - 关闭开关会立即清空内存，避免历史数据残留
 *
 * recordRecentOpen 会去重 + 截断到 MAX_RECENT_BUFFER，buffer 比展示 limit 大，
 * 用户调高 recentLimit 时不需要重新建立行为数据。
 * ────────────────────────────────────────────────────────────────────── */

type RecentSlice = Pick<
  BookmarkState,
  | 'recordRecentOpen'
  | 'setRecentLimit'
  | 'clearRecent'
  | 'loadBrowserHistory'
  | 'deleteHistoryUrl'
  | 'addCardFromHistory'
>

export const createRecentSlice = (
  set: StoreSet,
  get: StoreGet,
): RecentSlice => ({
  async recordRecentOpen(cardId) {
    // 卡片必须存在；若已被删除则忽略，避免脏记录
    if (!get().cards.some((c) => c.id === cardId)) return
    const now = Date.now()
    // 去重：移除已有记录后追加新记录到最前
    const filtered = get().recentEntries.filter((e) => e.cardId !== cardId)
    const next: RecentEntry[] = [{ cardId, openedAt: now }, ...filtered].slice(
      0,
      MAX_RECENT_BUFFER,
    )
    set({ recentEntries: next })
    await getRecentRepository().saveEntries(next)
  },

  async setRecentLimit(n) {
    // 合理边界：1 ~ MAX_RECENT_BUFFER
    const clamped = Math.max(1, Math.min(MAX_RECENT_BUFFER, Math.floor(n)))
    if (clamped === get().recentLimit) return
    set({ recentLimit: clamped })
    await getRecentRepository().saveLimit(clamped)
  },

  async clearRecent() {
    if (get().recentEntries.length === 0) return
    set({ recentEntries: [] })
    await getRecentRepository().saveEntries([])
  },

  async loadBrowserHistory(maxResults = MAX_RECENT_BUFFER) {
    // 关闭开关时不加载；防御性检查，避免被误调用拉取数据
    if (!get().settings.recentIncludeBrowserHistory) return
    const items = await getBrowserHistoryRepository().search(maxResults)
    set({ browserHistoryItems: items })
  },

  async deleteHistoryUrl(url) {
    // 1. 从浏览器原生历史中删除（如果可用）
    await getBrowserHistoryRepository().deleteUrl(url)
    // 2. 同步内存状态，立即把卡片从 UI 移除（即使原生删除失败也保持 UI 一致）
    set({
      browserHistoryItems: get().browserHistoryItems.filter(
        (it) => it.url !== url,
      ),
    })
  },

  async addCardFromHistory({ url, title }) {
    const categoryId = get().activeCategoryId
    if (!categoryId) return null
    // 去重：同一分类下已有相同 url 时直接复用，不再追加
    const exist = get().cards.find(
      (c) => c.categoryId === categoryId && c.url === url,
    )
    if (exist) return exist
    return await get().addCard({ categoryId, title: title || url, url })
  },
})
