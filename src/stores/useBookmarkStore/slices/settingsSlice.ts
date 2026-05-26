import type { UserSettings } from '../../../types/bookmark'
import { syncableChanged } from '../../../services/SyncService'
import { scheduleSettingsSave, scheduleSettingsSyncPush } from '../scheduler'
import type { BookmarkState, StoreGet, StoreSet } from '../types'

/* ──────────────────────────────────────────────────────────────────────
 * 用户设置写入（本地 + 云同步两条管线）。
 *
 * updateSettings 与 applyRemoteSettings 的差别：
 *   - updateSettings 走完整管线：local debounce + sync push（若可同步字段变化）
 *   - applyRemoteSettings 是云端回灌：只落 local（避免回声），不再 push
 *
 * 副作用：recentIncludeBrowserHistory 切换会同步处理 browserHistoryItems
 * （开启时拉取，关闭时清空）。
 * ────────────────────────────────────────────────────────────────────── */

type SettingsSlice = Pick<
  BookmarkState,
  'updateSettings' | 'applyRemoteSettings'
>

export const createSettingsSlice = (
  set: StoreSet,
  get: StoreGet,
): SettingsSlice => ({
  async updateSettings(patch) {
    const prev = get().settings
    const next: UserSettings = { ...prev, ...patch }
    set({ settings: next })

    // v0.21.x：把磁盘写入 debounce。背景模糊 / 字体色 / 壁纸颜色等滑块
    // 拖动时会以 ~60Hz 触发本函数，之前每次都 chrome.storage.local.set(整个 settings)
    // 既浪费 IO 又会拖慢主线程。现在 250ms idle 后只写最新一次。
    //
    // 内存状态依旧同步更新（上面的 set），UI 立刻响应；只有持久化被 defer。
    // unload 路径由模块级 beforeunload/visibilitychange 监听兜底 flush。
    scheduleSettingsSave()

    // V1.5：可同步字段发生变化时，再 debounce 一次推送到云端
    // - 不可同步字段（壁纸、侧边栏宽度、browserSync*）不会触发推送
    // - 自身节流到 800ms（比 local 慢，云端 quota 更紧：120 ops/min）
    if (syncableChanged(prev, next)) {
      scheduleSettingsSyncPush()
    }

    // ─── 副作用：开关切换时同步处理 browserHistoryItems ───
    const prevOn = !!prev.recentIncludeBrowserHistory
    const nextOn = !!next.recentIncludeBrowserHistory
    if (!prevOn && nextOn) {
      // 关 → 开：立即拉取一次，让用户感知到生效
      await get().loadBrowserHistory()
    } else if (prevOn && !nextOn) {
      // 开 → 关：清空内存，避免历史数据残留
      set({ browserHistoryItems: [] })
    }
  },

  async applyRemoteSettings(patch) {
    const prev = get().settings
    const next: UserSettings = { ...prev, ...patch }
    set({ settings: next })
    // 仍要落本地，让重启后从 local 读到最新值；走 scheduleSettingsSave
    // 而不是即时写，是为了把多个 onChanged 合批。
    scheduleSettingsSave()
    // 注意：故意 不 调 scheduleSettingsSyncPush，避免回声循环。
    // 副作用：开关切换时同步处理 browserHistoryItems（与 updateSettings 一致）
    const prevOn = !!prev.recentIncludeBrowserHistory
    const nextOn = !!next.recentIncludeBrowserHistory
    if (!prevOn && nextOn) {
      await get().loadBrowserHistory()
    } else if (prevOn && !nextOn) {
      set({ browserHistoryItems: [] })
    }
  },
})
