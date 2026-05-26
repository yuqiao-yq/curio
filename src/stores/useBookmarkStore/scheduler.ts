import { getRepository } from '../../repositories'
import {
  pushSettings as syncPushSettings,
  pushBookmarks as syncPushBookmarks,
} from '../../services/SyncService'
import { useBookmarkStore } from '.'

/* ──────────────────────────────────────────────────────────────────────
 * 持久化 / 同步推送 debounce 调度器。
 *
 * 三条独立 timer：
 *   1. settings 写盘：250ms — 拖滑块时 60Hz tick 合并成一次写
 *   2. settings 同步推送：800ms — 高频低字节，慢一档
 *   3. bookmarks 同步推送：1500ms — 拖拽/批量"一阵子操作"合并成一次推送
 *
 * chrome.storage.sync 配额：120 writes/min + 1800 writes/hour
 * 两条同步管线 + 各自 debounce 是双层保护。
 *
 * ⚠️ 循环依赖说明：
 *   本文件 import { useBookmarkStore } from '.'，而 index.ts 又会 import
 *   本文件的 schedule*。看似循环，但因为 useBookmarkStore.getState() 仅在
 *   timer 回调（运行时）调用，模块顶层零访问，ESM binding hoisting 解决一切。
 *   不要在本文件顶层调用 getState()。
 * ────────────────────────────────────────────────────────────────────── */

// ─── settings 写盘 ─────────────────────────────────────────
let settingsSaveTimer: ReturnType<typeof setTimeout> | null = null
const SETTINGS_SAVE_DEBOUNCE_MS = 250

export function scheduleSettingsSave() {
  if (settingsSaveTimer) clearTimeout(settingsSaveTimer)
  settingsSaveTimer = setTimeout(() => {
    settingsSaveTimer = null
    void getRepository().saveSettings(useBookmarkStore.getState().settings)
  }, SETTINGS_SAVE_DEBOUNCE_MS)
}

function flushSettingsSave() {
  if (!settingsSaveTimer) return
  clearTimeout(settingsSaveTimer)
  settingsSaveTimer = null
  void getRepository().saveSettings(useBookmarkStore.getState().settings)
}

// ─── settings 同步推送 ─────────────────────────────────────
let settingsSyncPushTimer: ReturnType<typeof setTimeout> | null = null
const SETTINGS_SYNC_PUSH_DEBOUNCE_MS = 800

export function scheduleSettingsSyncPush() {
  if (settingsSyncPushTimer) clearTimeout(settingsSyncPushTimer)
  settingsSyncPushTimer = setTimeout(() => {
    settingsSyncPushTimer = null
    void syncPushSettings(useBookmarkStore.getState().settings)
  }, SETTINGS_SYNC_PUSH_DEBOUNCE_MS)
}

function flushSettingsSyncPush() {
  if (!settingsSyncPushTimer) return
  clearTimeout(settingsSyncPushTimer)
  settingsSyncPushTimer = null
  void syncPushSettings(useBookmarkStore.getState().settings)
}

// ─── bookmarks 同步推送 ────────────────────────────────────
let bookmarksSyncPushTimer: ReturnType<typeof setTimeout> | null = null
const BOOKMARKS_SYNC_PUSH_DEBOUNCE_MS = 1500

export function scheduleBookmarksSyncPush() {
  if (bookmarksSyncPushTimer) clearTimeout(bookmarksSyncPushTimer)
  bookmarksSyncPushTimer = setTimeout(() => {
    bookmarksSyncPushTimer = null
    const s = useBookmarkStore.getState()
    void syncPushBookmarks(s.categories, s.cards)
  }, BOOKMARKS_SYNC_PUSH_DEBOUNCE_MS)
}

function flushBookmarksSyncPush() {
  if (!bookmarksSyncPushTimer) return
  clearTimeout(bookmarksSyncPushTimer)
  bookmarksSyncPushTimer = null
  const s = useBookmarkStore.getState()
  void syncPushBookmarks(s.categories, s.cards)
}

// ─── 公开 flush / cancel API ───────────────────────────────

/** 暴露给外部按需主动 flush 两条推送管线 */
export function flushPendingSyncPush() {
  flushSettingsSyncPush()
  flushBookmarksSyncPush()
}

/**
 * 取消两条挂起的推送（不写云端）。
 * 「从云端覆盖」前要先调一下，避免：用户刚改了本地 → 还没到 debounce → 点拉取，
 * 在 readRemote 的 await 间隙里 push 触发，把刚改的本地值推上去，
 * 紧接着 pull 拿回来一看『云端 = 本地新值』，覆盖看起来没生效。
 */
export function cancelPendingSyncPush() {
  if (settingsSyncPushTimer) {
    clearTimeout(settingsSyncPushTimer)
    settingsSyncPushTimer = null
  }
  if (bookmarksSyncPushTimer) {
    clearTimeout(bookmarksSyncPushTimer)
    bookmarksSyncPushTimer = null
  }
}

/**
 * 安装 beforeunload / visibilitychange 监听，在标签关闭或后台时
 * 同步 flush 三条 timer，避免用户操作丢失。
 * 由 index.ts 在模块加载末尾调用一次。
 */
export function installFlushHandlers() {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeunload', () => {
    flushSettingsSave()
    flushSettingsSyncPush()
    flushBookmarksSyncPush()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushSettingsSave()
      flushSettingsSyncPush()
      flushBookmarksSyncPush()
    }
  })
}
