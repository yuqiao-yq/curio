import { DialogShell } from './DialogShell'
// 读 package.json 取版本号在「关于」弹窗里展示，避免硬编码导致信息漂移
import pkg from '../../../package.json'

/**
 * UI 构建标识：每次 UI 大改时 +1，便于在「关于」里确认页面是否加载到最新代码。
 * 之前嵌在侧栏底部对普通用户是噪音，现在统一收到「关于」弹窗里。
 */
const UI_BUILD_TAG = 'v6-relative-paths'

export function AboutDialog({ onClose }: { onClose: () => void }) {
  const repoUrl = 'https://github.com/yuqiao-yq/tab-it'
  return (
    <DialogShell
      title={
        <span className="flex items-center gap-2">
          <span className="text-base">ℹ️</span>
          <span>关于 Tab It</span>
        </span>
      }
      width={440}
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-brand">Tab It</span>
          <span className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">
            v{pkg.version}
          </span>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          替代浏览器新标签页的书签整理工具。所有数据本地存储，开源免费。
        </p>

        <div className="rounded-md bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 px-3 py-2 space-y-1">
          <InfoRow label="版本" value={`v${pkg.version}`} />
          <InfoRow label="UI build" value={UI_BUILD_TAG} />
          <InfoRow
            label="项目主页"
            value={
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline break-all"
              >
                {repoUrl.replace('https://', '')}
              </a>
            }
          />
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          反馈与建议欢迎到 GitHub 提 issue。
        </p>
      </div>
    </DialogShell>
  )
}

function InfoRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-slate-500 dark:text-slate-400 shrink-0">
        {label}
      </span>
      <span className="text-slate-700 dark:text-slate-200 text-right truncate">
        {value}
      </span>
    </div>
  )
}
