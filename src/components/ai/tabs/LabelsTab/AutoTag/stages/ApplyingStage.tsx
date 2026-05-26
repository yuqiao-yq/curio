/* Stage: applying —— setCardTagsBatch 进行中。通常很快就跳 done。 */

export function ApplyingStage() {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 gap-3 text-center">
      <div className="text-4xl animate-pulse">⏳</div>
      <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">
        正在写入标签…
      </h3>
    </div>
  )
}
