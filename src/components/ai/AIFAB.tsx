import { createPortal } from 'react-dom'
import { useAIPanelStore } from '../../ai/panel/usePanelStore'
import { useIsAIConfigured } from '../../ai/useAISettingsStore'
import { FAB_OFFSET, FAB_SIZE } from '../../ai/types'
import { cn } from '../../utils/cn'

interface Props {
  /**
   * 是否处于 AI 思考中（呼吸光晕）。
   * V1.0 阶段固定 false；具体 AI 任务执行时由 service 层置位。
   */
  thinking?: boolean
  /**
   * 是否有未读的被动建议（V1.5 §5.2）。
   */
  hasNew?: boolean
  /**
   * 当处于"被动建议"态时点击 FAB 的拦截回调（§5.2）。
   * 提供后会替代默认 onClick，让外层决定打开哪个 tab、是否同步消除红点。
   */
  onSuggestClick?: () => void
}

/**
 * 右下角 ✨ 悬浮按钮（FAB）。
 *
 * 4 种状态：
 * - 未配置：灰色 + 点击 → 浮窗自动落到「⚙ 设置」tab，引导配置
 * - 已配置：brand 色 + 点击 → 打开浮窗（恢复上次状态）
 * - 思考中：呼吸光晕动画
 * - 有新建议：右上小红点
 *
 * 浮窗展开 / 最小化时，FAB 隐藏（避免双入口）。
 */
export function AIFAB({
  thinking = false,
  hasNew = false,
  onSuggestClick,
}: Props) {
  const visible = useAIPanelStore((s) => s.visible)
  const open = useAIPanelStore((s) => s.open)
  // 实时联动 AI 设置：providers 增加 / 启用切换都会自动反映到 FAB 颜色
  const configured = useIsAIConfigured()

  // 浮窗已打开（包括最小化）时不显示 FAB
  if (visible) return null
  if (typeof document === 'undefined') return null

  return createPortal(
    <button
      type="button"
      data-tour="ai-fab"
      onClick={() => {
        // 优先级：被动建议 > 未配置引导 > 默认打开
        if (hasNew && onSuggestClick) {
          onSuggestClick()
          return
        }
        if (!configured) open('settings')
        else open()
      }}
      title={
        hasNew
          ? '检测到新书签未整理，点击让 AI 帮你'
          : configured
            ? 'AI 助手 (Cmd/Ctrl+J)'
            : '点击配置 AI 助手'
      }
      aria-label="AI 助手"
      style={{
        width: FAB_SIZE,
        height: FAB_SIZE,
        right: FAB_OFFSET.right,
        bottom: FAB_OFFSET.bottom,
      }}
      className={cn(
        'fixed z-[10080] inline-flex items-center justify-center rounded-full',
        'transition-all duration-200',
        'shadow-md shadow-brand/15 ring-1 ring-white/40 dark:ring-white/10',
        'backdrop-blur-md',
        configured
          ? cn(
              'bg-white/70 text-brand dark:bg-slate-800/60',
              'hover:bg-white/85 dark:hover:bg-slate-800/75 hover:scale-105',
            )
          : cn(
              'bg-white/50 text-slate-400 dark:bg-slate-800/40 dark:text-slate-500',
              'hover:bg-white/65 dark:hover:bg-slate-800/55',
            ),
        thinking && 'animate-pulse',
      )}
    >
      {/* ✨ 主图标 */}
      <span className="text-2xl leading-none" aria-hidden>
        ✨
      </span>

      {/* 红点：有未读被动建议 */}
      {hasNew && (
        <span
          className={cn(
            'absolute top-1 right-1 w-2.5 h-2.5 rounded-full',
            'bg-red-500 border-2 border-white dark:border-slate-900',
          )}
          aria-hidden
        />
      )}

      {/* 思考中的光晕（叠加一层放大渐隐的圆，营造"呼吸"感） */}
      {thinking && (
        <span
          className={cn(
            'absolute inset-0 rounded-full pointer-events-none',
            'bg-brand/30 animate-ping',
          )}
          aria-hidden
        />
      )}
    </button>,
    document.body,
  )
}
