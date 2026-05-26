import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useBookmarkStore } from '../../../stores/useBookmarkStore'
import { useAISettingsStore, useIsAIConfigured } from '../../../ai/useAISettingsStore'
import { useOrganizeStore } from '../../../ai/services/useOrganizeStore'
import { usePassiveSuggest } from '../../../ai/services/usePassiveSuggest'
import {
  estimateCostCny,
  estimateTokens,
  runOrganize,
  selectBookmarks,
} from '../../../ai/services/organizer'
import {
  applyPlan,
  clearUndoSnapshot,
  summarizePlan,
  undoPlan,
} from '../../../ai/services/plan'
import {
  ORGANIZE_STYLE_LABEL,
  type OrganizeRange,
  type OrganizeStyle,
} from '../../../ai/types'
import { useAIPanelStore } from '../../../ai/panel/usePanelStore'
import { toast } from '../../../stores/useToastStore'
import { cn } from '../../../utils/cn'
import { IconView } from '../../../utils/icon'
import { DiffViewer } from '../DiffViewer'

/**
 * AI 整理 Tab
 *
 * 阶段切换由 useOrganizeStore.stage 驱动：
 *   config → estimate → running → preview → applying → done
 *                            ↘ error
 */
export function OrganizeTab() {
  const stage = useOrganizeStore((s) => s.stage)

  // 切回 config 阶段时清空可能残留的撤销 snapshot
  useEffect(() => {
    if (stage === 'config') void clearUndoSnapshot()
  }, [stage])

  switch (stage) {
    case 'config':
      return <ConfigStage />
    case 'estimate':
      return <EstimateStage />
    case 'running':
      return <RunningStage />
    case 'preview':
      return <PreviewStage />
    case 'applying':
      return <ApplyingStage />
    case 'done':
      return <DoneStage />
    case 'error':
      return <ErrorStage />
  }
}

/* ──────────────────────────────────────────────
 * Stage 1: 配置
 * ────────────────────────────────────────────── */

