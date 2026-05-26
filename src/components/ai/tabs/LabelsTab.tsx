import { useEffect, useMemo, useState } from 'react'
import { useBookmarkStore } from '../../../stores/useBookmarkStore'
import { useAISettingsStore } from '../../../ai/useAISettingsStore'
import { useTaggerStore, resolveFinalEntries } from '../../../ai/services/useTaggerStore'
import {
  collectTagUsage,
  estimateTaggerCost,
  runTagger,
  selectCardsForTagging,
} from '../../../ai/services/tagger'
import {
  TAG_RANGE_LABEL,
  isAIConfigured,
  type TagRange,
} from '../../../ai/types'
import { useAIPanelStore } from '../../../ai/panel/usePanelStore'
import { toast } from '../../../stores/useToastStore'
import { confirmDialog, promptDialog } from '../../Dialog'
import { cn } from '../../../utils/cn'
import { IconView } from '../../../utils/icon'

/**
 * 「标签」Tab —— V1.0 §4.4 自动打标签 + 标签管理
 *
 * 顶部双 section 切换：
 *   [✨ 批量打标签]  [🏷 标签管理]
 *
 * - 批量打标签：完整的 config → estimate → running → preview → applying → done 状态机
 * - 标签管理：列出全库所有标签 + 计数；提供改名 / 合并 / 删除
 */
export function LabelsTab() {
  const [section, setSection] = useState<'auto' | 'manage'>('auto')

  return (
    <div className="flex flex-col h-full">
      {/* 顶部双 section 切换 */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 shrink-0">
        <SectionTab
          active={section === 'auto'}
          onClick={() => setSection('auto')}
          icon="✨"
          label="批量打标签"
        />
        <SectionTab
          active={section === 'manage'}
          onClick={() => setSection('manage')}
          icon="🏷"
          label="标签管理"
        />
      </div>

      <div className="flex-1 overflow-auto">
        {section === 'auto' ? <AutoTagSection /> : <ManageSection />}
      </div>
    </div>
  )
}

function SectionTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: string
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 h-7 inline-flex items-center justify-center gap-1 rounded text-xs',
        'transition-colors',
        active
          ? 'bg-brand/10 text-brand font-medium'
          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
      )}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </button>
  )
}

/* ═══════════════════════════════════════════════════════════
 * SECTION 1: 批量打标签（状态机）
 * ═══════════════════════════════════════════════════════════ */

