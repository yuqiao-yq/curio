/**
 * 首次进入引导 - 装配入口
 *
 * - OnboardingTour     L1 主 Tour（5 步 Spotlight）
 * - ProgressiveHints   L1.5 渐进式提示（分类 / 卡片首次出现时）
 *
 * App.tsx 只需要：
 *   1. 启动时调 useOnboardingStore.init()
 *   2. 初始化后 + 未引导过时调 startMainTour()
 *   3. 渲染 <Onboarding />
 */

import { OnboardingTour } from './OnboardingTour'
import { ProgressiveHints } from './ProgressiveHints'

export { useOnboardingStore } from './useOnboardingStore'

export function Onboarding() {
  return (
    <>
      <OnboardingTour />
      <ProgressiveHints />
    </>
  )
}
