import { useState } from 'react'
import { cn } from '../../utils/cn'
import { InfoIconMini } from './icons'

/* ─────────────────────────────────────────────────────────────
 * 侧栏底部统计：默认只显示一行 i + 摘要，hover 后弹出详细面板。
 * 设计取舍：
 * - 普通用户不关心"含子分类的 20 个"这种数据；常驻显示是噪音
 * - 但仍有诊断价值（"为什么没看到子分类？"）；hover 兜底即可
 * - 弹层用 absolute 定位在按钮上方，避免被 sidebar 的 overflow 裁剪
 * ───────────────────────────────────────────────────────────── */

interface Props {
  categoryCount: number
  topLevelCount: number
  cardCount: number
  parentCount: number
  hasAnyChildren: boolean
}

export function SidebarStatsHint({
  categoryCount,
  topLevelCount,
  cardCount,
  parentCount,
  hasAnyChildren,
}: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2 px-2 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className={cn(
          'w-full flex items-center justify-between gap-2',
          'text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300',
          'transition-colors',
        )}
        title="点击或悬停查看详细统计"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-1.5">
          <InfoIconMini />
          <span className="tabular-nums">
            {categoryCount} 分类 · {cardCount} 书签
          </span>
        </span>
        <span className="text-[10px] opacity-50">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className={cn(
            'absolute left-2 right-2 bottom-full mb-1 z-30 p-2.5 rounded-md',
            'bg-white dark:bg-slate-800',
            'border border-slate-200 dark:border-slate-700 shadow-lg',
            'text-[11px] leading-relaxed text-slate-500 dark:text-slate-300',
          )}
        >
          <div className="flex items-center justify-between">
            <span>分类总数</span>
            <span className="tabular-nums text-slate-700 dark:text-slate-100">
              {categoryCount}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>顶层分类</span>
            <span className="tabular-nums text-slate-700 dark:text-slate-100">
              {topLevelCount}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>含子分类的</span>
            <span
              className={cn(
                'tabular-nums',
                hasAnyChildren
                  ? 'text-brand font-medium'
                  : 'text-slate-700 dark:text-slate-100',
              )}
            >
              {parentCount}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>书签总数</span>
            <span className="tabular-nums text-slate-700 dark:text-slate-100">
              {cardCount}
            </span>
          </div>
          {!hasAnyChildren && (
            <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/60 text-slate-400 leading-snug">
              没有子分类时，鼠标 hover 到分类右侧的{' '}
              <span className="font-bold">+</span> 可新建子分类。
            </div>
          )}
        </div>
      )}
    </div>
  )
}
