import { useState } from 'react'
import type { BrowserSyncRoot } from '../../services/bookmarkExporter'
import { cn } from '../../utils/cn'
import { DialogShell } from './DialogShell'

/**
 * 同步到浏览器：参数确认弹窗。
 * - root         ：写到「书签栏」还是「其他书签」
 * - folderName   ：根文件夹名（默认 Tab It），避免污染用户已有书签
 * - 含一条强提醒：镜像模式 = 该文件夹内的多余项会被自动清理
 */
export function ExportToBrowserDialog({
  defaultRoot,
  defaultFolderName,
  exporting,
  onCancel,
  onConfirm,
}: {
  defaultRoot: BrowserSyncRoot
  defaultFolderName: string
  exporting: boolean
  onCancel: () => void
  onConfirm: (params: {
    root: BrowserSyncRoot
    folderName: string
  }) => void
}) {
  const [root, setRoot] = useState<BrowserSyncRoot>(defaultRoot)
  const [folderName, setFolderName] = useState(defaultFolderName)
  const trimmed = folderName.trim()
  const invalid = trimmed.length === 0 || trimmed.length > 60

  return (
    <DialogShell
      title={
        <span className="flex items-center gap-2">
          <span className="text-base">🔄</span>
          <span>同步到浏览器书签</span>
        </span>
      }
      width={520}
      onClose={onCancel}
      footer={
        <>
          <button
            type="button"
            disabled={exporting}
            onClick={onCancel}
            className={cn(
              'px-3 py-1.5 text-sm rounded transition-colors',
              'text-slate-600 dark:text-slate-300',
              'hover:bg-slate-100 dark:hover:bg-slate-700/60',
              exporting && 'opacity-50 cursor-not-allowed',
            )}
          >
            取消
          </button>
          <button
            type="button"
            disabled={exporting || invalid}
            onClick={() => onConfirm({ root, folderName: trimmed })}
            className={cn(
              'px-3 py-1.5 text-sm rounded font-medium transition-colors',
              'bg-brand text-white hover:bg-brand-600',
              (exporting || invalid) && 'opacity-50 cursor-not-allowed',
            )}
          >
            {exporting ? '同步中…' : '开始同步'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* 目标根：书签栏 / 其他书签 */}
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            写入位置
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                {
                  key: 'bookmarks_bar',
                  label: '书签栏',
                  desc: '顶部工具栏可见',
                  icon: '📌',
                },
                {
                  key: 'other',
                  label: '其他书签',
                  desc: '收纳在书签管理器',
                  icon: '📁',
                },
              ] as const
            ).map((opt) => {
              const active = root === opt.key
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setRoot(opt.key)}
                  className={cn(
                    'flex items-start gap-2 px-3 py-2.5 rounded-md border text-left transition-all',
                    active
                      ? 'border-brand bg-brand/5 dark:bg-brand/10'
                      : 'border-slate-200 dark:border-slate-700 hover:border-brand/40 hover:bg-slate-50 dark:hover:bg-slate-700/40',
                  )}
                >
                  <span className="text-lg leading-none mt-0.5 shrink-0">
                    {opt.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div
                      className={cn(
                        'text-sm',
                        active
                          ? 'text-brand font-medium'
                          : 'text-slate-700 dark:text-slate-200',
                      )}
                    >
                      {opt.label}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {opt.desc}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        {/* 根文件夹名 */}
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            根文件夹名
          </h4>
          <input
            type="text"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="Tab It"
            spellCheck={false}
            disabled={exporting}
            className={cn(
              'w-full px-3 py-1.5 text-sm rounded-md',
              'border border-slate-200 dark:border-slate-700',
              'bg-white dark:bg-slate-900',
              'outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all',
              'placeholder:text-slate-400',
              invalid && 'border-red-300 dark:border-red-500/60',
              exporting && 'opacity-50 cursor-not-allowed',
            )}
          />
          <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
            会在选定位置下复用 / 创建该文件夹，所有 Tab It 数据都收纳在其中，
            避免污染你原有的书签结构。
          </p>
        </section>

        {/* 行为说明（强提醒） */}
        <section
          className={cn(
            'rounded-md px-3 py-2.5 text-[12px] leading-relaxed',
            'bg-amber-50 dark:bg-amber-500/10',
            'border border-amber-200 dark:border-amber-500/30',
            'text-amber-700 dark:text-amber-200',
          )}
        >
          <div className="font-medium mb-1">⚠ 镜像同步说明</div>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>同步方向为单向：Tab It → 浏览器（不读取浏览器侧的改动）</li>
            <li>
              会保持「<span className="font-mono">{trimmed || 'Tab It'}</span>
              」文件夹与 Tab It 数据完全一致：
              <span className="font-medium">该文件夹下的多余项会被自动清理</span>
            </li>
            <li>不影响该文件夹之外的任何浏览器原有书签</li>
          </ul>
        </section>
      </div>
    </DialogShell>
  )
}
