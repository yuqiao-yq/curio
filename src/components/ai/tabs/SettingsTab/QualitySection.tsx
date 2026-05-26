import { useMemo, useState } from 'react'
import { useBookmarkStore } from '../../../../stores/useBookmarkStore'
import { useQualityStore } from '../../../../ai/services/useQualityStore'
import {
  scanQuality,
  type DuplicateGroup,
  type QualityReport,
  type ScanPhase,
} from '../../../../ai/services/quality'
import { cn } from '../../../../utils/cn'
import { toast } from '../../../../stores/useToastStore'
import { confirmDialog } from '../../../Dialog'
import { ActionBtn } from './shared'
import { isImageIcon } from '../../../../utils/icon'

/* ─────────────────────────────────────────────────────────────
 * 整理质检 section（V2.0 §6.4 重复 / 失效检测）
 *
 * 三色分组：🔴 失效 · 🟡 疑似重复 · 🔵 长期未访问 (≥6 月)
 * 用户勾选后批量删除 / 移动到指定分类。
 *
 * 内部组件（ScanProgressBar / QualityPreview / GroupBlock / CardRow /
 * DuplicateGroupRow / Color）只服务于本 section，全部 file-private。
 * ───────────────────────────────────────────────────────────── */

export function QualitySection() {
  const cards = useBookmarkStore((s) => s.cards)
  const categories = useBookmarkStore((s) => s.categories)
  const removeCard = useBookmarkStore((s) => s.removeCard)
  const moveCard = useBookmarkStore((s) => s.moveCard)

  const stage = useQualityStore((s) => s.stage)
  const scanPhase = useQualityStore((s) => s.scanPhase)
  const scanProgress = useQualityStore((s) => s.scanProgress)
  const report = useQualityStore((s) => s.report)
  const errorMessage = useQualityStore((s) => s.errorMessage)
  const selected = useQualityStore((s) => s.selected)
  const startScan = useQualityStore((s) => s.startScan)
  const setScanProgress = useQualityStore((s) => s.setScanProgress)
  const goPreview = useQualityStore((s) => s.goPreview)
  const goApplying = useQualityStore((s) => s.goApplying)
  const goDone = useQualityStore((s) => s.goDone)
  const goError = useQualityStore((s) => s.goError)
  const reset = useQualityStore((s) => s.reset)
  const cancel = useQualityStore((s) => s.cancel)
  const toggleSelect = useQualityStore((s) => s.toggleSelect)
  const selectAll = useQualityStore((s) => s.selectAll)
  const clearSelection = useQualityStore((s) => s.clearSelection)

  const [archiveCategoryId, setArchiveCategoryId] = useState<string>('')
  const flatCategories = useMemo(
    () =>
      categories
        .filter((c) => !c.parentId)
        .sort((a, b) => a.order - b.order),
    [categories],
  )

  const running = stage === 'scanning' || stage === 'applying'

  const handleScan = async () => {
    const controller = new AbortController()
    startScan(controller)
    try {
      const r = await scanQuality({
        cards,
        signal: controller.signal,
        onProgress: setScanProgress,
      })
      goPreview(r)
      const totalIssues =
        r.deadCards.length +
        r.duplicateGroups.reduce((s, g) => s + g.cards.length, 0) +
        r.staleCards.length
      if (totalIssues === 0) {
        toast.success('质检完成', '没有发现需要处理的问题')
      } else {
        toast.info(
          '质检完成',
          `发现 ${r.deadCards.length} 失效 · ${r.duplicateGroups.length} 重复组 · ${r.staleCards.length} 长期未访问`,
        )
      }
    } catch (err) {
      if (controller.signal.aborted) {
        reset()
        return
      }
      const msg = err instanceof Error ? err.message : '未知错误'
      goError(msg)
      toast.error('质检失败', msg)
    }
  }

  const handleDelete = async () => {
    if (selected.size === 0) return
    if (
      !(await confirmDialog({
        title: `删除选中的 ${selected.size} 张卡片？`,
        message: '将从书签库永久删除（IndexedDB 中的 embedding / 正文索引也会被自然清理）。',
        confirmText: '删除',
        danger: true,
      }))
    )
      return
    goApplying()
    try {
      for (const id of selected) {
        // 跳过已不存在的（防御）
        if (cards.some((c) => c.id === id)) {
          await removeCard(id)
        }
      }
      goDone()
      toast.success('已删除', `${selected.size} 张卡片`)
      // 自动重新扫描会很重；提示用户手动重扫
      reset()
    } catch (err) {
      goError(err instanceof Error ? err.message : '未知错误')
      toast.error('批量删除失败', err instanceof Error ? err.message : '')
    }
  }

  const handleArchive = async () => {
    if (selected.size === 0) return
    if (!archiveCategoryId) {
      toast.warning('请先选择目标分类', '在右侧下拉选一个"归档"分类')
      return
    }
    goApplying()
    try {
      let moved = 0
      for (const id of selected) {
        const c = cards.find((x) => x.id === id)
        if (!c) continue
        if (c.categoryId === archiveCategoryId) continue // 已经在了
        // 放到目标分类末尾
        const targetCount = cards.filter(
          (x) => x.categoryId === archiveCategoryId,
        ).length
        await moveCard(id, archiveCategoryId, targetCount)
        moved++
      }
      goDone()
      const targetName =
        categories.find((c) => c.id === archiveCategoryId)?.name ?? '?'
      toast.success('已归档', `${moved} 张卡片移到 ${targetName}`)
      reset()
    } catch (err) {
      goError(err instanceof Error ? err.message : '未知错误')
      toast.error('批量归档失败', err instanceof Error ? err.message : '')
    }
  }

  return (
    <section>
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
        整理质检
      </h4>
      <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
        扫描书签库找出三类问题：
        <Color tone="red">🔴 失效</Color> ·{' '}
        <Color tone="amber">🟡 重复</Color> ·{' '}
        <Color tone="blue">🔵 长期未访问</Color>。
        失效检测会发起 HEAD 请求；内容相似度基于已生成的 embedding。
      </p>

      {/* idle / done / error 时显示扫描入口 */}
      {!running && stage !== 'preview' && (
        <div className="flex items-center gap-1.5">
          <ActionBtn
            primary
            disabled={cards.length === 0}
            onClick={() => void handleScan()}
            title={
              cards.length === 0
                ? '没有书签可扫描'
                : '开始全库质检（HEAD 请求 + embedding 比对）'
            }
          >
            🩺 开始质检
          </ActionBtn>
        </div>
      )}

      {/* 扫描进度 */}
      {stage === 'scanning' && (
        <ScanProgressBar phase={scanPhase} progress={scanProgress} onCancel={cancel} />
      )}

      {/* 错误 */}
      {stage === 'error' && (
        <div className="mt-2 rounded-md border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-600 dark:text-red-300 break-words">
          {errorMessage}
          <button
            type="button"
            onClick={reset}
            className="ml-2 underline hover:no-underline"
          >
            知道了
          </button>
        </div>
      )}

      {/* 预览 + 批量操作 */}
      {stage === 'preview' && report && (
        <QualityPreview
          report={report}
          selected={selected}
          onToggle={toggleSelect}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          flatCategories={flatCategories}
          archiveCategoryId={archiveCategoryId}
          onPickArchive={setArchiveCategoryId}
          onDelete={() => void handleDelete()}
          onArchive={() => void handleArchive()}
          onCancel={reset}
        />
      )}

      {/* applying */}
      {stage === 'applying' && (
        <div className="mt-2 text-[11px] text-slate-400 px-2 py-1.5 bg-slate-50 dark:bg-slate-800/40 rounded">
          ⏳ 正在执行批量操作…
        </div>
      )}
    </section>
  )
}