function AutoTagSection() {
  const stage = useTaggerStore((s) => s.stage)
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

/* ── Stage: config ── */

function ConfigStage() {
  const settings = useAISettingsStore()
  const configured = isAIConfigured(settings)
  const cards = useBookmarkStore((s) => s.cards)
  const categories = useBookmarkStore((s) => s.categories)
  const range = useTaggerStore((s) => s.range)
  const setRange = useTaggerStore((s) => s.setRange)
  const goEstimate = useTaggerStore((s) => s.goEstimate)

  const stat = useMemo(
    () => selectCardsForTagging(range, cards, categories).length,
    [range, cards, categories],
  )

  const topCategories = categories.filter((c) => !c.parentId)

  if (!configured) return <NoAINotice />

  return (
    <div className="p-3 space-y-4 text-sm">
      <Notice>
        AI 会读取所选范围内书签的「标题 + 域名」（不读完整 URL，更不读网页内容），
        为每条建议 2-4 个中文短标签。预览时可以单条接受或拒绝、也能直接编辑标签后再应用。
      </Notice>

      <section>
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
          打标签范围
        </h4>
        <div className="space-y-1.5">
          <RangeOption
            label={TAG_RANGE_LABEL.untagged}
            description="只为还没打过标签的书签生成（推荐：增量、低成本）"
            checked={range.type === 'untagged'}
            onClick={() => setRange({ type: 'untagged' })}
          />
          <RangeOption
            label={TAG_RANGE_LABEL.all}
            description="对所有书签重新生成（覆盖已有 tags；适合首次或大改）"
            checked={range.type === 'all'}
            onClick={() => setRange({ type: 'all' })}
          />
          {topCategories.length > 0 && (
            <div className="pl-3 border-l-2 border-slate-100 dark:border-slate-700 space-y-1">
              <div className="text-[11px] text-slate-400 mt-2 mb-1">
                按某个顶层分类（含后代）打标签：
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

      <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60">
        <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
          准备打标签{' '}
          <span className="text-slate-700 dark:text-slate-200 tabular-nums font-medium">
            {stat}
          </span>{' '}
          个书签
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
          ✨ 让 AI 打标签
        </button>
      </div>
    </div>
  )
}

function RangeOption({
  label,
  description,
  checked,
  onClick,
}: {
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

/* ── Stage: estimate ── */

function EstimateStage() {
  const settings = useAISettingsStore()
  const cards = useBookmarkStore((s) => s.cards)
  const categories = useBookmarkStore((s) => s.categories)
  const range = useTaggerStore((s) => s.range)
  const reset = useTaggerStore((s) => s.reset)
  const goRunning = useTaggerStore((s) => s.goRunning)
  const setProgress = useTaggerStore((s) => s.setProgress)
  const goPreview = useTaggerStore((s) => s.goPreview)
  const goError = useTaggerStore((s) => s.goError)

  const targetCards = useMemo(
    () => selectCardsForTagging(range, cards, categories),
    [range, cards, categories],
  )

  const provider = settings.providers.find(
    (p) => p.id === (settings.routing.organize ?? settings.routing.chat),
  )
  const { promptTokens, outputTokens, costCny } = useMemo(
    () => estimateTaggerCost(targetCards, provider?.model ?? ''),
    [targetCards, provider?.model],
  )

  const handleStart = async () => {
    const controller = new AbortController()
    goRunning(controller)
    try {
      const plan = await runTagger({
        range,
        cards,
        categories,
        settings,
        signal: controller.signal,
        onProgress: setProgress,
      })
      if (plan.suggestions.length === 0) {
        // AI 一条建议都没给 —— 罕见，提示用户
        goError('AI 没有给出任何标签建议（可能是模型返回格式异常）。请重试，或换一个 Provider。')
        return
      }
      goPreview(plan)
    } catch (err) {
      if (controller.signal.aborted) return
      const msg = err instanceof Error ? err.message : '未知错误'
      goError(msg)
      toast.error('AI 打标签失败', msg)
    }
  }

  return (
    <div className="p-3 space-y-4 text-sm">
      <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">
        即将执行 AI 打标签
      </h3>

      <div className="rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 p-3 space-y-1.5 text-xs">
        <Stat label="书签数量" value={`${targetCards.length} 条`} />
        <Stat label="使用 Provider" value={provider?.name ?? '(未选)'} />
        <Stat label="使用模型" value={provider?.model ?? '(未选)'} mono />
        <Stat label="发送数据" value="标题 + 域名（已匿名）" />
        <div className="border-t border-slate-200 dark:border-slate-700/60 my-1.5" />
        <Stat label="估算 prompt tokens" value={promptTokens.toLocaleString()} />
        <Stat label="估算 output tokens" value={outputTokens.toLocaleString()} />
        <Stat
          label="估算成本"
          value={costCny > 0 ? `≈ ¥${costCny.toFixed(4)}` : '免费 / 未知'}
          highlight
        />
      </div>

      <p className="text-[11px] text-slate-400 leading-relaxed">
        以上为粗略估算。实际值以 Provider 返回为准。
        每批 50 条；成本与书签数量近似线性。
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

/* ── Stage: running ── */

function RunningStage() {
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

/* ── Stage: preview ── */

function PreviewStage() {
  const plan = useTaggerStore((s) => s.plan)
  const review = useTaggerStore((s) => s.review)
  const acceptAll = useTaggerStore((s) => s.acceptAll)
  const rejectAll = useTaggerStore((s) => s.rejectAll)
  const reset = useTaggerStore((s) => s.reset)
  const goApplying = useTaggerStore((s) => s.goApplying)
  const goDone = useTaggerStore((s) => s.goDone)
  const goError = useTaggerStore((s) => s.goError)
  const setCardTagsBatch = useBookmarkStore((s) => s.setCardTagsBatch)
  const cards = useBookmarkStore((s) => s.cards)

  // 卡片快查表（hook 必须在 early return 之前）
  const cardMap = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])

  if (!plan) return null

  const acceptedCount = review.accepted.size

  const handleApply = async () => {
    goApplying()
    try {
      const entries = resolveFinalEntries(plan, review)
      if (entries.length > 0) {
        await setCardTagsBatch(entries)
      }
      goDone()
      toast.success(
        '标签已写入',
        `${entries.length} 条书签更新了 tags`,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误'
      goError(msg)
      toast.error('应用标签失败', msg)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 顶部统计 + 全选 */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 text-xs">
        <span className="text-slate-500 dark:text-slate-400">已勾选</span>
        <span className="tabular-nums text-slate-700 dark:text-slate-200">
          {acceptedCount} / {plan.suggestions.length}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={acceptAll}
          className="text-brand hover:underline"
        >
          全选
        </button>
        <span className="text-slate-300 dark:text-slate-600">·</span>
        <button
          type="button"
          onClick={rejectAll}
          className="text-slate-500 hover:text-red-500"
        >
          全不选
        </button>
      </div>

      {/* 中间：建议列表 */}
      <div className="flex-1 overflow-auto p-2 space-y-1.5">
        {plan.suggestions.map((s) => (
          <SuggestionRow
            key={s.bookmarkId}
            suggestion={s}
            card={cardMap.get(s.bookmarkId)}
            accepted={review.accepted.has(s.bookmarkId)}
            edited={review.edits.get(s.bookmarkId)}
          />
        ))}
        {plan.suggestions.length === 0 && (
          <div className="text-center text-xs text-slate-400 py-8">
            AI 没有给出任何建议
          </div>
        )}
      </div>

      {/* 底部操作 */}
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
          disabled={acceptedCount === 0}
          className={cn(
            'flex-1 h-9 rounded-md text-sm font-medium',
            acceptedCount > 0
              ? 'bg-brand text-white hover:bg-brand-600'
              : 'bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500 cursor-not-allowed',
          )}
        >
          应用 {acceptedCount > 0 && `(${acceptedCount})`}
        </button>
      </div>
    </div>
  )
}

function SuggestionRow({
  suggestion,
  card,
  accepted,
  edited,
}: {
  suggestion: { bookmarkId: string; oldTags?: string[]; newTags: string[] }
  card?: { title: string; url: string }
  accepted: boolean
  edited?: string[]
}) {
  const toggleAccept = useTaggerStore((s) => s.toggleAccept)
  const editTags = useTaggerStore((s) => s.editTags)
  const resetEdit = useTaggerStore((s) => s.resetEdit)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const finalTags = edited ?? suggestion.newTags

  const startEdit = () => {
    setDraft(finalTags.join(' '))
    setEditing(true)
  }
  const commitEdit = () => {
    const next = draft
      .split(/[\s,，]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    editTags(suggestion.bookmarkId, next)
    setEditing(false)
  }

  // 卡片可能已被删除（理论上 plan 期间不会，但防御）
  if (!card) return null

  return (
    <div
      className={cn(
        'rounded-md border p-2 transition-colors',
        accepted
          ? 'border-brand/40 bg-brand/5'
          : 'border-slate-200 dark:border-slate-700 bg-slate-50/40 dark:bg-slate-800/20 opacity-70',
      )}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={accepted}
          onChange={() => toggleAccept(suggestion.bookmarkId)}
          className="mt-1 shrink-0 accent-brand cursor-pointer"
          aria-label="接受此建议"
        />
        <div className="flex-1 min-w-0">
          {/* 卡片标题 */}
          <div className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
            {card.title}
          </div>
          <div className="text-[10px] text-slate-400 truncate font-mono">
            {card.url}
          </div>

          {/* tags 区 */}
          <div className="mt-1.5">
            {editing ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit()
                    if (e.key === 'Escape') setEditing(false)
                  }}
                  onBlur={commitEdit}
                  placeholder="用空格 / 逗号分隔"
                  className={cn(
                    'flex-1 h-6 px-1.5 text-xs rounded',
                    'bg-white dark:bg-slate-900',
                    'border border-brand focus:ring-1 focus:ring-brand/30 outline-none',
                  )}
                />
              </div>
            ) : (
              <div className="flex items-center flex-wrap gap-1">
                {suggestion.oldTags && suggestion.oldTags.length > 0 && (
                  <>
                    {suggestion.oldTags.map((t) => (
                      <span
                        key={`old-${t}`}
                        className="inline-flex items-center px-1.5 h-4 rounded text-[10px] text-slate-400 line-through bg-slate-100 dark:bg-slate-800"
                      >
                        {t}
                      </span>
                    ))}
                    <span className="text-[10px] text-slate-300 mx-0.5">→</span>
                  </>
                )}
                {finalTags.map((t) => (
                  <span
                    key={`new-${t}`}
                    className={cn(
                      'inline-flex items-center px-1.5 h-4 rounded text-[10px]',
                      'bg-brand/10 text-brand',
                    )}
                  >
                    {t}
                  </span>
                ))}
                <button
                  type="button"
                  onClick={startEdit}
                  className="text-[10px] text-slate-400 hover:text-brand ml-1"
                  title="编辑"
                >
                  ✎
                </button>
                {edited && (
                  <button
                    type="button"
                    onClick={() => resetEdit(suggestion.bookmarkId)}
                    className="text-[10px] text-slate-400 hover:text-slate-600"
                    title="还原 AI 建议"
                  >
                    ↶
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Stage: applying / done / error ── */

function ApplyingStage() {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 gap-3 text-center">
      <div className="text-4xl animate-pulse">⏳</div>
      <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">
        正在写入标签…
      </h3>
    </div>
  )
}

function DoneStage() {
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

function ErrorStage() {
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

/* ═══════════════════════════════════════════════════════════
 * SECTION 2: 标签管理（改名 / 合并 / 删除）
 * ═══════════════════════════════════════════════════════════ */

function ManageSection() {
  const cards = useBookmarkStore((s) => s.cards)
  const renameTag = useBookmarkStore((s) => s.renameTag)
  const mergeTags = useBookmarkStore((s) => s.mergeTags)
  const removeTag = useBookmarkStore((s) => s.removeTag)
  const setSearchKeyword = useBookmarkStore((s) => s.setSearchKeyword)

  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /** 改名表单：{ tag: newName }；只有一个 tag 在 hover 时显示 */
  const [renamingTag, setRenamingTag] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  // 搜索 keyword 改变时，清掉已选（避免视觉错位）
  useEffect(() => {
    if (keyword) setSelected(new Set())
  }, [keyword])

  const usage = useMemo(() => collectTagUsage(cards), [cards])
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return usage
    return usage.filter((u) => u.tag.toLowerCase().includes(kw))
  }, [usage, keyword])

  const toggleSelect = (tag: string) => {
    const next = new Set(selected)
    next.has(tag) ? next.delete(tag) : next.add(tag)
    setSelected(next)
  }

  const handleStartRename = (tag: string) => {
    setRenamingTag(tag)
    setRenameDraft(tag)
  }
  const handleCommitRename = async () => {
    const t = renamingTag
    const next = renameDraft.trim()
    setRenamingTag(null)
    if (!t || !next || next === t) return
    await renameTag(t, next)
    toast.success('已改名', `${t} → ${next}`)
  }

  const handleRemove = async (tag: string) => {
    if (
      !(await confirmDialog({
        title: `删除标签「${tag}」？`,
        message: '将从全库所有卡片中移除此标签（仅清除关联，不删除卡片）。',
        confirmText: '删除',
        danger: true,
      }))
    )
      return
    await removeTag(tag)
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(tag)
      return next
    })
    toast.success('已删除', `「${tag}」已从所有卡片移除`)
  }

  const handleMerge = async () => {
    if (selected.size < 2) return
    const list = Array.from(selected)
    const target = await promptDialog({
      title: `合并 ${list.length} 个标签`,
      message: `将合并：${list.join(', ')}\n请输入目标标签名（可以是其中之一，也可以是新名）`,
      defaultValue: list[0],
      placeholder: '目标标签名',
      validate: (v) => (v.trim() ? null : '请输入目标标签名'),
    })
    if (!target?.trim()) return
    const t = target.trim()
    await mergeTags(list, t)
    setSelected(new Set())
    toast.success('已合并', `${list.join(', ')} → ${t}`)
  }

  const totalTagged = useMemo(
    () => cards.filter((c) => c.tags && c.tags.length > 0).length,
    [cards],
  )

  return (
    <div className="flex flex-col h-full">
      {/* 顶部统计 + 搜索 */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 space-y-1.5 shrink-0">
        <div className="text-[11px] text-slate-400">
          全库 <span className="tabular-nums text-slate-600 dark:text-slate-300">{usage.length}</span> 个不同标签
          {' · '}覆盖{' '}
          <span className="tabular-nums text-slate-600 dark:text-slate-300">{totalTagged}</span> 张卡片
          （共 {cards.length}）
        </div>
        <div className="flex items-center gap-1.5">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="过滤标签…"
            className={cn(
              'flex-1 h-7 px-2 text-xs rounded',
              'bg-white dark:bg-slate-900',
              'border border-slate-200 dark:border-slate-700',
              'focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
            )}
          />
          {keyword && (
            <button
              type="button"
              onClick={() => setKeyword('')}
              className="text-xs text-slate-400 hover:text-slate-600 px-1"
              title="清空"
            >
              ✕
            </button>
          )}
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-slate-500">已选 {selected.size} 个</span>
            <button
              type="button"
              onClick={() => void handleMerge()}
              disabled={selected.size < 2}
              className={cn(
                'px-2 py-0.5 rounded text-xs',
                selected.size >= 2
                  ? 'bg-brand text-white hover:bg-brand-600'
                  : 'bg-slate-200 text-slate-400 dark:bg-slate-700 cursor-not-allowed',
              )}
              title="合并选中的标签"
            >
              ⊕ 合并
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-slate-400 hover:text-slate-600"
            >
              清除选择
            </button>
          </div>
        )}
      </div>

      {/* 标签列表 */}
      <div className="flex-1 overflow-auto p-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-xs text-slate-400">
            {usage.length === 0
              ? '还没有任何标签 —— 试试在「批量打标签」里让 AI 来打'
              : '没有匹配的标签'}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map(({ tag, count }) => (
              <li
                key={tag}
                className={cn(
                  'group flex items-center gap-2 px-2 py-1.5 rounded text-xs',
                  'hover:bg-slate-50 dark:hover:bg-slate-800/40',
                )}
              >
                <input
                  type="checkbox"
                  checked={selected.has(tag)}
                  onChange={() => toggleSelect(tag)}
                  className="shrink-0 accent-brand cursor-pointer"
                  aria-label={`选择 ${tag}`}
                />
                {renamingTag === tag ? (
                  <input
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => void handleCommitRename()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleCommitRename()
                      if (e.key === 'Escape') setRenamingTag(null)
                    }}
                    className="flex-1 h-6 px-1.5 rounded bg-white dark:bg-slate-900 border border-brand outline-none focus:ring-1 focus:ring-brand/30"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setSearchKeyword(`#${tag}`)}
                    className="flex-1 text-left truncate text-slate-700 dark:text-slate-200 hover:text-brand"
                    title={`筛选含「${tag}」的书签`}
                  >
                    <span className="text-brand">#</span>
                    {tag}
                  </button>
                )}
                <span className="shrink-0 tabular-nums text-slate-400 text-[10px]">
                  {count}
                </span>
                <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <IconBtn
                    title="改名"
                    onClick={() => handleStartRename(tag)}
                  >
                    ✎
                  </IconBtn>
                  <IconBtn
                    title="从全库删除此标签"
                    onClick={() => void handleRemove(tag)}
                    danger
                  >
                    ✕
                  </IconBtn>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'w-5 h-5 inline-flex items-center justify-center rounded text-[11px]',
        danger
          ? 'text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10'
          : 'text-slate-400 hover:text-brand hover:bg-brand/10',
      )}
    >
      {children}
    </button>
  )
}

/* ═══════════════════════════════════════════════════════════
 * 公共辅助
 * ═══════════════════════════════════════════════════════════ */

function NoAINotice() {
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

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md px-3 py-2 text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 leading-relaxed">
      {children}
    </div>
  )
}

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
