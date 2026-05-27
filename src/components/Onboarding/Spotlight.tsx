import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../utils/cn'
import type { Placement } from './tourSteps'

/**
 * 通用 Spotlight 组件
 *
 * 职责：
 * 1. 跟踪 anchor 元素的位置（resize / scroll / DOM 变化时实时更新）
 * 2. 渲染遮罩（可选）+ 高亮框 + Tooltip 卡片
 * 3. 暴露 children 区，让上层（OnboardingTour / HintBubble）填充按钮等内容
 *
 * 不耦合任何业务状态，纯展示组件。
 */

interface Props {
  /** data-tour="xxx" 的 xxx；找不到时组件不渲染 */
  anchor: string
  placement: Placement
  /** 是否带半透明遮罩（L1 主 Tour 用 true；L1.5 hint 用 false） */
  withBackdrop?: boolean
  /** Tooltip 标题 */
  title: ReactNode
  /** Tooltip 正文 */
  body: ReactNode
  /** Tooltip 底部操作区（按钮） */
  children?: ReactNode
  /** 高亮框相对锚点的内 padding（单位 px，默认 6） */
  padding?: number
  /**
   * 锚点不存在时的回调；上层据此决定是「等待」还是「跳过」。
   * 不传则什么都不做（组件返回 null）。
   */
  onAnchorMissing?: () => void
}

/** Tooltip 与高亮框的间距 */
const TOOLTIP_GAP = 12
/** Tooltip 离视口边缘的最小距离 */
const VIEWPORT_PAD = 12
/** Tooltip 推荐宽度 */
const TOOLTIP_WIDTH = 300

