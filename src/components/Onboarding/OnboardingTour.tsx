import { useEffect, useMemo, useRef } from 'react'
import { useBookmarkStore } from '../../stores/useBookmarkStore'
import { toast } from '../../stores/useToastStore'
import { cn } from '../../utils/cn'
import { Spotlight } from './Spotlight'
import { TOUR_STEPS, resolveStep } from './tourSteps'
import { useOnboardingStore } from './useOnboardingStore'

/**
 * L1 主 Tour 编排
 *
 * 职责：
 * - 从 useOnboardingStore 读取 tourActive / tourStepIndex
 * - 从 useBookmarkStore 拿到当前 categoriesCount，喂给 resolveStep
 * - 渲染 Spotlight + 操作按钮（上一步 / 下一步 / 跳过 / 完成）
 * - 监听 ESC / ← / → 键盘控制
 * - tooltip 出现时自动把焦点放到「下一步」按钮（a11y + 加速键盘流）
 * - 走到末步点完成时弹 toast 收尾，给用户 closure 感
 *
 * 不负责：何时启动 Tour（由 App.tsx 在首次进入时调用 startMainTour）。
 */
export function OnboardingTour() {
  const tourActive = useOnboardingStore((s) => s.tourActive)
  const stepIndex = useOnboardingStore((s) => s.tourStepIndex)
  const nextStep = useOnboardingStore((s) => s.nextStep)
  const prevStep = useOnboardingStore((s) => s.prevStep)
  const finish = useOnboardingStore((s) => s.finishMainTour)

  const categoriesCount = useBookmarkStore((s) => s.categories.length)

  const nextBtnRef = useRef<HTMLButtonElement | null>(null)

  // 安全索引（防止越界）
  const safeIndex = Math.min(stepIndex, TOUR_STEPS.length - 1)
  const step = TOUR_STEPS[safeIndex]
  const resolved = useMemo(
    () => (step ? resolveStep(step, { categoriesCount }) : null),
    [step, categoriesCount],
  )
  const isFirst = safeIndex === 0
  const isLast = safeIndex >= TOUR_STEPS.length - 1

  // 「跳过」与「完成」的区别：
  // - skipTour：用户中途退出，不发 toast（避免打扰）
  // - finishCompleted：用户走到最后一步点完成，发 toast 庆祝 + 提示重看入口
  const skipTour = () => finish()
  const finishCompleted = () => {
    finish()
    toast.success(
      '引导完成 ✨',
      '随时可在右上「设置 → 重新引导」再走一遍',
    )
  }

  // ESC 退出 + ← / → 翻页
  useEffect(() => {
    if (!tourActive) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        skipTour()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (isLast) finishCompleted()
        else nextStep()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prevStep()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // 依赖 isLast 而非 stepIndex —— 让 ArrowRight 在末步时正确触发完成
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourActive, isLast])

  // tooltip 出现 / 切换 step 后，自动把焦点放到「下一步」按钮
  // - 提升 a11y：键盘用户不用 Tab 多次
  // - 加速键盘流：连续按 Enter 也能走完 Tour
  useEffect(() => {
    if (!tourActive) return
    // 等 Spotlight 的 enter 动画就绪（rAF + 一帧）
    const id = window.requestAnimationFrame(() => {
      nextBtnRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(id)
  }, [tourActive, safeIndex])

  if (!tourActive || !resolved) return null

  return (
    <Spotlight
      anchor={resolved.anchor}
      placement={resolved.placement}
      withBackdrop
      title={
        <span className="flex items-center justify-between gap-3">
          <span>{resolved.title}</span>
          {/* dot bar 进度：当前步骤拉成长条 + brand 色；已完成淡色；未完成灰 */}
          <span className="flex items-center gap-1" aria-label={`第 ${safeIndex + 1} 步，共 ${TOUR_STEPS.length} 步`}>
            {TOUR_STEPS.map((_, i) => (
              <span
                key={i}
                aria-hidden
                className={cn(
                  'h-1 rounded-full transition-all duration-300',
                  i === safeIndex
                    ? 'w-4 bg-brand'
                    : i < safeIndex
                      ? 'w-1.5 bg-brand/40'
                      : 'w-1.5 bg-slate-200 dark:bg-slate-700',
                )}
              />
            ))}
          </span>
        </span>
      }
      body={resolved.body}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={skipTour}
          className={cn(
            'text-xs px-2 py-1 rounded',
            'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
            'transition-colors',
          )}
        >
          跳过引导
        </button>
        <div className="flex items-center gap-1.5">
          {!isFirst && (
            <button
              type="button"
              onClick={prevStep}
              className={cn(
                'text-xs px-2.5 py-1 rounded',
                'text-slate-600 dark:text-slate-300',
                'hover:bg-slate-100 dark:hover:bg-slate-700/60',
                'transition-colors',
              )}
            >
              上一步
            </button>
          )}
          <button
            ref={nextBtnRef}
            type="button"
            onClick={() => (isLast ? finishCompleted() : nextStep())}
            className={cn(
              'text-xs font-semibold px-3 py-1 rounded',
              'bg-brand text-white hover:bg-brand-600',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
              'transition-colors',
            )}
          >
            {isLast ? '完成 ✓' : '下一步 →'}
          </button>
        </div>
      </div>
    </Spotlight>
  )
}
