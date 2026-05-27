import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { browser } from 'wxt/browser'
import {
  PANEL_DEFAULT_SIZE,
  PANEL_MAX_HEIGHT_RATIO,
  PANEL_MAX_WIDTH,
  PANEL_MIN_SIZE,
  PANEL_VIEWPORT_PAD,
  defaultPanelPosition,
  type AIPanelTab,
  type AITabType,
  type PanelPosition,
  type PanelSize,
} from '../types'

/**
 * AI 浮窗状态管理
 *
 * 设计要点：
 * - 浮窗位置 / 尺寸 / 当前 tab / 所有 tabs 的快照 都持久化到 chrome.storage.local
 * - 仅在 store 真正变化时（debounce 200ms）才写库，避免拖动时高频 IO
 * - 失焦不关闭，仅 close() 显式调用才销毁；最小化只是视觉状态切换
 * - z-index 由组件层管理（V1 单浮窗够用，V3 多浮窗时这里要扩展）
 */

const STORAGE_KEY = 'curio:ai-panel'

interface PanelPersisted {
  visible: boolean
  minimized: boolean
  maximized: boolean
  position?: PanelPosition
  size?: PanelSize
  activeTabId: string | null
  tabs: AIPanelTab[]
}

export interface AIPanelState extends PanelPersisted {
  /** 内部标志：首次 init 完成前不要触发持久化（避免覆盖 storage） */
  hydrated: boolean

  // ─── 生命周期 ───────────────────────────────────────
  /** 从 chrome.storage.local 恢复状态（App 启动时调用一次） */
  init: () => Promise<void>

  // ─── 浮窗显隐 ───────────────────────────────────────
  /** 打开浮窗；可指定要落到哪个 tab type（不存在则新建一个该类型的 tab） */
  open: (focus?: AITabType) => void
  close: () => void
  toggleMinimize: () => void
  toggleMaximize: () => void
  /** 快捷键 Cmd+J 行为：根据当前状态智能切换 */
  toggle: () => void

  // ─── 几何 ─────────────────────────────────────────
  setPosition: (p: PanelPosition) => void
  setSize: (s: PanelSize) => void
  resetPosition: () => void
  /** 视口变化后兜底：超出视口则吸附进来 */
  clampToViewport: () => void

  // ─── Tab 管理 ──────────────────────────────────────
  /** 新建一个 tab；返回新 tab id */
  addTab: (type: AITabType, title?: string) => string
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  /** 更新某 tab 的 title 或 state */
  patchTab: (id: string, patch: Partial<Pick<AIPanelTab, 'title' | 'state'>>) => void
}

const DEFAULT_STATE: PanelPersisted = {
  visible: false,
  minimized: false,
  maximized: false,
  activeTabId: null,
  tabs: [],
}

