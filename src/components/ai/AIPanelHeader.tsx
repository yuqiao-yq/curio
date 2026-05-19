import { cn } from '../../utils/cn'
import { useAIPanelStore } from '../../ai/panel/usePanelStore'
import { confirmDialog } from '../Dialog'

interface Props {
  /** 拖动区 onPointerDown，由父组件 useDraggable 提供 */
  onDragPointerDown: (e: React.PointerEvent) => void
}

/**
 * 浮窗头部：
 * - 整个 header 都是拖动区（pointerdown 触发 useDraggable）
 * - 双击 header 切换最大化
 * - 右键 header 弹菜单（V1.0 暂用 confirm，V2 升级为自定义菜单）
 * - 三个控制按钮：[─ 最小化] [⤢ 最大化] [× 关闭]
 */
export function AIPanelHeader({ onDragPointerDown }: Props) {
  const close = useAIPanelStore((s) => s.close)
  const toggleMinimize = useAIPanelStore((s) => s.toggleMinimize)
  const toggleMaximize = useAIPanelStore((s) => s.toggleMaximize)
  const resetPosition = useAIPanelStore((s) => s.resetPosition)
  const maximized = useAIPanelStore((s) => s.maximized)

  const onContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault()
    // 简化版：直接 confirm 询问；V2 替换为 CardMenu 风格自定义菜单
    if (await confirmDialog({ title: '恢复浮窗到默认位置和尺寸？' })) {
      resetPosition()
    }
  }

  return (
    <div
      onPointerDown={onDragPointerDown}
      onDoubleClick={() => toggleMaximize()}
      onContextMenu={onContextMenu}
      className={cn(
        'flex items-center gap-2 px-3 h-9 shrink-0',
        'border-b border-slate-200 dark:border-slate-700',
        'bg-slate-50/60 dark:bg-slate-800/60',
        'cursor-grab active:cursor-grabbing select-none',
        'rounded-t-lg',
      )}
      title="拖动移动；双击最大化；右键恢复默认位置"
    >
      {/* 拖动 grip 视觉标识 */}
      <span className="text-slate-400 text-xs leading-none" aria-hidden>
        ⠿
      </span>
      <span className="text-sm leading-none" aria-hidden>
        ✨
      </span>
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
        AI 助手
      </span>

      <div className="flex-1" />

      {/* 控制按钮组：阻止拖动事件冒泡（data-no-drag 让 useDraggable 忽略） */}
      <div className="flex items-center gap-0.5" data-no-drag>
        <HeaderButton
          onClick={toggleMinimize}
          title="最小化"
          aria-label="最小化"
        >
          {/* 一根横线 */}
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <line
              x1="2"
              y1="6"
              x2="10"
              y2="6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </HeaderButton>
        <HeaderButton
          onClick={toggleMaximize}
          title={maximized ? '还原' : '最大化'}
          aria-label={maximized ? '还原' : '最大化'}
        >
          {maximized ? (
            // 还原 icon：两个错开的小方块
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <rect x="3" y="1" width="8" height="8" stroke="currentColor" strokeWidth="1.4" fill="none" />
              <rect x="1" y="3" width="8" height="8" stroke="currentColor" strokeWidth="1.4" fill="white" className="dark:fill-slate-800" />
            </svg>
          ) : (
            // 最大化 icon：一个方框
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
              <rect x="2" y="2" width="8" height="8" stroke="currentColor" strokeWidth="1.6" fill="none" />
            </svg>
          )}
        </HeaderButton>
        <HeaderButton
          onClick={close}
          title="关闭"
          aria-label="关闭"
          variant="danger"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </HeaderButton>
      </div>
    </div>
  )
}

function HeaderButton({
  onClick,
  title,
  ariaLabel,
  children,
  variant,
}: {
  onClick: () => void
  title: string
  'aria-label'?: string
  ariaLabel?: string
  children: React.ReactNode
  variant?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      title={title}
      aria-label={ariaLabel ?? title}
      className={cn(
        'w-6 h-6 inline-flex items-center justify-center rounded',
        'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
        'hover:bg-slate-200/70 dark:hover:bg-slate-700/60 transition-colors',
        variant === 'danger' &&
          'hover:!text-red-500 hover:!bg-red-50 dark:hover:!bg-red-500/10',
      )}
    >
      {children}
    </button>
  )
}