export function Spotlight({
  anchor,
  placement,
  withBackdrop = true,
  title,
  body,
  children,
  padding = 6,
  onAnchorMissing,
}: Props) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  // tooltip 实际渲染后的高度；第一次为 null 时按估算值算（避免首帧空）
  const [tipHeight, setTipHeight] = useState<number | null>(null)
  // 进入动画门：mount 后下一帧切到 true，触发 CSS transition fade + scale
  const [visible, setVisible] = useState(false)
  const tooltipRef = useRef<HTMLDivElement | null>(null)

  // 跟踪 anchor 元素的位置；任何潜在的位移源（resize / scroll / DOM 变化）都触发更新
  useLayoutEffect(() => {
    const el = document.querySelector(
      `[data-tour="${anchor}"]`,
    ) as HTMLElement | null
    if (!el) {
      setRect(null)
      onAnchorMissing?.()
      return
    }

    const update = () => setRect(el.getBoundingClientRect())
    update()

    // ── 100ms throttle：避免 MutationObserver / 子元素 hover 切 className 触发雪崩 ──
    let throttleTimer: number | null = null
    const throttledUpdate = () => {
      if (throttleTimer != null) return
      throttleTimer = window.setTimeout(() => {
        update()
        throttleTimer = null
      }, 100)
    }

    // 元素自身尺寸变化（如 sidebar 折叠 / 展开）
    const ro = new ResizeObserver(update)
    ro.observe(el)
    // 文档整体变化也跟（如字号改变、抽屉展开影响 layout）
    if (document.documentElement) ro.observe(document.documentElement)

    // 滚动 / resize 都要重算（capture: true 才能监听内部容器的 scroll）
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)

    // 元素从 DOM 上消失 / 出现也要响应（如 sidebar 折叠时 toolbar 不可见）。
    // 之前监听整个 body + attributes:true 会被每次 hover 切 className 触发，
    // 现在只看 childList/subtree（结构变化），并 throttle 100ms 收敛雪崩。
    const mo = new MutationObserver(throttledUpdate)
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
    })

    return () => {
      ro.disconnect()
      mo.disconnect()
      if (throttleTimer != null) window.clearTimeout(throttleTimer)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [anchor, onAnchorMissing])

  // 进入动画：mount 后下一帧切 visible=true，让 CSS transition 生效
  useEffect(() => {
    if (!rect) return
    const id = window.requestAnimationFrame(() => setVisible(true))
    return () => window.cancelAnimationFrame(id)
  }, [rect])

  // 切换 anchor 时复位 enter 动画 + 重测高度
  useEffect(() => {
    setVisible(false)
    setTipHeight(null)
  }, [anchor])

  // 实测 tooltip 高度：每次锚点 / 内容变化后用 ResizeObserver 跟踪。
  // 首次为 null 时 computeArrow 用估算值 140 兜底（视觉差异 < 1px）。
  useLayoutEffect(() => {
    const el = tooltipRef.current
    if (!el) return
    setTipHeight(el.offsetHeight)
    const ro = new ResizeObserver(() => setTipHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [anchor, body, title])

  if (!rect || typeof document === 'undefined') return null

  // 高亮框位置（加 padding）
  const hiX = rect.left - padding
  const hiY = rect.top - padding
  const hiW = rect.width + padding * 2
  const hiH = rect.height + padding * 2

  // Tooltip 推荐位置（基于 placement）+ 视口边界保护
  const tip = computeTooltipPosition(
    { x: hiX, y: hiY, width: hiW, height: hiH },
    placement,
    TOOLTIP_WIDTH,
    tipHeight ?? 140,
  )

  // 算箭头：朝向 + 相对 tooltip 左上角的位置
  const arrow = computeArrow(
    { x: hiX, y: hiY, width: hiW, height: hiH },
    { left: tip.left, top: tip.top, width: TOOLTIP_WIDTH },
    tip.actualPlacement,
    tipHeight ?? 140,
  )

  return createPortal(
    <>
      {/* 半透明遮罩：用超大 box-shadow 反向制造挖洞效果，1 个 div 搞定 */}
      {withBackdrop && (
        <div
          aria-hidden
          className="fixed pointer-events-none transition-all duration-300 ease-out"
          style={{
            left: hiX,
            top: hiY,
            width: hiW,
            height: hiH,
            borderRadius: 14,
            zIndex: 10290,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.62)',
          }}
        />
      )}

      {/* 高亮边框 + brand 色光晕（不挡交互） */}
      <div
        aria-hidden
        className="fixed pointer-events-none transition-all duration-300 ease-out"
        style={{
          left: hiX,
          top: hiY,
          width: hiW,
          height: hiH,
          borderRadius: 14,
          zIndex: 10300,
          boxShadow:
            '0 0 0 2px rgba(99, 102, 241, 0.9), 0 0 0 6px rgba(99, 102, 241, 0.18), 0 12px 32px -8px rgba(99, 102, 241, 0.35)',
        }}
      />

      {/* Tooltip 卡片 */}
      <div
        ref={tooltipRef}
        role="dialog"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cn(
          'fixed transition-[opacity,transform] duration-200 ease-out',
          'rounded-xl shadow-2xl shadow-slate-900/20',
          'bg-white dark:bg-slate-800',
          'border border-slate-200/80 dark:border-slate-700',
          'text-slate-700 dark:text-slate-200',
          visible ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.96]',
        )}
        style={{
          left: tip.left,
          top: tip.top,
          width: TOOLTIP_WIDTH,
          maxWidth: 'calc(100vw - 24px)',
          zIndex: 10310,
          transformOrigin: getTransformOrigin(tip.actualPlacement),
        }}
      >
        {/* 指向锚点的小箭头：clip-path 画的真三角形，不是旋转方块。
            和 tooltip 共用同款 bg-white / dark:bg-slate-800 —— 视觉上像从卡片"长出来"。
            用 left/right/top/bottom 联合属性精确定位（绕开 border-box / padding-box
            起算点的陷阱），确保贴 tooltip 那条边正好覆盖 1px border，0 缝隙。 */}
        {arrow && (
          <div
            aria-hidden
            className="absolute bg-white dark:bg-slate-800 pointer-events-none"
            style={{
              left: arrow.left,
              top: arrow.top,
              right: arrow.right,
              bottom: arrow.bottom,
              width: arrow.width,
              height: arrow.height,
              clipPath: arrow.clipPath,
            }}
          />
        )}

        <div className="px-4 pt-3.5 pb-3 space-y-1">
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            {title}
          </div>
          <div className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {body}
          </div>
        </div>
        {children && (
          <div className="px-4 pb-3 pt-2 border-t border-slate-100 dark:border-slate-700/70">
            {children}
          </div>
        )}
      </div>
    </>,
    document.body,
  )
}