const PHASE_LABEL: Record<ScanPhase, string> = {
  init: '准备中',
  duplicate: '检测 URL 重复',
  stale: '识别长期未访问',
  dead: '失效检测（HEAD 请求）',
  similar: '内容相似度比对',
}

function ScanProgressBar({
  phase,
  progress,
  onCancel,
}: {
  phase: ScanPhase
  progress: { done: number; total: number }
  onCancel: () => void
}) {
  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <div className="mt-2 rounded-md border border-brand/30 bg-brand/5 px-2.5 py-2 space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-brand font-medium">🩺 {PHASE_LABEL[phase]}…</span>
        <span className="tabular-nums text-slate-500">
          {progress.done} / {progress.total} ({pct}%)
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div
          className="h-full bg-brand transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="text-[10px] text-slate-400 hover:text-red-500"
      >
        取消扫描
      </button>
    </div>
  )
}

function QualityPreview({
  report,
  selected,
  onToggle,
  onSelectAll,
  onClearSelection,
  flatCategories,
  archiveCategoryId,
  onPickArchive,
  onDelete,
  onArchive,
  onCancel,
}: {
  report: QualityReport
  selected: Set<string>
  onToggle: (id: string) => void
  onSelectAll: (ids: string[]) => void
  onClearSelection: () => void
  flatCategories: Array<{ id: string; name: string; icon?: string }>
  archiveCategoryId: string
  onPickArchive: (id: string) => void
  onDelete: () => void
  onArchive: () => void
  onCancel: () => void
}) {
  // 收集所有被分组覆盖的 cardId（给"全选"按钮用）
  const allIds = useMemo(() => {
    const ids = new Set<string>()
    for (const g of report.duplicateGroups) {
      // 重复组：默认全选除"第一个"以外的（保留代表）
      const sorted = [...g.cards].sort((a, b) => a.id.localeCompare(b.id))
      sorted.slice(1).forEach((c) => ids.add(c.id))
    }
    for (const d of report.deadCards) ids.add(d.card.id)
    for (const s of report.staleCards) ids.add(s.id)
    return Array.from(ids)
  }, [report])

  return (
    <div className="mt-2 space-y-3 text-xs">
      {/* 顶部：统计 + 全选 */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span>
          已选 <span className="tabular-nums font-medium text-slate-700 dark:text-slate-200">{selected.size}</span> /{' '}
          {allIds.length}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onSelectAll(allIds)}
          className="text-brand hover:underline"
        >
          全选可处理
        </button>
        <span className="text-slate-300">·</span>
        <button
          type="button"
          onClick={onClearSelection}
          className="text-slate-500 hover:text-red-500"
        >
          清空选择
        </button>
      </div>

      {/* 失效 */}
      {report.deadCards.length > 0 && (
        <GroupBlock
          title="🔴 失效"
          tone="red"
          count={report.deadCards.length}
        >
          {report.deadCards.map((d) => (
            <CardRow
              key={d.card.id}
              cardId={d.card.id}
              title={d.card.title}
              url={d.card.url}
              hint={d.error}
              checked={selected.has(d.card.id)}
              onToggle={() => onToggle(d.card.id)}
            />
          ))}
        </GroupBlock>
      )}

      {/* 重复组 */}
      {report.duplicateGroups.length > 0 && (
        <GroupBlock
          title="🟡 疑似重复"
          tone="amber"
          count={report.duplicateGroups.length}
        >
          {report.duplicateGroups.map((g) => (
            <DuplicateGroupRow
              key={g.groupId}
              group={g}
              selected={selected}
              onToggle={onToggle}
            />
          ))}
        </GroupBlock>
      )}

      {/* 长期未访问 */}
      {report.staleCards.length > 0 && (
        <GroupBlock
          title="🔵 长期未访问 (≥ 6 月)"
          tone="blue"
          count={report.staleCards.length}
        >
          {report.staleCards.map((c) => (
            <CardRow
              key={c.id}
              cardId={c.id}
              title={c.title}
              url={c.url}
              hint={`updatedAt: ${new Date(c.updatedAt).toLocaleDateString()}`}
              checked={selected.has(c.id)}
              onToggle={() => onToggle(c.id)}
            />
          ))}
        </GroupBlock>
      )}

      {/* 没有任何问题 */}
      {report.deadCards.length === 0 &&
        report.duplicateGroups.length === 0 &&
        report.staleCards.length === 0 && (
          <div className="text-slate-400 text-center py-4">
            ✨ 全部通过，无需处理
          </div>
        )}

      {/* 底部操作 */}
      <div className="border-t border-slate-200 dark:border-slate-700 pt-2 mt-3 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <ActionBtn
            danger
            disabled={selected.size === 0}
            onClick={onDelete}
            title="把选中卡片永久删除"
          >
            🗑 批量删除 ({selected.size})
          </ActionBtn>
          <select
            value={archiveCategoryId}
            onChange={(e) => onPickArchive(e.target.value)}
            className={cn(
              'h-7 px-2 text-xs rounded border bg-white dark:bg-slate-900',
              'border-slate-200 dark:border-slate-700',
              'outline-none focus:border-brand',
            )}
          >
            <option value="">归档到…</option>
            {flatCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {isImageIcon(c.icon) ? '📁' : (c.icon ?? '📁')} {c.name}
              </option>
            ))}
          </select>
          <ActionBtn
            disabled={selected.size === 0 || !archiveCategoryId}
            onClick={onArchive}
            title="把选中卡片移动到所选分类"
          >
            📦 归档 ({selected.size})
          </ActionBtn>
          <div className="flex-1" />
          <ActionBtn onClick={onCancel} title="放弃本次质检结果">
            关闭
          </ActionBtn>
        </div>
        <p className="text-[10px] text-slate-400">
          扫描元信息：{report.meta.totalCards} 卡片 · embedding 对比{' '}
          {report.meta.embeddingPairs.toLocaleString()} 次 · 用时{' '}
          {(report.meta.durationMs / 1000).toFixed(1)}s
        </p>
      </div>
    </div>
  )
}

