import { useCallback, useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { useBookmarkStore } from '../../stores/useBookmarkStore'
import { useAISettingsStore, useIsAIConfigured } from '../useAISettingsStore'

/**
 * 被动整理建议（V1.5 §5.2）
 *
 * 触发条件：
 * - settings.passiveSuggest=true
 * - AI 已就绪（isAIConfigured）
 * - 当前 cards 数量 - baselineCount ≥ NEW_THRESHOLD
 * - 距上次提示（lastNoticedAt）≥ COOLDOWN_MS
 *
 * 持久化：用 chrome.storage.local 单独存一个 baseline 记录，跨刷新保留。
 *
 * 设计取舍：
 * - 不做"AI 主题聚类"自动话术（如「检测到 12 个 React 相关书签」），
 *   那需要先跑 embedding + 聚类，复杂度过高且会主动消费 token；
 *   先以"N 条新书签未整理"作为通用文案，让用户主动决策
 * - dismiss 把 baseline 推到当前数量 + lastNoticedAt = 现在，自然进入 7 天冷静期
 * - 用户在设置里关闭 passiveSuggest 后立即生效（hook 返回 shouldShow=false）
 */

const STORAGE_KEY = 'tabit:passive-baseline'
const NEW_THRESHOLD = 10
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

interface PassiveBaseline {
  baselineCount: number
  lastNoticedAt: number
}

async function loadBaseline(): Promise<PassiveBaseline | null> {
  try {
    const result = await browser.storage.local.get(STORAGE_KEY)
    const raw = result[STORAGE_KEY] as PassiveBaseline | undefined
    if (
      raw &&
      typeof raw.baselineCount === 'number' &&
      typeof raw.lastNoticedAt === 'number'
    ) {
      return raw
    }
  } catch {
    /* ignore */
  }
  return null
}

async function saveBaseline(b: PassiveBaseline): Promise<void> {
  try {
    await browser.storage.local.set({ [STORAGE_KEY]: b })
  } catch {
    /* storage 异常不影响内存 */
  }
}

export interface PassiveSuggestState {
  /** 是否应在 FAB / 浮窗顶部显示提示 */
  shouldShow: boolean
  /** 累计新增书签数（仅 shouldShow=true 时有意义） */
  newCount: number
  /** 用户在设置里是否启用了被动建议 */
  enabled: boolean
  /** 关闭红点 / 推迟下次提示（重置 baseline 到当前数量 + 时间戳到现在） */
  dismiss: () => Promise<void>
}

export function usePassiveSuggest(): PassiveSuggestState {
  const cards = useBookmarkStore((s) => s.cards)
  const passiveSuggest = useAISettingsStore((s) => s.passiveSuggest)
  const configured = useIsAIConfigured()
  const enabled = passiveSuggest && configured

  const [baseline, setBaseline] = useState<PassiveBaseline | null>(null)
  const [hydrated, setHydrated] = useState(false)

  // 拉一次 baseline；首次没有时立刻初始化为「当前数量 / 现在」
  // 避免老用户刚装就被弹一堆"未整理"提示
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const b = await loadBaseline()
      if (cancelled) return
      if (b) {
        setBaseline(b)
      } else {
        const init: PassiveBaseline = {
          baselineCount: cards.length,
          lastNoticedAt: Date.now(),
        }
        await saveBaseline(init)
        if (!cancelled) setBaseline(init)
      }
      if (!cancelled) setHydrated(true)
    })()
    return () => {
      cancelled = true
    }
    // 仅 mount 时拉一次；后续 baseline 变化通过 dismiss 更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const dismiss = useCallback(async () => {
    const next: PassiveBaseline = {
      baselineCount: cards.length,
      lastNoticedAt: Date.now(),
    }
    await saveBaseline(next)
    setBaseline(next)
  }, [cards.length])

  let shouldShow = false
  let newCount = 0
  if (enabled && hydrated && baseline) {
    newCount = Math.max(0, cards.length - baseline.baselineCount)
    const cooledDown = Date.now() - baseline.lastNoticedAt >= COOLDOWN_MS
    shouldShow = newCount >= NEW_THRESHOLD && cooledDown
  }

  return { shouldShow, newCount, enabled, dismiss }
}