/**
 * 根据高亮框位置 + placement 计算 Tooltip 推荐位置。
 * 同时做视口边界保护，超出时朝相反方向自动翻转或贴边。
 *
 * 返回 actualPlacement：翻转后真正生效的方向，用于箭头朝向（避免箭头
 * 还指向原方向把用户晃到莫名其妙的地方）。
 */
function computeTooltipPosition(
  hi: { x: number; y: number; width: number; height: number },
  placement: Placement,
  tipWidth: number,
  tipHeight: number,
): { left: number; top: number; actualPlacement: Placement } {
  const vw = window.innerWidth
  const vh = window.innerHeight

  let left = 0
  let top = 0
  let actualPlacement: Placement = placement

  // ── 主方向 ──
  switch (placement) {
    case 'top':
      left = hi.x + hi.width / 2 - tipWidth / 2
      top = hi.y - tipHeight - TOOLTIP_GAP
      break
    case 'top-start':
      left = hi.x
      top = hi.y - tipHeight - TOOLTIP_GAP
      break
    case 'top-end':
      left = hi.x + hi.width - tipWidth
      top = hi.y - tipHeight - TOOLTIP_GAP
      break
    case 'bottom':
      left = hi.x + hi.width / 2 - tipWidth / 2
      top = hi.y + hi.height + TOOLTIP_GAP
      break
    case 'bottom-start':
      left = hi.x
      top = hi.y + hi.height + TOOLTIP_GAP
      break
    case 'bottom-end':
      left = hi.x + hi.width - tipWidth
      top = hi.y + hi.height + TOOLTIP_GAP
      break
    case 'left':
      left = hi.x - tipWidth - TOOLTIP_GAP
      top = hi.y + hi.height / 2 - tipHeight / 2
      break
    case 'right':
      left = hi.x + hi.width + TOOLTIP_GAP
      top = hi.y + hi.height / 2 - tipHeight / 2
      break
  }

  // ── 视口边界翻转 ──
  if (top < VIEWPORT_PAD && placement.startsWith('top')) {
    top = hi.y + hi.height + TOOLTIP_GAP
    actualPlacement = placement.replace('top', 'bottom') as Placement
  } else if (top + tipHeight > vh - VIEWPORT_PAD && placement.startsWith('bottom')) {
    top = hi.y - tipHeight - TOOLTIP_GAP
    actualPlacement = placement.replace('bottom', 'top') as Placement
  }
  if (left < VIEWPORT_PAD && placement === 'left') {
    left = hi.x + hi.width + TOOLTIP_GAP
    actualPlacement = 'right'
  } else if (
    left + tipWidth > vw - VIEWPORT_PAD &&
    placement === 'right'
  ) {
    left = hi.x - tipWidth - TOOLTIP_GAP
    actualPlacement = 'left'
  }

  // ── 兜底贴边（防止任何情况下 tooltip 出屏） ──
  left = Math.max(VIEWPORT_PAD, Math.min(left, vw - tipWidth - VIEWPORT_PAD))
  top = Math.max(VIEWPORT_PAD, Math.min(top, vh - tipHeight - VIEWPORT_PAD))

  return { left, top, actualPlacement }
}

/**
 * 计算指向锚点的小箭头的位置 + 形状。
 *
 * 用 clip-path 画的真三角形（而不是 rotate(45deg) 方块）—— 这样：
 *   1. 不会有 tooltip border 从菱形中线穿过去的视觉裂缝
 *   2. 不需要 stroke 也能看起来干净（贴 tooltip 的那条边天然融合）
 *
 * 关键设计：贴 tooltip 那一侧用 right/bottom 而非 left/top 计算，
 * 绕开 box-sizing:border-box 下「absolute 子元素 origin 在 padding-box」
 * 的陷阱 —— 用 right:-6 直接表达「凸出 tooltip 外 6px」，无歧义。
 *
 * 形态：
 *   - 长边 LONG = 14（沿 tooltip 边缘）
 *   - 短边 SHORT = 7（凸出 tooltip 外的高度 + 嵌入内 1px = 实际露出 6px）
 *   - 嵌入 tooltip 内 EMBED=1px 让箭头 bg 覆盖住 tooltip 的 1px border
 *
 * 位置：锚点中心在沿 tooltip 边长方向的投影，夹在 [SAFE, tipSize-SAFE]
 * 内避免跑到 tooltip 圆角弧线上。
 */
