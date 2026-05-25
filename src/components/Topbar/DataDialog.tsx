import type { UserSettings } from '../../types/bookmark'
import { cn } from '../../utils/cn'
import { DialogShell } from './DialogShell'
import { SyncSection } from './SyncSection'

/**
 * 数据管理弹层：4 个数据操作入口 + 跨设备同步面板。
 * 操作回调来自外层 Topbar（已经包了 setDataDialogOpen(false)）。
 */
export function DataDialog({
  settings,
  onClose,
  onImportFromBrowser,
  onExportToBrowser,
  onImportJson,
  onExportJson,
}: {
  settings: UserSettings
  onClose: () => void
  onImportFromBrowser: () => void
  onExportToBrowser: () => void
  onImportJson: () => void
  onExportJson: () => void
}) {
  return (
    <DialogShell
      title={
        <span className="flex items-center gap-2">
          <span className="text-base">🗂️</span>
          <span>数据管理</span>
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <ActionItem
            icon="🌐"
            title="从浏览器导入书签"
            desc="一键合并当前浏览器现有书签，按文件夹层级保留分类。"
            onClick={onImportFromBrowser}
          />
          <ActionItem
            icon="🔄"
            title="同步到浏览器书签"
            desc="把当前所有分类与书签镜像到浏览器原生书签的指定文件夹中。"
            onClick={onExportToBrowser}
          />
          <ActionItem
            icon="📥"
            title="导入配置文件"
            desc="选择 JSON 配置文件，支持「合并」或「替换」两种模式。"
            onClick={onImportJson}
          />
          <ActionItem
            icon="📤"
            title="导出配置文件"
            desc="将当前所有分类、书签、设置打包为 JSON 下载到本地。"
            onClick={onExportJson}
          />
        </div>

        {/* 跨设备同步（V1.5）：与数据导入导出归一处「数据管理」语义下 */}
        <SyncSection settings={settings} />
      </div>
    </DialogShell>
  )
}

function ActionItem({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: string
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2.5 rounded-md border transition-all',
        'flex items-start gap-3',
        'border-slate-200 dark:border-slate-700',
        'hover:border-brand/50 hover:bg-brand/5 dark:hover:bg-brand/10',
      )}
    >
      <span className="text-lg leading-none mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {title}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
          {desc}
        </div>
      </div>
      <span className="text-slate-300 dark:text-slate-600 text-sm leading-none mt-1 shrink-0">
        ›
      </span>
    </button>
  )
}