export const useAIPanelStore = create<AIPanelState>((set, get) => ({
  ...DEFAULT_STATE,
  hydrated: false,

  async init() {
    try {
      const result = await browser.storage.local.get(STORAGE_KEY)
      const raw = result[STORAGE_KEY] as PanelPersisted | undefined
      if (raw) {
        // 防御：保留兼容字段，过滤异常的位置 / 尺寸
        const safe: PanelPersisted = {
          visible: !!raw.visible,
          minimized: !!raw.minimized,
          maximized: !!raw.maximized,
          position: raw.position && Number.isFinite(raw.position.x)
            ? raw.position
            : undefined,
          size: raw.size && Number.isFinite(raw.size.width)
            ? clampSize(raw.size)
            : undefined,
          activeTabId: raw.activeTabId ?? null,
          tabs: Array.isArray(raw.tabs) ? raw.tabs : [],
        }
        set({ ...safe, hydrated: true })
        // 恢复后立即 clamp 一次（视口可能变了）
        get().clampToViewport()
      } else {
        set({ hydrated: true })
      }
    } catch {
      set({ hydrated: true })
    }
  },

  open(focus) {
    const state = get()
    let activeTabId = state.activeTabId
    let tabs = state.tabs

    if (focus) {
      // 若已有该 type 的 tab，定位到第一个；否则新建
      const exist = state.tabs.find((t) => t.type === focus)
      if (exist) {
        activeTabId = exist.id
      } else {
        const newTab = makeTab(focus)
        tabs = [...state.tabs, newTab]
        activeTabId = newTab.id
      }
    } else if (state.tabs.length === 0) {
      // 首次打开默认放一个 settings tab（引导用户配置）
      const newTab = makeTab('settings')
      tabs = [newTab]
      activeTabId = newTab.id
    }

    set({
      visible: true,
      minimized: false,
      activeTabId,
      tabs,
    })
    persist(get())
  },

  close() {
    set({ visible: false, minimized: false, maximized: false })
    persist(get())
  },

  toggleMinimize() {
    set((s) => ({ minimized: !s.minimized, maximized: false }))
    persist(get())
  },

  toggleMaximize() {
    set((s) => ({ maximized: !s.maximized, minimized: false }))
    persist(get())
  },

  toggle() {
    const s = get()
    if (!s.visible) {
      get().open()
      return
    }
    if (s.minimized) {
      // 已存在但被最小化 → 恢复
      set({ minimized: false })
      persist(get())
      return
    }
    // 已展开 → 关闭
    get().close()
  },

  setPosition(p) {
    set({ position: p })
    persistDebounced(get())
  },

  setSize(s) {
    set({ size: clampSize(s) })
    persistDebounced(get())
  },

  resetPosition() {
    if (typeof window === 'undefined') return
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    set({
      position: defaultPanelPosition(viewport),
      size: PANEL_DEFAULT_SIZE,
    })
    persist(get())
  },

  clampToViewport() {
    if (typeof window === 'undefined') return
    const s = get()
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const size = s.size ?? PANEL_DEFAULT_SIZE
    const pos = s.position ?? defaultPanelPosition(viewport)

    const clampedPos = clampPosition(pos, size, viewport)
    if (clampedPos.x !== pos.x || clampedPos.y !== pos.y) {
      set({ position: clampedPos })
      persist(get())
    }
  },

  addTab(type, title) {
    const newTab = makeTab(type, title)
    set((s) => ({
      tabs: [...s.tabs, newTab],
      activeTabId: newTab.id,
      visible: true,
      minimized: false,
    }))
    persist(get())
    return newTab.id
  },

  closeTab(id) {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id)
      let activeTabId = s.activeTabId
      if (s.activeTabId === id) {
        // 关闭当前 tab → 选下一个（或上一个）
        const idx = s.tabs.findIndex((t) => t.id === id)
        const next = tabs[idx] ?? tabs[idx - 1] ?? tabs[0] ?? null
        activeTabId = next?.id ?? null
      }
      return { tabs, activeTabId }
    })
    persist(get())
  },

  setActiveTab(id) {
    set({ activeTabId: id })
    persist(get())
  },

  patchTab(id, patch) {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }))
    persistDebounced(get())
  },
}))

// ─── 工具 ─────────────────────────────────────────────

function makeTab(type: AITabType, title?: string): AIPanelTab {
  const defaultTitle: Record<AITabType, string> = {
    chat: '对话',
    organize: '整理',
    labels: '标签',
    settings: '设置',
  }
  return {
    id: uuid(),
    type,
    title: title ?? defaultTitle[type],
    createdAt: Date.now(),
  }
}

function clampSize(s: PanelSize): PanelSize {
  const maxHeight =
    typeof window !== 'undefined'
      ? Math.floor(window.innerHeight * PANEL_MAX_HEIGHT_RATIO)
      : 800
  return {
    width: Math.max(PANEL_MIN_SIZE.width, Math.min(PANEL_MAX_WIDTH, s.width)),
    height: Math.max(PANEL_MIN_SIZE.height, Math.min(maxHeight, s.height)),
  }
}

function clampPosition(
  p: PanelPosition,
  size: PanelSize,
  viewport: { width: number; height: number },
): PanelPosition {
  // 至少有 PANEL_VIEWPORT_PAD 像素留在视口里（确保 header 可拖回）
  const minX = PANEL_VIEWPORT_PAD - size.width
  const maxX = viewport.width - PANEL_VIEWPORT_PAD
  const minY = 0
  const maxY = viewport.height - PANEL_VIEWPORT_PAD
  return {
    x: Math.max(minX, Math.min(maxX, p.x)),
    y: Math.max(minY, Math.min(maxY, p.y)),
  }
}

// ─── 持久化（debounce 200ms） ────────────────────────

let persistTimer: ReturnType<typeof setTimeout> | null = null

function persist(state: AIPanelState) {
  if (!state.hydrated) return
  const data: PanelPersisted = {
    visible: state.visible,
    minimized: state.minimized,
    maximized: state.maximized,
    position: state.position,
    size: state.size,
    activeTabId: state.activeTabId,
    tabs: state.tabs,
  }
  void browser.storage.local.set({ [STORAGE_KEY]: data }).catch(() => {
    /* storage 异常不影响内存状态 */
  })
}

function persistDebounced(state: AIPanelState) {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persist(state)
    persistTimer = null
  }, 200)
}