function computeArrow(
  hi: { x: number; y: number; width: number; height: number },
  tip: { left: number; top: number; width: number },
  placement: Placement,
  tipHeight: number,
): {
  left?: number
  top?: number
  right?: number
  bottom?: number
  width: number
  height: number
  clipPath: string
} | null {
  const LONG = 14
  const SHORT = 7
  // 圆角 rounded-xl ≈ 12px；SAFE = 12 + LONG/2 让箭头底边完整落在直边段
  const SAFE = 18
  const EMBED = 1
  const OUT = SHORT - EMBED // 实际凸出 tooltip 外的像素数 = 6

  const anchorCx = hi.x + hi.width / 2
  const anchorCy = hi.y + hi.height / 2

  if (placement.startsWith('top')) {
    // tooltip 在锚点上方 → 箭头在 tooltip 底边，尖端指下
    const xInTip = clamp(anchorCx - tip.left, SAFE, tip.width - SAFE) - LONG / 2
    return {
      left: xInTip,
      bottom: -OUT, // 用 bottom 直接表达「贴底边、凸出 OUT 像素」
      width: LONG,
      height: SHORT,
      clipPath: 'polygon(0 0, 100% 0, 50% 100%)', // 朝下的三角
    }
  }
  if (placement.startsWith('bottom')) {
    // tooltip 在锚点下方 → 箭头在 tooltip 顶边，尖端指上
    const xInTip = clamp(anchorCx - tip.left, SAFE, tip.width - SAFE) - LONG / 2
    return {
      left: xInTip,
      top: -OUT,
      width: LONG,
      height: SHORT,
      clipPath: 'polygon(0 100%, 100% 100%, 50% 0)', // 朝上的三角
    }
  }
  if (placement === 'left') {
    // tooltip 在锚点左侧 → 箭头在 tooltip 右边，尖端指右
    return {
      right: -OUT, // 用 right 直接表达「贴右边、凸出 OUT 像素」
      top: clamp(anchorCy - tip.top, SAFE, tipHeight - SAFE) - LONG / 2,
      width: SHORT,
      height: LONG,
      clipPath: 'polygon(0 0, 0 100%, 100% 50%)', // 朝右的三角
    }
  }
  if (placement === 'right') {
    // tooltip 在锚点右侧 → 箭头在 tooltip 左边，尖端指左
    return {
      left: -OUT,
      top: clamp(anchorCy - tip.top, SAFE, tipHeight - SAFE) - LONG / 2,
      width: SHORT,
      height: LONG,
      clipPath: 'polygon(100% 0, 100% 100%, 0 50%)', // 朝左的三角
    }
  }
  return null
}

/**
 * 计算 tooltip 进入动画的 transform-origin，让 scale 看起来像「从锚点方向长出来」。
 * 例如 placement = 'right'（tooltip 在锚点右侧）→ origin 在 tooltip 左中，
 * scale(0.96→1) 时视觉上是从左向右扩张，呼应"从锚点弹出"。
 */
function getTransformOrigin(placement: Placement): string {
  switch (placement) {
    case 'top':
    case 'top-start':
    case 'top-end':
      return 'center bottom'
    case 'bottom':
    case 'bottom-start':
    case 'bottom-end':
      return 'center top'
    case 'left':
      return 'right center'
    case 'right':
      return 'left center'
    default:
      return 'center'
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(v, max))
}

/** 提供给 ProgressiveHints 用的"自动消失"hook */
export function useAutoDismiss(enabled: boolean, ms: number, onDismiss: () => void) {
  useEffect(() => {
    if (!enabled) return
    const t = setTimeout(onDismiss, ms)
    return () => clearTimeout(t)
  }, [enabled, ms, onDismiss])
}