function ConfigStage() {
  const configured = useIsAIConfigured()
  const cards = useBookmarkStore((s) => s.cards)
  const categories = useBookmarkStore((s) => s.categories)
  const range = useOrganizeStore((s) => s.range)
  const style = useOrganizeStore((s) => s.style)
  const setRange = useOrganizeStore((s) => s.setRange)
  const setStyle = useOrganizeStore((s) => s.setStyle)
  const goEstimate = useOrganizeStore((s) => s.goEstimate)

  const stat = useMemo(
    () => selectBookmarks(range, cards, categories).length,
    [range, cards, categories],
  )

  const topCategories = categories.filter((c) => !c.parentId)

  if (!configured) {
    return (
      <NoAINotice />
    )
  }

  return (
    <div className="p-3 space-y-4 text-sm">
      {/* 被动整理建议横幅（§5.2） */}
      <PassiveSuggestBanner />

      <Notice>
        AI 会读取所选范围内书签的「标题 + 域名」（不读完整 URL，更不读网页内容），
        给出一份分类建议供你预览。预览时可以单条接受或拒绝，应用后还有 60s 撤销窗口。
      </Notice>

      <section>
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
          整理范围
        </h4>
        <div className="space-y-1.5">
          <RangeOption
            label="全部书签"
            description={`整库 ${cards.length} 条`}
            checked={range.type === 'all'}
            onClick={() => setRange({ type: 'all' })}
          />
          <RangeOption
            label="顶层未分类项"
            description="顶层分类下散落的书签（尚未被嵌套整理过）"
            checked={range.type === 'uncategorized'}
            onClick={() => setRange({ type: 'uncategorized' })}
          />
          {topCategories.length > 0 && (
            <div className="pl-3 border-l-2 border-slate-100 dark:border-slate-700 space-y-1">
              <div className="text-[11px] text-slate-400 mt-2 mb-1">
                按某个顶层分类整理：
              </div>
              {topCategories.map((c) => (
                <RangeOption
                  key={c.id}
                  label={
                    <span className="flex items-center gap-1.5 min-w-0">
                      <IconView
                        value={c.icon}
                        fallback="📁"
                        emojiClassName="text-sm leading-none"
                        imgClassName="w-4 h-4 rounded-sm object-contain"
                      />
                      <span className="truncate">{c.name}</span>
                    </span>
                  }
                  description={`${cards.filter((x) => x.categoryId === c.id || isDescendantOf(x.categoryId, c.id, categories)).length} 条`}
                  checked={range.type === 'category' && range.id === c.id}
                  onClick={() => setRange({ type: 'category', id: c.id })}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section>
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
          风格倾向
        </h4>
        <div className="grid grid-cols-2 gap-1.5">
          {(['work', 'study', 'life', 'free'] as OrganizeStyle[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStyle(s)}
              className={cn(
                'px-2.5 py-1.5 rounded-md text-xs text-left transition-colors',
                'border',
                style === s
                  ? 'border-brand bg-brand/5 text-brand'
                  : 'border-slate-200 dark:border-slate-700 hover:border-brand/40 text-slate-600 dark:text-slate-300',
              )}
              title={ORGANIZE_STYLE_LABEL[s]}
            >
              {STYLE_TITLE[s]}
            </button>
          ))}
        </div>
      </section>

      <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60">
        <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
          准备整理 <span className="text-slate-700 dark:text-slate-200 tabular-nums font-medium">{stat}</span> 个书签
        </div>
        <button
          type="button"
          onClick={goEstimate}
          disabled={stat === 0}
          className={cn(
            'w-full h-9 inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium',
            stat > 0
              ? 'bg-brand text-white hover:bg-brand-600'
              : 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500 cursor-not-allowed',
          )}
        >
          ✨ 让 AI 整理
        </button>
      </div>
    </div>
  )
}

const STYLE_TITLE: Record<OrganizeStyle, string> = {
  work: '工作向',
  study: '学习向',
  life: '生活向',
  free: '自由发挥',
}

function RangeOption({
  label,
  description,
  checked,
  onClick,
}: {
  /** ReactNode 以支持自定义图标（data:image / http URL）渲染为 <img/> */
  label: React.ReactNode
  description?: string
  checked: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-3 p-2 rounded-md text-left transition-colors',
        'border',
        checked
          ? 'border-brand bg-brand/5'
          : 'border-slate-200 dark:border-slate-700 hover:border-brand/40',
      )}
    >
      <span
        className={cn(
          'shrink-0 mt-0.5 w-3.5 h-3.5 rounded-full border flex items-center justify-center',
          checked
            ? 'border-brand bg-brand'
            : 'border-slate-300 dark:border-slate-600',
        )}
        aria-hidden
      >
        {checked && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
      </span>
      <div className="flex-1 min-w-0">
        <div
          className={cn(
            'text-sm',
            checked ? 'text-brand font-medium' : 'text-slate-700 dark:text-slate-200',
          )}
        >
          {label}
        </div>
        {description && (
          <div className="text-[11px] text-slate-400 mt-0.5">{description}</div>
        )}
      </div>
    </button>
  )
}

/* ──────────────────────────────────────────────
 * Stage 2: 成本估算
 * ────────────────────────────────────────────── */

function EstimateStage() {
  // 只反应式订阅展示所需的字段；真正传给 runOrganize 的 settings 在
  // handleStart 触发时通过 getState() 读，避免无关字段（apiKey 等）re-render。
  const { providers, routing, anonymousMode } = useAISettingsStore(
    useShallow((s) => ({
      providers: s.providers,
      routing: s.routing,
      anonymousMode: s.privacy.anonymousMode,
    })),
  )
  const cards = useBookmarkStore((s) => s.cards)
  const categories = useBookmarkStore((s) => s.categories)
  const range = useOrganizeStore((s) => s.range)
  const style = useOrganizeStore((s) => s.style)
  const reset = useOrganizeStore((s) => s.reset)
  const goRunning = useOrganizeStore((s) => s.goRunning)
  const setProgress = useOrganizeStore((s) => s.setProgress)
  const goPreview = useOrganizeStore((s) => s.goPreview)
  const goError = useOrganizeStore((s) => s.goError)

  const targetCards = useMemo(
    () => selectBookmarks(range, cards, categories),
    [range, cards, categories],
  )

  // 粗估：每条书签平均 30 个字符（id + title + domain）
  const estimatedPromptTokens = estimateTokens(
    targetCards.map((c) => `id=${c.id} | ${c.title} | ${c.url}`).join('\n'),
  )
  // 输出粗估：assignments 平均每条 30 字符
  const estimatedOutputTokens = targetCards.length * 15

  // 取 chat provider 的 model 估成本
  const provider = providers.find(
    (p) => p.id === (routing.organize ?? routing.chat),
  )
  const cost = provider
    ? estimateCostCny(provider.model, estimatedPromptTokens, estimatedOutputTokens)
    : 0

  const handleStart = async () => {
    const controller = new AbortController()
    goRunning(controller)
    try {
      const plan = await runOrganize({
        range,
        style,
        cards,
        categories,
        settings: useAISettingsStore.getState(),
        signal: controller.signal,
        onProgress: setProgress,
      })
      goPreview(plan)
    } catch (err) {
      if (controller.signal.aborted) {
        // 用户取消，回到 config，不算错误
        return
      }
      const msg = err instanceof Error ? err.message : '未知错误'
      goError(msg)
      toast.error('AI 整理失败', msg)
    }
  }

  return (
    <div className="p-3 space-y-4 text-sm">
      <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">
        即将执行 AI 整理
      </h3>

      <div className="rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 p-3 space-y-1.5 text-xs">
        <Stat label="书签数量" value={`${targetCards.length} 条`} />
        <Stat label="使用 Provider" value={provider?.name ?? '(未选)'} />
        <Stat label="使用模型" value={provider?.model ?? '(未选)'} mono />
        <Stat
          label="发送数据"
          value={
            anonymousMode
              ? '标题 + 域名（已匿名）'
              : '标题 + 域名'
          }
        />
        <div className="border-t border-slate-200 dark:border-slate-700/60 my-1.5" />
        <Stat label="估算 prompt tokens" value={estimatedPromptTokens.toLocaleString()} />
        <Stat label="估算 output tokens" value={estimatedOutputTokens.toLocaleString()} />
        <Stat
          label="估算成本"
          value={cost > 0 ? `≈ ¥${cost.toFixed(4)}` : '免费 / 未知'}
          highlight
        />
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed">
        以上为粗略估算（按字符数 / 2 估 token，按硬编码价格表估成本）。
        实际值以 Provider 返回为准。
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={reset}
          className={cn(
            'flex-1 h-9 rounded-md text-sm',
            'text-slate-600 dark:text-slate-300',
            'hover:bg-slate-100 dark:hover:bg-slate-700/60',
          )}
        >
          返回
        </button>
        <button
          type="button"
          onClick={() => void handleStart()}
          className="flex-1 h-9 rounded-md text-sm font-medium bg-brand text-white hover:bg-brand-600"
        >
          确认执行
        </button>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  mono,
  highlight,
}: {
  label: string
  value: string
  mono?: boolean
  highlight?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span
        className={cn(
          'tabular-nums',
          mono && 'font-mono text-[11px]',
          highlight ? 'text-brand font-medium' : 'text-slate-700 dark:text-slate-200',
        )}
      >
        {value}
      </span>
    </div>
  )
}

/* ──────────────────────────────────────────────
 * Stage 3: AI 处理中
 * ────────────────────────────────────────────── */

function RunningStage() {
  const progress = useOrganizeStore((s) => s.progress)
  const cancel = useOrganizeStore((s) => s.cancel)
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="h-full flex flex-col items-center justify-center p-6 gap-3 text-center">
      <div className="text-4xl animate-pulse">✨</div>
      <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">
        AI 正在分析你的书签…
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

/* ──────────────────────────────────────────────
 * Stage 4: 预览 + 应用
 * ────────────────────────────────────────────── */

function PreviewStage() {
  const plan = useOrganizeStore((s) => s.plan)
  const review = useOrganizeStore((s) => s.review)
  const acceptAll = useOrganizeStore((s) => s.acceptAll)
  const reset = useOrganizeStore((s) => s.reset)
  const goApplying = useOrganizeStore((s) => s.goApplying)
  const goDone = useOrganizeStore((s) => s.goDone)
  const goError = useOrganizeStore((s) => s.goError)

  if (!plan) return null

  const summary = summarizePlan(plan, review)
  const hasAny =
    summary.newCategories > 0 || summary.moves > 0 || summary.deletions > 0

  const handleApply = async () => {
    goApplying()
    try {
      const result = await applyPlan(plan, review)
      goDone()
      // 显示带撤销倒计时的 toast
      showUndoToast(result)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误'
      goError(msg)
      toast.error('应用整理失败', msg)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部：统计 + 全选 */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 text-xs">
        <span className="text-slate-500 dark:text-slate-400">已选</span>
        <span className="tabular-nums text-slate-700 dark:text-slate-200">
          +{summary.newCategories} 分类
        </span>
        <span className="tabular-nums text-slate-700 dark:text-slate-200">
          ↻{summary.moves} 移动
        </span>
        <span className="tabular-nums text-slate-700 dark:text-slate-200">
          🗑{summary.deletions}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={acceptAll}
          className="text-brand hover:underline"
        >
          全部接受
        </button>
      </div>

      {/* 中间：diff 滚动区 */}
      <div className="flex-1 overflow-auto p-3">
        <DiffViewer plan={plan} review={review} />
      </div>

      {/* 底部：操作 */}
      <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2">
        <button
          type="button"
          onClick={reset}
          className={cn(
            'flex-1 h-9 rounded-md text-sm',
            'text-slate-600 dark:text-slate-300',
            'hover:bg-slate-100 dark:hover:bg-slate-700/60',
          )}
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => void handleApply()}
          disabled={!hasAny}
          className={cn(
            'flex-1 h-9 rounded-md text-sm font-medium',
            hasAny
              ? 'bg-brand text-white hover:bg-brand-600'
              : 'bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500 cursor-not-allowed',
          )}
        >
          应用
        </button>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────
 * Stage 5: 应用中
 * ────────────────────────────────────────────── */

function ApplyingStage() {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 gap-3 text-center">
      <div className="text-4xl animate-pulse">⏳</div>
      <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">
        正在应用整理…
      </h3>
      <p className="text-xs text-slate-400">
        创建分类、移动书签、删除空分类
      </p>
    </div>
  )
}

/* ──────────────────────────────────────────────
 * Stage 6: 完成
 * ────────────────────────────────────────────── */

function DoneStage() {
  const reset = useOrganizeStore((s) => s.reset)
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 gap-3 text-center">
      <div className="text-5xl">✓</div>
      <h3 className="text-base font-semibold text-emerald-600 dark:text-emerald-400">
        整理完成
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-[260px]">
        如有问题，可在右上 toast 内一键撤销，60s 内有效。
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 h-8 px-4 rounded-md text-xs bg-brand text-white hover:bg-brand-600"
      >
        再整理一次
      </button>
    </div>
  )
}

/* ──────────────────────────────────────────────
 * Stage 7: 错误
 * ────────────────────────────────────────────── */

function ErrorStage() {
  const errorMessage = useOrganizeStore((s) => s.errorMessage)
  const reset = useOrganizeStore((s) => s.reset)
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

/* ──────────────────────────────────────────────
 * 通用：未配置 AI 提示
 * ────────────────────────────────────────────── */

function NoAINotice() {
  const addTab = useAIPanelStore((s) => s.addTab)
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 gap-3 text-center">
      <div className="text-5xl">⚙</div>
      <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">
        请先配置 AI Provider
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-[280px]">
        AI 整理需要至少一个可用的 LLM Provider。
        可以是 DeepSeek / OpenAI / Moonshot / 自部署 Ollama 等。
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

/* ──────────────────────────────────────────────
 * 撤销 toast（带倒计时 + action 按钮，60s 内可一键还原）
 * ────────────────────────────────────────────── */

function showUndoToast(result: {
  newCategoriesCreated: number
  bookmarksMoved: number
  categoriesDeleted: number
}) {
  toast.show({
    kind: 'success',
    title: '整理已应用',
    message: `+${result.newCategoriesCreated} 分类 · ↻${result.bookmarksMoved} 移动 · 🗑${result.categoriesDeleted}`,
    duration: 60_000,
    action: {
      label: '↶ 撤销整理',
      variant: 'default',
      onClick: async () => {
        const r = await undoPlan()
        if (r.ok) {
          toast.success('已撤销', '已恢复到整理前的状态')
        } else {
          toast.error('撤销失败', r.message)
        }
      },
    },
    // toast 关闭（包括超时 / 用户 ✕）→ 清理 snapshot，避免长期占用 storage
    onDismiss: () => {
      void clearUndoSnapshot()
    },
  })
}

/* ──────────────────────────────────────────────
 * 工具：判断 categoryId 是否是 rootId 的后代
 * ────────────────────────────────────────────── */

function isDescendantOf(
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

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 leading-relaxed">
      {children}
    </div>
  )
}

/**
 * 被动建议横幅（§5.2）
 * - 仅在 hook 报告 shouldShow 时显示
 * - 用户点 ✕ → dismiss（推迟 7 天）
 * - 文案聚焦"行动召唤"：让用户感觉这是省事建议而不是打扰
 */
function PassiveSuggestBanner() {
  const { shouldShow, newCount, dismiss } = usePassiveSuggest()
  if (!shouldShow) return null
  return (
    <div
      className={cn(
        'rounded-md px-3 py-2 text-xs flex items-start gap-2',
        'bg-amber-50 dark:bg-amber-500/10',
        'border border-amber-200 dark:border-amber-500/30',
        'text-amber-800 dark:text-amber-200',
      )}
    >
      <span aria-hidden className="text-base leading-none mt-0.5">💡</span>
      <div className="flex-1 leading-relaxed">
        距上次整理已新增 <span className="font-semibold tabular-nums">{newCount}</span>{' '}
        条书签。要不要让 AI 顺手按主题归归类？已为你预选「顶层未分类项」范围。
      </div>
      <button
        type="button"
        onClick={() => void dismiss()}
        className={cn(
          'shrink-0 w-5 h-5 inline-flex items-center justify-center rounded text-xs',
          'text-amber-500 hover:text-amber-700 hover:bg-amber-100 dark:hover:bg-amber-500/20',
        )}
        title="本周不再提示"
        aria-label="本周不再提示"
      >
        ✕
      </button>
    </div>
  )
}
