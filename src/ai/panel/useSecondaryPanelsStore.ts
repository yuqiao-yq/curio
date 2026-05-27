import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { browser } from 'wxt/browser'
import type { PanelPosition, PanelSize, SecondaryPanel } from '../types'

/**
 * 副浮窗（分离 tab）状态管理（V3.0 §7.3）
 *
 * 与主 useAIPanelStore 解耦：
 * - 主 store 管"主浮窗 + 所有 tabs 的数据"
 * - 本 store 仅管"哪些 tab 被分离了 + 它们各自的窗口位置/尺寸/zIndex/最小化"
 * - tab 内容仍由主 store 提供；本 store 只通过 tabId 引用
 *
 * 持久化：所有副浮窗的"窗口几何"信息整体写到 storage.local，
 * 主浮窗刷新后副浮窗能恢复（前提是被绑的 tab.id 还在主 store 里）。
 */

const STORAGE_KEY = 'curio:ai-secondary-panels'

interface PersistedShape {
  panels: SecondaryPanel[]
  /** 自增基础 zIndex；保证 bump 后仍递增不饱和 */
  zCounter: number
}

interface SecondaryPanelsStore {
  panels: SecondaryPanel[]
  /** 自增 zIndex 基线；focusPanel 时 +1 */
  zCounter: number
  hydrated: boolean

  init: () => Promise<void>

  /** 创建一个绑到 tabId 的新副浮窗；返回新 panel id */
  detach: (
    tabId: string,
    initialPosition?: PanelPosition,
    initialSize?: PanelSize,
  ) => string
  /** 关闭副浮窗（tab 数据本身不动） */
  closePanel: (panelId: string) => void
  /** 把 zIndex bump 到当前最大 + 1（焦点切换） */
  focusPanel: (panelId: string) => void
  /** 切换最小化 */
  toggleMinimize: (panelId: string) => void

  setPosition: (panelId: string, p: PanelPosition) => void
  setSize: (panelId: string, s: PanelSize) => void

  /** 主 store closeTab 后调：移除引用该 tabId 的所有副浮窗 */
  removeByTabId: (tabId: string) => void
  /** 全部清空（很少用，给 debug 留口） */
  clearAll: () => void
}

export const useSecondaryPanelsStore = create<SecondaryPanelsStore>((set, get) => ({
  panels: [],
  zCounter: 1,
  hydrated: false,

  async init() {
    try {
      const result = await browser.storage.local.get(STORAGE_KEY)
      const raw = result[STORAGE_KEY] as PersistedShape | undefined
      if (raw && Array.isArray(raw.panels)) {
        // 防御性过滤：必须有 id + tabId
        const safe = raw.panels.filter(
          (p) => typeof p?.id === 'string' && typeof p?.tabId === 'string',
        )
        set({
          panels: safe,
          zCounter:
            typeof raw.zCounter === 'number' && raw.zCounter > 0
              ? raw.zCounter
              : Math.max(0, ...safe.map((p) => p.zIndex)) + 1,
          hydrated: true,
        })
      } else {
        set({ hydrated: true })
      }
    } catch {
      set({ hydrated: true })
    }
  },

  detach(tabId, initialPosition, initialSize) {
    const id = uuid()
    const z = get().zCounter
    const panel: SecondaryPanel = {
      id,
      tabId,
      position: initialPosition,
      size: initialSize,
      minimized: false,
      zIndex: z,
      createdAt: Date.now(),
    }
    set((s) => ({ panels: [...s.panels, panel], zCounter: s.zCounter + 1 }))
    persist(get())
    return id
  },

  closePanel(panelId) {
    set((s) => ({ panels: s.panels.filter((p) => p.id !== panelId) }))
    persist(get())
  },

  focusPanel(panelId) {
    const cur = get()
    const exist = cur.panels.find((p) => p.id === panelId)
    if (!exist) return
    // 已经是最高就不动，避免无意义重渲
    const max = Math.max(...cur.panels.map((p) => p.zIndex))
    if (exist.zIndex === max) return
    const newZ = cur.zCounter
    set((s) => ({
      panels: s.panels.map((p) =>
        p.id === panelId ? { ...p, zIndex: newZ } : p,
      ),
      zCounter: s.zCounter + 1,
    }))
    persist(get())
  },

  toggleMinimize(panelId) {
    set((s) => ({
      panels: s.panels.map((p) =>
        p.id === panelId ? { ...p, minimized: !p.minimized } : p,
      ),
    }))
    persist(get())
  },

  setPosition(panelId, p) {
    set((s) => ({
      panels: s.panels.map((x) => (x.id === panelId ? { ...x, position: p } : x)),
    }))
    persistDebounced(get())
  },

  setSize(panelId, sz) {
    set((s) => ({
      panels: s.panels.map((x) => (x.id === panelId ? { ...x, size: sz } : x)),
    }))
    persistDebounced(get())
  },

  removeByTabId(tabId) {
    const cur = get()
    if (!cur.panels.some((p) => p.tabId === tabId)) return
    set({ panels: cur.panels.filter((p) => p.tabId !== tabId) })
    persist(get())
  },

  clearAll() {
    set({ panels: [], zCounter: 1 })
    persist(get())
  },
}))

// ─── 持久化 ───────────────────────────────────────

let persistTimer: ReturnType<typeof setTimeout> | null = null

function persist(state: SecondaryPanelsStore) {
  if (!state.hydrated) return
  const data: PersistedShape = {
    panels: state.panels,
    zCounter: state.zCounter,
  }
  void browser.storage.local.set({ [STORAGE_KEY]: data }).catch(() => {
    /* ignore */
  })
}
function persistDebounced(state: SecondaryPanelsStore) {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persist(state)
    persistTimer = null
  }, 200)
}
