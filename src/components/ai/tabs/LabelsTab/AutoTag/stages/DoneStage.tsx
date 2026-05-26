import { useTaggerStore } from '../../../../../../ai/services/useTaggerStore'

/* Stage: done —— 成功完成。引导用户用 `#tag` 跨分类搜索。 */

export function DoneStage() {
  const reset = useTaggerStore((s) => s.reset)
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 gap-3 text-center">
      <div className="text-5xl">✓</div>
      <h3 className="text-base font-semibold text-emerald-600 dark:text-emerald-400">
        标签已应用
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-[260px]">
        现在可以在卡片上看到 tag chip，也能用搜索框输入{' '}
        <code className="font-mono text-[11px]">#标签名</code> 跨分类筛选。
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 h-8 px-4 rounded-md text-xs bg-brand text-white hover:bg-brand-600"
      >
        再来一次
      </button>
    </div>
  )
}
