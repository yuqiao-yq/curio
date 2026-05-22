import { browser } from 'wxt/browser'
import type { BrowserHistoryItem } from '../types/recent'
import type { BrowserHistoryRepository } from './types'

/**
 * 包装 browser.history.* 的只读适配器。
 *
 * 实现说明：
 * - WXT 的 browser 类型并非所有浏览器/版本都默认包含 history 字段，
 *   这里通过窄化的 unknown 断言访问，避免硬编码 chrome.* 失去 firefox 兼容
 * - 任何异常都吞掉返回空数组 / 静默忽略，保证 UI 不崩
 */
type RawHistoryItem = {
  url?: string
  title?: string
  lastVisitTime?: number
}

type HistoryApi = {
  search?: (query: {
    text: string
    startTime?: number
    maxResults?: number
  }) => Promise<RawHistoryItem[]>
  deleteUrl?: (details: { url: string }) => Promise<void>
}

function getHistoryApi(): HistoryApi | undefined {
  return (browser as unknown as { history?: HistoryApi }).history
}

export class BrowserHistoryAdapter implements BrowserHistoryRepository {
  async search(maxResults: number): Promise<BrowserHistoryItem[]> {
    try {
      const api = getHistoryApi()
      if (!api?.search) return []
      const raw = await api.search({ text: '', startTime: 0, maxResults })
      return raw
        .filter((it): it is RawHistoryItem & { url: string } => !!it.url)
        .map((it) => ({
          url: it.url,
          title: it.title?.trim() || it.url,
          lastVisit: typeof it.lastVisitTime === 'number' ? it.lastVisitTime : 0,
        }))
        .sort((a, b) => b.lastVisit - a.lastVisit)
    } catch {
      return []
    }
  }

  async deleteUrl(url: string): Promise<void> {
    try {
      const api = getHistoryApi()
      if (api?.deleteUrl) {
        await api.deleteUrl({ url })
      }
    } catch {
      /* ignore: 没权限或浏览器不支持 */
    }
  }
}

/** 单例：与 localRepo / localRecentRepo 风格一致 */
export const browserHistoryRepo = new BrowserHistoryAdapter()