function GroupBlock({
  title,
  tone,
  count,
  children,
}: {
  title: string
  tone: 'red' | 'amber' | 'blue'
  count: number
  children: React.ReactNode
}) {
  const headerCls =
    tone === 'red'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'amber'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-sky-600 dark:text-sky-400'
  return (
    <div>
      <div className={cn('text-[11px] font-medium mb-1', headerCls)}>
        {title}
        <span className="ml-1 tabular-nums opacity-70">({count})</span>
      </div>
      <div
        className={cn(
          'rounded-md border bg-slate-50/60 dark:bg-slate-800/30',
          'border-slate-200 dark:border-slate-700',
          'divide-y divide-slate-200 dark:divide-slate-700/60',
          'max-h-[180px] overflow-auto',
        )}
      >
        {children}
      </div>
    </div>
  )
}

function CardRow({
  cardId,
  title,
  url,
  hint,
  checked,
  onToggle,
  badge,
}: {
  cardId: string
  title: string
  url: string
  hint?: string
  checked: boolean
  onToggle: () => void
  badge?: React.ReactNode
}) {
  return (
    <label
      htmlFor={`qc-${cardId}`}
      className={cn(
        'flex items-start gap-2 px-2 py-1.5 cursor-pointer text-[11px]',
        'hover:bg-slate-100 dark:hover:bg-slate-800/40',
      )}
    >
      <input
        id={`qc-${cardId}`}
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-0.5 shrink-0 accent-brand"
      />
      <div className="flex-1 min-w-0">
        <div className="text-slate-700 dark:text-slate-200 truncate font-medium">
          {title || '(无标题)'}
        </div>
        <div className="text-slate-400 truncate font-mono text-[10px]" title={url}>
          {url}
        </div>
        {hint && (
          <div className="text-amber-600 dark:text-amber-400 truncate" title={hint}>
            {hint}
          </div>
        )}
      </div>
      {badge}
    </label>
  )
}

