import { useAIPanelStore } from '../../../../ai/panel/usePanelStore'

/* ──────────────────────────────────────────────────────────────────────
 * LabelsTab 内多个 stage / section 共用的小组件与函数。
 * 每个都只有一处或两处用到，但全部内联会让本目录互相循环依赖，
 * 抽到这里只是为了避免「Notice 写两份、isDescendantOf 写两份」。
 * ────────────────────────────────────────────────────────────────────── */

/** 未配置 AI 时的占位面板：带「前往设置」CTA */
export function NoAINotice() {
  const addTab = useAIPanelStore((s) => s.addTab)
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 gap-3 text-center">
      <div className="text-5xl">⚙</div>
      <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">
        请先配置 AI Provider
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-[280px]">
        AI 自动打标签需要至少一个可用的 LLM Provider。
      </p>
      <button
        type="button"
        onClick={() => addTab('settings')}
        className="mt-2 h-8 px-4 rounded-md text-xs bg-brand text-white hover:bg-brand-600"
      >
        前往设置
      </button>
    </div>
  )
}

/** 浅色提示条：低调的灰底说明文本 */
export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 leading-relaxed">
      {children}
    </div>
  )
}

/** 判断 categoryId 是否在 rootId 子树下（不含 root 自身） */
export function isDescendantOf(
  categoryId: string,
  rootId: string,
  categories: Array<{ id: string; parentId?: string }>,
): boolean {
  const map = new Map(categories.map((c) => [c.id, c]))
  let cur = map.get(categoryId)
  while (cur?.parentId) {
    if (cur.parentId === rootId) return true
    cur = map.get(cur.parentId)
  }
  return false
}
