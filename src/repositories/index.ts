/**
 * Repository 入口
 *
 * 当前只提供本地实现。
 * 后续 V2 加入 Drive/Supabase 时，在此处通过 settings.syncProvider 决定返回哪种实现。
 */
import { localRepo } from './LocalRepository'
import { localRecentRepo } from './LocalRecentRepository'
import { browserHistoryRepo } from './BrowserHistoryAdapter'
import type {
  BookmarkRepository,
  BrowserHistoryRepository,
  RecentRepository,
} from './types'

let _repo: BookmarkRepository = localRepo
let _recentRepo: RecentRepository = localRecentRepo
let _historyRepo: BrowserHistoryRepository = browserHistoryRepo

export function getRepository(): BookmarkRepository {
  return _repo
}

export function setRepository(repo: BookmarkRepository) {
  _repo = repo
}

export function getRecentRepository(): RecentRepository {
  return _recentRepo
}

export function setRecentRepository(repo: RecentRepository) {
  _recentRepo = repo
}

export function getBrowserHistoryRepository(): BrowserHistoryRepository {
  return _historyRepo
}

export function setBrowserHistoryRepository(repo: BrowserHistoryRepository) {
  _historyRepo = repo
}

export type {
  BookmarkRepository,
  BrowserHistoryRepository,
  RecentRepository,
} from './types'
