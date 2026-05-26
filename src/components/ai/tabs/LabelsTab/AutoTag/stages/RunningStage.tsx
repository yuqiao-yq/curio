import { useTaggerStore } from '../../../../../../ai/services/useTaggerStore'
import { cn } from '../../../../../../utils/cn'

/* Stage: running —— 进度条 + 取消。runTagger 的 onProgress 推 done/total。 */

export function RunningStage() {
  const progress = useTaggerStore((s) => s.progress)
  const cancel = useTaggerStore((s) => s.cancel)
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="h-full flex flex-col items-center justify-center p-6 gap-3 text-center">
      <div className="text-4xl animate-pulse">🏷</div>
      <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">
        AI 正在为你的书签打标签…
      </h3>
      <div className="w-full max-w-xs">
        <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
          <div
            className="h-full bg-brand transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1 text-xs text-slate-400 tabular-nums">
          批次 {progress.done} / {progress.total} ({pct}%)
        </div>
      </div>
      <button
        type="button"
        onClick={cancel}
        className={cn(
          'mt-2 px-3 py-1 rounded text-xs',
          'text-slate-500 hover:text-red-500',
          'hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors',
        )}
      >
        取消
      </button>
    </div>
  )
}
