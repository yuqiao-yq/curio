import { useEffect } from 'react'
import { cn } from '../../utils/cn'

/**
 * 通用居中 Dialog 外壳：
 * - 点击遮罩 / ESC 关闭
 * - max-h 自适应屏幕；flex 让 head/footer 固定、body 滚动
 * - footer 可自定义，未提供时给一个默认「关闭」按钮
 */
export function DialogShell({
  title,
  width = 460,
  onClose,
  children,
  footer,
}: {
  title: React.ReactNode
  width?: number
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width }}
        className={cn(
          // v0.21.16：max-h 用 vh 自适应屏幕；flex 让 head/footer 固定、body 滚动
          'max-w-[92vw] max-h-[calc(100vh-2rem)] flex flex-col rounded-lg shadow-2xl',
          'bg-white dark:bg-slate-800',
          'border border-slate-200 dark:border-slate-700',
        )}
      >
        {/* 头（高度固定） */}
        <div className="px-5 py-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-700 shrink-0">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'w-7 h-7 flex items-center justify-center rounded text-sm',
              'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
              'hover:bg-slate-100 dark:hover:bg-slate-700/60',
            )}
            title="关闭"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        {/* 体（撑满剩余 + 内部滚动；min-h-0 是 flex 子节点正确滚动的必要条件） */}
        <div className="px-5 py-4 flex-1 min-h-0 overflow-y-auto">
          {children}
        </div>
        {/* 底（高度固定） */}
        <div className="px-5 py-3 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-700 shrink-0">
          {footer ?? (
            <button
              type="button"
              onClick={onClose}
              className={cn(
                'px-3 py-1.5 text-sm rounded transition-colors',
                'text-slate-600 dark:text-slate-300',
                'hover:bg-slate-100 dark:hover:bg-slate-700/60',
              )}
            >
              关闭
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
