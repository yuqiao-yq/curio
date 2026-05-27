import { create } from 'zustand'
import { browser } from 'wxt/browser'
import { useAIPanelStore } from '../../ai/panel/usePanelStore'

/**
 * 首次进入引导（v0.22.x 引入）
 *
 * 三层叠加方案：
 *   L1   主 Tour：首次进入跑 5 步 Spotlight（侧栏 → 搜索 → 设置 → 帮助 → ✨ FAB）
 *   L1.5 渐进式提示：用户首次创建分类 / 首次有卡片时，单独 mini-spotlight 教操作
 *   L2   常驻 Checklist（后续迭代）
 *
 * 持久化字段（chrome.storage.local，单 key）：
 *   - mainTourDone        L1 是否走完（含跳过）
 *   - categoryHintDone    L1.5-b「双击改名」是否提示过
 *   - cardMenuHintDone    L1.5-a「卡片右键菜单」是否提示过
 *
 * 设计取舍：
 * - L1.5 hint 一旦标记 done 永不重置 —— 老用户清空后又加新书签也不会再被打扰
 * - 「批量导入」场景（cards 一次跳 ≥2）由 ProgressiveHints 内部判定为
 *   silentDone：标记 done 但不弹提示，避免对刚导入一堆书签的用户骚扰
 * - 主 Tour 运行态（tourActive / tourStepIndex）不持久化 —— 用户中途刷新就当跳过
 */

const STORAGE_KEY = 'curio:onboarding:v1'

interface OnboardingPersisted {
  mainTourDone: boolean
  categoryHintDone: boolean
  cardMenuHintDone: boolean
}

export interface OnboardingState extends OnboardingPersisted {
  /** 内部标志：init() 完成前不要触发 L1 启动检查 */
  hydrated: boolean
  /** 主 Tour 是否正在进行 */
  tourActive: boolean
  /** 当前 Tour 步骤索引（0-based） */
  tourStepIndex: number

  init: () => Promise<void>
  startMainTour: () => void
  nextStep: () => void
  prevStep: () => void
  /** 走到最后一步点完成 / 中途跳过 / ESC 都走这里 */
  finishMainTour: () => void
  markCategoryHintDone: () => void
  markCardMenuHintDone: () => void
  /** 调试 / 「重新引导」用 */
  resetAll: () => Promise<void>
}

const DEFAULT_STATE: OnboardingPersisted = {
  mainTourDone: false,
  categoryHintDone: false,
  cardMenuHintDone: false,
}

async function persist(snapshot: OnboardingPersisted): Promise<void> {
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: snapshot })
  } catch {
    /* storage 失败不阻塞引导本身 */
  }
}

function snapshotOf(s: OnboardingState): OnboardingPersisted {
  return {
    mainTourDone: s.mainTourDone,
    categoryHintDone: s.categoryHintDone,
    cardMenuHintDone: s.cardMenuHintDone,
  }
}

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  ...DEFAULT_STATE,
  hydrated: false,
  tourActive: false,
  tourStepIndex: 0,

  async init() {
    try {
      const result = await browser.storage.local.get(STORAGE_KEY)
      const raw = result[STORAGE_KEY] as OnboardingPersisted | undefined
      if (raw) {
        set({
          mainTourDone: !!raw.mainTourDone,
          categoryHintDone: !!raw.categoryHintDone,
          cardMenuHintDone: !!raw.cardMenuHintDone,
          hydrated: true,
        })
      } else {
        set({ hydrated: true })
      }
    } catch {
      set({ hydrated: true })
    }
  },

  startMainTour() {
    // 防御：已完成 / 已在进行中都不重启
    if (get().mainTourDone || get().tourActive) return
    // 启动前关掉 AI 浮窗：浮窗 visible=true 时 AIFAB 返回 null，
    // 第 5 步会找不到 [data-tour="ai-fab"] 锚点 → 整个 Tour 卡住。
    // 这里强制 close 一次（已经关着也无副作用）。
    const panelState = useAIPanelStore.getState()
    if (panelState.visible) panelState.close()
    set({ tourActive: true, tourStepIndex: 0 })
  },

  nextStep() {
    set((s) => ({ tourStepIndex: s.tourStepIndex + 1 }))
  },

  prevStep() {
    set((s) => ({ tourStepIndex: Math.max(0, s.tourStepIndex - 1) }))
  },

  finishMainTour() {
    set({ tourActive: false, tourStepIndex: 0, mainTourDone: true })
    void persist(snapshotOf(get()))
  },

  markCategoryHintDone() {
    if (get().categoryHintDone) return
    set({ categoryHintDone: true })
    void persist(snapshotOf(get()))
  },

  markCardMenuHintDone() {
    if (get().cardMenuHintDone) return
    set({ cardMenuHintDone: true })
    void persist(snapshotOf(get()))
  },

  async resetAll() {
    set({
      ...DEFAULT_STATE,
      tourActive: false,
      tourStepIndex: 0,
    })
    try {
      await browser.storage.local.remove(STORAGE_KEY)
    } catch {
      /* ignore */
    }
  },
}))
