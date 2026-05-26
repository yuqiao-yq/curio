import { useTaggerStore } from '../../../../../../ai/services/useTaggerStore'

/* Stage: error —— 任意阶段抛出异常都汇到这里，errorMessage 由 goError 写入。 */

export function ErrorStage() {
  const errorMessage = useTaggerStore((s) => s.errorMessage)
  const reset = useTaggerStore((s) => s.reset)
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 gap-3 text-center">
      <div className="text-5xl">!</div>
      <h3 className="text-base font-semibold text-red-500">出错了</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-[280px] break-words">
        {errorMessage}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 h-8 px-4 rounded-md text-xs border border-slate-200 dark:border-slate-700 hover:border-brand"
      >
        重新开始
      </button>
    </div>
  )
}
