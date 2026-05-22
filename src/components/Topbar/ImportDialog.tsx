import type { ExportData } from '../../types/bookmark'
import type { BulkImportMode } from '../../repositories/types'
import { cn } from '../../utils/cn'

export interface PendingImport {
  data: ExportData
  catCount: number
  cardCount: number
  fileName: string
}

/**
 * 导入确认弹层：
 * - 顶部显示文件名 + 分类/书签数量
 * - 单选「合并」/「替换」模式（默认推荐合并）
 * - 「替换」按钮配红色配色 + 二次提醒；导入中按钮禁用
 *
 * 没有用 DialogShell 因为头部带文件名副标题，需要独立的两行结构。
 */
export function ImportDialog({
  pending,
  mode,
  importing,
  onChangeMode,
  onCancel,
  onConfirm,
}: {
  pending: PendingImport
  mode: BulkImportMode
  importing: boolean
  onChangeMode: (m: BulkImportMode) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          // v0.21.16：max-h 自适应屏幕 + 内部滚动
          'w-[420px] max-w-[90vw] max-h-[calc(100vh-2rem)] flex flex-col rounded-lg shadow-2xl',
          'bg-white dark:bg-slate-800',
          'border border-slate-200 dark:border-slate-700',
        )}
      >
        {/* 头（固定） */}
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            导入书签数据
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            来源：{pending.fileName}
          </p>
        </div>

        {/* 体（可滚动） */}
        <div className="px-5 py-4 space-y-3 flex-1 min-h-0 overflow-y-auto">
          <div className="text-sm text-slate-600 dark:text-slate-300">
            检测到{' '}
            <span className="font-medium text-brand">{pending.catCount}</span>{' '}
            个分类、
            <span className="font-medium text-brand">
              {' '}
              {pending.cardCount}
            </span>{' '}
            个书签。
          </div>

          {/* 模式选择 */}
          <div className="space-y-2">
            <ModeOption
              checked={mode === 'merge'}
              onSelect={() => onChangeMode('merge')}
              title="合并到现有数据"
              badge="推荐"
              desc="保留本地分类与书签，按 ID 合并。同 ID 取较新者，新数据追加到末尾。"
            />
            <ModeOption
              checked={mode === 'replace'}
              onSelect={() => onChangeMode('replace')}
              title="替换全部数据"
              badge="慎用"
              badgeDanger
              desc="清空本地所有分类与书签，并使用文件中的设置覆盖当前主题/布局。"
            />
          </div>
        </div>

        {/* 底（固定） */}
        <div className="px-5 py-3 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-700 shrink-0">
          <button
            type="button"
            disabled={importing}
            onClick={onCancel}
            className={cn(
              'px-3 py-1.5 text-sm rounded transition-colors',
              'text-slate-600 dark:text-slate-300',
              'hover:bg-slate-100 dark:hover:bg-slate-700/60',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            取消
          </button>
          <button
            type="button"
            disabled={importing}
            onClick={onConfirm}
            className={cn(
              'px-3.5 py-1.5 text-sm rounded font-medium transition-colors',
              mode === 'replace'
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-brand text-white hover:bg-brand-600',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {importing
              ? '导入中…'
              : mode === 'replace'
                ? '确认替换'
                : '确认合并'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModeOption({
  checked,
  onSelect,
  title,
  desc,
  badge,
  badgeDanger,
}: {
  checked: boolean
  onSelect: () => void
  title: string
  desc: string
  badge?: string
  badgeDanger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full text-left px-3 py-2.5 rounded-md border transition-all',
        'flex items-start gap-2.5',
        checked
          ? 'border-brand bg-brand/5 dark:bg-brand/10'
          : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40',
      )}
    >
      {/* 单选圆 */}
      <span
        className={cn(
          'mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center',
          checked
            ? 'border-brand'
            : 'border-slate-300 dark:border-slate-600',
        )}
      >
        {checked && <span className="w-2 h-2 rounded-full bg-brand" />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {title}
          </span>
          {badge && (
            <span
              className={cn(
                'text-[10px] leading-none px-1.5 py-0.5 rounded-sm',
                badgeDanger
                  ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300'
                  : 'bg-brand/10 text-brand',
              )}
            >
              {badge}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
          {desc}
        </div>
      </div>
    </button>
  )
}
