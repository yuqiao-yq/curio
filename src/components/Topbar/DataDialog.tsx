import type { UserSettings } from '../../types/bookmark'
import { useBookmarkStore } from '../../stores/useBookmarkStore'
import { cancelPendingBrowserSyncExport } from '../../stores/useBookmarkStore/scheduler'
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
  const updateSettings = useBookmarkStore((s) => s.updateSettings)
  // v0.22.x：浏览器书签自动同步开关
  const autoSync = settings.browserSyncAuto === true
  const toggleAutoSync = () => {
    const next = !autoSync
    void updateSettings({ browserSyncAuto: next })
    // 关闭时主动 cancel 挂起的 timer，避免开关切到关之后还跑一次镜像
    if (!next) cancelPendingBrowserSyncExport()
  }

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
          <div className="space-y-1.5">
            <ActionItem
              icon="🔄"
              title="同步到浏览器书签"
              desc={
                autoSync
                  ? '镜像到浏览器原生书签 · 已开启自动同步（数据变更后 3s 自动镜像）'
                  : '把当前所有分类与书签镜像到浏览器原生书签的指定文件夹中。'
              }
              onClick={onExportToBrowser}
            />
            {/* 自动同步开关：与「同步到浏览器书签」语义紧密绑定，作为它的"模式" */}
            <AutoSyncToggle on={autoSync} onToggle={toggleAutoSync} />
          </div>
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

/**
 * 「同步到浏览器书签」下方的自动同步开关 row。
 * 视觉上稍微缩进 + 弱化，表达"它是上面那条 ActionItem 的子选项"
 */
function AutoSyncToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-full text-left px-3 py-2 rounded-md border ml-0',
        'flex items-center gap-3',
        'transition-colors',
        on
          ? 'border-brand/40 bg-brand/5 dark:bg-brand/10'
          : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40',
      )}
      aria-pressed={on}
    >
      <span className="text-base leading-none shrink-0">⚡</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-slate-700 dark:text-slate-200">
          数据变更后自动同步
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
          {on
            ? '已开启 · 添加 / 编辑 / 拖拽书签后 3 秒内自动镜像到浏览器'
            : '默认关闭 · 仅在点击上方按钮时手动同步一次'}
        </div>
      </div>
      {/* 自绘 toggle：圆角矩形 + 滑块，与 Tailwind 默认控件视觉一致 */}
      <span
        className={cn(
          'shrink-0 inline-flex items-center w-9 h-5 rounded-full px-0.5',
          'transition-colors',
          on ? 'bg-brand' : 'bg-slate-300 dark:bg-slate-600',
        )}
        aria-hidden
      >
        <span
          className={cn(
            'inline-block w-4 h-4 rounded-full bg-white shadow-sm',
            'transition-transform duration-200',
            on ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </span>
    </button>
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
