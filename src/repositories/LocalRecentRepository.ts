import { browser } from 'wxt/browser'
import type { RecentEntry } from '../types/recent'
import { DEFAULT_RECENT_LIMIT, MAX_RECENT_BUFFER } from '../types/recent'
import type { RecentRepository } from './types'

/**
 * browser.storage.local 中存放「最近使用」相关数据的 key。
 * 与 LocalRepository 的 KEYS 平级、命名空间一致（curio: 前缀）。
 */
export const RECENT_ENTRIES_KEY = 'curio:recent'
export const RECENT_LIMIT_KEY = 'curio:recentLimit'

/**
 * 基于 browser.storage.local 的「最近使用」实现。
 *
 * 设计取舍：
 * - 故意没有合并进 BookmarkRepository —— recent 是用户行为日志，与书签数据语义不同；
 *   未来若要单独同步到云端 / 切换到 Dexie，独立 repo 改起来更轻
 * - 任何读失败都返回默认值，写失败静默吞掉：UI 体验优先于持久化保证
 */
export class LocalRecentRepository implements RecentRepository {
  async loadEntries(): Promise<RecentEntry[]> {
    try {
      const result = await browser.storage.local.get(RECENT_ENTRIES_KEY)
      const raw = result[RECENT_ENTRIES_KEY]
      return Array.isArray(raw)
        ? (raw as RecentEntry[]).filter(
            (e) =>
              e && typeof e.cardId === 'string' && typeof e.openedAt === 'number',
          )
        : []
    } catch {
      return []
    }
  }

  async saveEntries(entries: RecentEntry[]): Promise<void> {
    try {
      await browser.storage.local.set({ [RECENT_ENTRIES_KEY]: entries })
    } catch {
      // browser.storage 偶发失败不影响内存状态
    }
  }

  async loadLimit(): Promise<number> {
    try {
      const result = await browser.storage.local.get(RECENT_LIMIT_KEY)
      const raw = result[RECENT_LIMIT_KEY]
      return typeof raw === 'number' && raw > 0
        ? Math.min(MAX_RECENT_BUFFER, Math.floor(raw))
        : DEFAULT_RECENT_LIMIT
    } catch {
      return DEFAULT_RECENT_LIMIT
    }
  }

  async saveLimit(limit: number): Promise<void> {
    try {
      await browser.storage.local.set({ [RECENT_LIMIT_KEY]: limit })
    } catch {
      // 同上：静默
    }
  }
}

/** 单例：与 localRepo 风格一致 */
export const localRecentRepo = new LocalRecentRepository()