function DuplicateGroupRow({
  group,
  selected,
  onToggle,
}: {
  group: DuplicateGroup
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  const isSimilar = group.kind === 'similar_content'
  return (
    <div className="px-2 py-1.5">
      <div className="text-[10px] text-slate-500 mb-0.5">
        {isSimilar ? '内容相似' : 'URL 完全一致'}
        {' · '}
        <span className="tabular-nums">{group.cards.length}</span> 项
        {isSimilar && group.minScore !== undefined && (
          <>
            {' · 最低相似度 '}
            <span className="tabular-nums text-fuchsia-500">
              {(group.minScore * 100).toFixed(0)}%
            </span>
          </>
        )}
      </div>
      <div className="space-y-0.5">
        {group.cards.map((c, i) => (
          <CardRow
            key={c.id}
            cardId={c.id}
            title={c.title}
            url={c.url}
            checked={selected.has(c.id)}
            onToggle={() => onToggle(c.id)}
            badge={
              i === 0 ? (
                <span
                  className="text-[9px] text-emerald-600 dark:text-emerald-400 shrink-0"
                  title="组内最早的卡片，默认建议保留它"
                >
                  保留
                </span>
              ) : undefined
            }
          />
        ))}
      </div>
    </div>
  )
}

function Color({
  tone,
  children,
}: {
  tone: 'red' | 'amber' | 'blue'
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        tone === 'red'
          ? 'text-red-500'
          : tone === 'amber'
            ? 'text-amber-500'
            : 'text-sky-500',
      )}
    >
      {children}
    </span>
  )
}
