import { useEffect, useMemo, useState } from 'react'
import {
  useAISettingsStore,
  PROVIDER_PRESETS,
  PROVIDER_GROUP_LABEL,
  type ProviderGroup,
} from '../../../ai/useAISettingsStore'
import { testConnection } from '../../../ai/manager'
import type { AIProviderConfig } from '../../../ai/types'
import { isAIConfigured } from '../../../ai/types'
import { cn } from '../../../utils/cn'
import { toast } from '../../../stores/useToastStore'
import { confirmDialog } from '../../Dialog'
import { useBookmarkStore } from '../../../stores/useBookmarkStore'
import { useEmbedderStore } from '../../../ai/services/useEmbedderStore'
import {
  cleanOrphans,
  computeEmbedStatus,
  runEmbed,
  type EmbedStatus,
} from '../../../ai/services/embedder'
import { clearEmbeddings } from '../../../repositories/EmbeddingsDB'
import { useCrawlerStore } from '../../../ai/services/useCrawlerStore'
import {
  CRAWL_RANGE_LABEL,
  type CrawlRange,
  isCrawlableUrl,
  runCrawler,
  selectCardsForCrawling,
} from '../../../ai/services/crawler'
import {
  clearPageContents,
  countByStatus,
} from '../../../repositories/PageContentsDB'
import { usePageIndex } from '../../../ai/services/usePageIndex'
import { useSummarizerStore } from '../../../ai/services/useSummarizerStore'
import {
  SUMMARY_RANGE_LABEL,
  type SummaryRange,
  runSummarizer,
  selectCardsForSummarizing,
} from '../../../ai/services/summarizer'
import { useQualityStore } from '../../../ai/services/useQualityStore'
import {
  scanQuality,
  type DuplicateGroup,
  type QualityReport,
  type ScanPhase,
} from '../../../ai/services/quality'

/**
 * AI 设置 Tab
 *
 * 三段式布局：
 * 1. 顶部：总开关 + 隐私 / 本地优先选项
 * 2. 中间：Provider 列表（每条可改名 / 改路由 / 删除 / 测试连接）
 * 3. 底部：「+ 添加 Provider」展开预设选择 + 自定义表单
 *
 * Provider 详细字段使用展开折叠样式，避免长表单堆在一起。
 */
export function SettingsTab() {
  const settings = useAISettingsStore()
  const configured = isAIConfigured(settings)

  const [adding, setAdding] = useState(false)

  return (
    <div className="p-3 space-y-4 text-sm">
      {/* ─── 状态总览 ─── */}
      <div
        className={cn(
          'rounded-md px-3 py-2 text-xs',
          configured
            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40'
            : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40',
        )}
      >
        {configured ? (
          <>✓ AI 已就绪，可以开始使用整理 / 标签 / 对话等功能</>
        ) : (
          <>⚠ 还未配置可用的 AI Provider，下方添加一个即可开始</>
        )}
      </div>

      {/* ─── 总开关与隐私 ─── */}
      <section>
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
          通用
        </h4>
        <div className="space-y-1.5">
          <ToggleRow
            label="启用 AI 功能"
            description="关闭时所有 AI 入口（FAB / 浮窗 / popup ✨）都不工作"
            checked={settings.enabled}
            onChange={settings.setEnabled}
          />
          <ToggleRow
            label="匿名模式"
            description="发送给 AI 时只发域名，不发完整 URL"
            checked={settings.privacy.anonymousMode}
            onChange={(v) => settings.patchPrivacy({ anonymousMode: v })}
          />
          <ToggleRow
            label="操作前显示成本估算"
            description="每次 AI 操作前先确认本次大约消耗多少 tokens"
            checked={settings.privacy.showCostEstimate}
            onChange={(v) => settings.patchPrivacy({ showCostEstimate: v })}
          />
          <ToggleRow
            label="优先使用浏览器内置 AI"
            description="可用时优先走 Chrome 内置 Gemini Nano（仅 Chrome 138+）"
            checked={settings.preferLocal}
            onChange={settings.setPreferLocal}
          />
          <ToggleRow
            label="被动整理建议"
            description="新增书签累计 ≥ 10 条 + 距上次提示 ≥ 7 天 时，FAB 红点 + 浮窗顶部横幅"
            checked={settings.passiveSuggest}
            onChange={settings.setPassiveSuggest}
          />
        </div>
      </section>

      {/* ─── Provider 列表 ─── */}
      <section>
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
          AI Provider
        </h4>
        {settings.providers.length === 0 ? (
          <div className="text-xs text-slate-400 px-2 py-3 text-center">
            还没有 Provider，点下方「+ 添加」开始
          </div>
        ) : (
          <div className="space-y-2">
            {settings.providers.map((p) => (
              <ProviderRow key={p.id} config={p} />
            ))}
          </div>
        )}

        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={cn(
              'mt-2 w-full py-1.5 rounded-md text-xs font-medium',
              'border border-dashed border-slate-300 dark:border-slate-600',
              'text-slate-500 dark:text-slate-400',
              'hover:border-brand hover:text-brand transition-colors',
            )}
          >
            + 添加 Provider
          </button>
        ) : (
          <AddProviderForm
            onClose={() => setAdding(false)}
            onAdded={() => setAdding(false)}
          />
        )}
      </section>

      {/* ─── 路由（任务 → Provider） ─── */}
      {settings.providers.length >= 2 && (
        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
            任务路由
          </h4>
          <p className="text-[11px] text-slate-400 mb-2">
            可以为不同任务指定不同 Provider，例如对话用强模型，整理 / 标签用便宜模型
          </p>
          <div className="space-y-1.5">
            <RouteRow task="chat" label="对话 / 总结" />
            <RouteRow task="organize" label="整理 / 分类" />
            <RouteRow task="embedding" label="Embedding" />
          </div>
        </section>
      )}

      {/* ─── Embedding 管理（V1.5 §5.1 语义搜索） ─── */}
      {configured && <EmbeddingSection />}

      {/* ─── 内容抓取（V2.0 §6.1 网页正文索引） ─── */}
      <CrawlSection />

      {/* ─── AI 自动备注（V2.0 §6.3） ─── */}
      {configured && <SummarySection />}

      {/* ─── 整理质检（V2.0 §6.4 重复 / 失效检测） ─── */}
      <QualitySection />

      <p className="text-[11px] text-slate-400 leading-relaxed">
        🔒 你的 API Key 仅保存在本机 chrome.storage.local，永不上传，
        也不会出现在导出的 JSON 数据里。
      </p>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * Embedding 管理 section（§5.1）
 *
 * 状态展示 + 三个动作：
 * - 「补缺」：仅为缺失 / stale 的卡片生成（增量、低成本，推荐）
 * - 「全部重生成」：清空整库后从头跑（切换模型 / 大改后用）
 * - 「清空」：删除所有 embedding（不会再走语义搜索）
 *
 * 进度态用 useEmbedderStore 跟踪，可中途取消。
 * ───────────────────────────────────────────────────────────── */

function EmbeddingSection() {
  const settings = useAISettingsStore()
  const cards = useBookmarkStore((s) => s.cards)
  const stage = useEmbedderStore((s) => s.stage)
  const progress = useEmbedderStore((s) => s.progress)
  const lastResult = useEmbedderStore((s) => s.lastResult)
  const errorMessage = useEmbedderStore((s) => s.errorMessage)
  const start = useEmbedderStore((s) => s.start)
  const setProgress = useEmbedderStore((s) => s.setProgress)
  const finish = useEmbedderStore((s) => s.finish)
  const fail = useEmbedderStore((s) => s.fail)
  const cancel = useEmbedderStore((s) => s.cancel)
  const reset = useEmbedderStore((s) => s.reset)

  const [status, setStatus] = useState<EmbedStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)

  // 拉一次状态：mount 时 + 任务结束后 + cards / settings 变了
  // computeEmbedStatus 是异步，不能放在 useMemo 里
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setStatusLoading(true)
      try {
        const s = await computeEmbedStatus(cards, settings)
        if (!cancelled) setStatus(s)
      } finally {
        if (!cancelled) setStatusLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // 任务从 running → done/error 时自动刷新状态
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, settings.providers, settings.routing.embedding, stage])

  const handleRun = async (mode: 'all' | 'missing') => {
    if (mode === 'all') {
      const ok = await confirmDialog({
        title: '确认全量重生成 embedding？',
        message:
          '这会清空当前所有 embedding 并重新调 API（按书签数量计费）。\n建议仅在切换 embedding 模型 / 大批量改了卡片后使用。',
        confirmText: '全量重生成',
        danger: true,
      })
      if (!ok) return
    }
    const controller = new AbortController()
    start(mode, controller)
    try {
      const result = await runEmbed({
        mode,
        cards,
        settings,
        signal: controller.signal,
        onProgress: setProgress,
      })
      finish(result)
      if (result.errors.length > 0) {
        toast.warning(
          'Embedding 部分失败',
          `成功 ${result.saved} / ${result.generated} 条；${result.errors.length} 个批次失败`,
        )
      } else if (result.saved > 0) {
        toast.success(
          'Embedding 已生成',
          `${result.saved} 条 · model=${result.model}`,
        )
      } else {
        toast.info('无可生成项', '所有书签的 embedding 都已是最新')
      }
    } catch (err) {
      if (controller.signal.aborted) {
        reset()
        return
      }
      const msg = err instanceof Error ? err.message : '未知错误'
      fail(msg)
      toast.error('Embedding 任务失败', msg)
    }
  }

  const handleClear = async () => {
    const ok = await confirmDialog({
      title: '清空所有 embedding？',
      message:
        '清空后语义搜索会回退到普通 substring 搜索，直到再次生成。',
      confirmText: '清空',
      danger: true,
    })
    if (!ok) return
    await clearEmbeddings()
    toast.success('已清空', 'Embedding 库已重置')
    setStatus(null)
    reset()
  }

  const handleCleanOrphans = async () => {
    const removed = await cleanOrphans(cards)
    if (removed === 0) {
      toast.info('无孤立行', '所有 embedding 都对应着现有书签')
    } else {
      toast.success('已清理', `删掉 ${removed} 条孤立 embedding`)
    }
    reset()
  }

  const running = stage === 'running'
  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <section>
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
        Embedding 管理
      </h4>
      <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
        生成后可在搜索框输入 <code className="font-mono text-slate-500">@ai 关键字</code> 跨标题/标签做语义搜索。
        新增 / 修改书签后会自动标记为待补，点「补缺」即可增量更新。
      </p>

      {/* 状态网格 */}
      <div
        className={cn(
          'rounded-md border p-2.5 text-xs',
          'bg-slate-50 dark:bg-slate-800/40',
          'border-slate-200 dark:border-slate-700',
        )}
      >
        {statusLoading && !status ? (
          <div className="text-slate-400 py-1">读取索引状态…</div>
        ) : status ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <StatRow label="书签总数" value={status.totalCards} />
            <StatRow
              label="已索引"
              value={status.indexedCards}
              tone={status.indexedCards === status.totalCards ? 'ok' : 'normal'}
            />
            <StatRow
              label="待补缺"
              value={status.missingCards}
              tone={status.missingCards > 0 ? 'warn' : 'ok'}
            />
            <StatRow
              label="内容已变 (stale)"
              value={status.staleCards}
              tone={status.staleCards > 0 ? 'warn' : 'ok'}
            />
            {status.mismatchCards > 0 && (
              <StatRow
                label="模型不一致"
                value={status.mismatchCards}
                tone="warn"
              />
            )}
            {status.orphanRows > 0 && (
              <StatRow label="孤立行" value={status.orphanRows} tone="warn" />
            )}
            {status.currentModel && (
              <div className="col-span-2 flex items-center justify-between gap-2 pt-1 mt-1 border-t border-slate-200 dark:border-slate-700/60">
                <span className="text-slate-400">使用模型</span>
                <span className="font-mono text-[10px] text-slate-500 dark:text-slate-300 truncate">
                  {status.currentModel}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-slate-400 py-1">暂无数据</div>
        )}
      </div>

      {/* 进度条（运行中） */}
      {running && (
        <div className="mt-2 rounded-md border border-brand/30 bg-brand/5 px-2.5 py-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-brand font-medium">
              ✨ 正在生成 embedding…
            </span>
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
            onClick={cancel}
            className="text-[10px] text-slate-400 hover:text-red-500"
          >
            取消任务
          </button>
        </div>
      )}

      {/* 错误条 */}
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

      {/* 上次结果摘要 */}
      {stage === 'done' && lastResult && (
        <div className="mt-2 rounded-md border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
          ✓ 上次任务：成功 {lastResult.saved} / {lastResult.generated} 条
          {lastResult.errors.length > 0 && (
            <span className="text-amber-600 dark:text-amber-300">
              ，{lastResult.errors.length} 批失败
            </span>
          )}
        </div>
      )}

      {/* 操作按钮区 */}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <ActionBtn
          primary
          disabled={running || !status || status.missingCards + status.staleCards === 0}
          onClick={() => void handleRun('missing')}
          title={
            status && status.missingCards + status.staleCards === 0
              ? '所有 embedding 都已是最新'
              : '为缺失 / 内容变化的卡片生成 embedding'
          }
        >
          ✨ 补缺
          {status && status.missingCards + status.staleCards > 0 && (
            <span className="ml-1 tabular-nums opacity-80">
              ({status.missingCards + status.staleCards})
            </span>
          )}
        </ActionBtn>
        <ActionBtn
          disabled={running || !status || status.totalCards === 0}
          onClick={() => void handleRun('all')}
          title="清空后从头跑（切换模型 / 大改时用）"
        >
          全部重生成
        </ActionBtn>
        {status && status.orphanRows > 0 && (
          <ActionBtn
            disabled={running}
            onClick={() => void handleCleanOrphans()}
            title="删除已被删除卡片对应的孤立 embedding 行"
          >
            清理孤立 ({status.orphanRows})
          </ActionBtn>
        )}
        <div className="flex-1" />
        <ActionBtn
          danger
          disabled={running || !status || status.indexedCards === 0}
          onClick={() => void handleClear()}
          title="清空所有 embedding（不删书签本身）"
        >
          清空
        </ActionBtn>
      </div>
    </section>
  )
}

function StatRow({
  label,
  value,
  tone = 'normal',
}: {
  label: string
  value: number | string
  tone?: 'normal' | 'ok' | 'warn'
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span
        className={cn(
          'tabular-nums font-medium',
          tone === 'ok'
            ? 'text-emerald-600 dark:text-emerald-400'
            : tone === 'warn'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-slate-700 dark:text-slate-200',
        )}
      >
        {value}
      </span>
    </div>
  )
}

function ActionBtn({
  children,
  onClick,
  disabled,
  primary,
  danger,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  primary?: boolean
  danger?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'h-7 px-2.5 inline-flex items-center justify-center rounded text-xs font-medium transition-colors',
        disabled
          ? 'bg-slate-100 dark:bg-slate-700 text-slate-400 cursor-not-allowed'
          : primary
            ? 'bg-brand text-white hover:bg-brand-600'
            : danger
              ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 border border-red-200 dark:border-red-500/30'
              : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand hover:text-brand',
      )}
    >
      {children}
    </button>
  )
}

/* ─────────────────────────────────────────────────────────────
 * 辅助组件：开关行
 * ───────────────────────────────────────────────────────────── */

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'w-full flex items-start gap-3 p-2 rounded-md text-left',
        'hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors',
      )}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm text-slate-700 dark:text-slate-200">{label}</div>
        {description && (
          <div className="text-[11px] text-slate-400 mt-0.5">{description}</div>
        )}
      </div>
      {/* iOS 风格开关 */}
      <span
        className={cn(
          'shrink-0 relative inline-block w-9 h-5 rounded-full transition-colors',
          checked ? 'bg-brand' : 'bg-slate-300 dark:bg-slate-600',
        )}
        aria-hidden
      >
        <span
          className={cn(
            'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </span>
    </button>
  )
}

/* ─────────────────────────────────────────────────────────────
 * 辅助组件：Provider 行（折叠展开）
 * ───────────────────────────────────────────────────────────── */

function ProviderRow({ config }: { config: AIProviderConfig }) {
  const updateProvider = useAISettingsStore((s) => s.updateProvider)
  const removeProvider = useAISettingsStore((s) => s.removeProvider)
  const [open, setOpen] = useState(false)
  const [testing, setTesting] = useState(false)

  const handleTest = async () => {
    setTesting(true)
    try {
      const r = await testConnection(config)
      if (r.ok) {
        toast.success('连接正常', r.message)
      } else {
        // 失败提示可能很长（chrome://flags 步骤等），延长展示时间到 30s 让用户看完
        toast.error('连接失败', r.message, 30_000)
      }
    } finally {
      setTesting(false)
    }
  }

  const handleDelete = async () => {
    if (
      await confirmDialog({
        title: `删除 Provider「${config.name}」？`,
        message:
          '只移除 Provider 配置（含 apiKey）；已写入的 embedding / RAG 索引等本地数据不受影响。',
        confirmText: '删除',
        danger: true,
      })
    ) {
      removeProvider(config.id)
    }
  }

  return (
    <div
      className={cn(
        'rounded-md border border-slate-200 dark:border-slate-700',
        'bg-white dark:bg-slate-800/40',
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-base leading-none">
          {config.type === 'window-ai' ? '🟢' : '☁'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
            {config.name}
          </div>
          <div className="text-[11px] text-slate-400 truncate font-mono">
            {config.model}
          </div>
        </div>
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className={cn(
            'h-7 px-2.5 rounded text-xs',
            'border border-slate-200 dark:border-slate-600',
            'hover:border-brand hover:text-brand transition-colors',
            testing && 'opacity-50 cursor-wait',
          )}
        >
          {testing ? '测试中…' : '测试连接'}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'w-7 h-7 inline-flex items-center justify-center rounded',
            'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
            'hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors',
            'transition-transform',
            open && 'rotate-180',
          )}
          title={open ? '收起' : '展开编辑'}
          aria-label="展开编辑"
        >
          ▾
        </button>
      </div>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-100 dark:border-slate-700/60">
          <Field
            label="名称"
            value={config.name}
            onChange={(v) => updateProvider(config.id, { name: v })}
          />
          {config.type !== 'window-ai' && (
            <Field
              label="Base URL"
              value={config.baseURL ?? ''}
              onChange={(v) => updateProvider(config.id, { baseURL: v.trim() })}
              mono
            />
          )}
          {config.type !== 'window-ai' && (
            <Field
              label="API Key"
              value={config.apiKey ?? ''}
              onChange={(v) => updateProvider(config.id, { apiKey: v.trim() })}
              mono
              type="password"
              placeholder="sk-..."
            />
          )}
          <Field
            label="对话模型"
            value={config.model}
            onChange={(v) => updateProvider(config.id, { model: v.trim() })}
            mono
          />
          {config.type !== 'window-ai' && (
            <Field
              label="Embedding 模型"
              value={config.embeddingModel ?? ''}
              onChange={(v) =>
                updateProvider(config.id, { embeddingModel: v.trim() || undefined })
              }
              mono
              placeholder="可选；如 text-embedding-3-small"
            />
          )}
          <div className="flex items-center justify-end pt-1">
            <button
              type="button"
              onClick={() => void handleDelete()}
              className={cn(
                'h-7 px-2.5 rounded text-xs',
                'text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors',
              )}
            >
              删除 Provider
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * 添加 Provider 表单（预设 + 自定义）
 * ───────────────────────────────────────────────────────────── */

function AddProviderForm({
  onClose,
  onAdded,
}: {
  onClose: () => void
  onAdded: () => void
}) {
  const addProvider = useAISettingsStore((s) => s.addProvider)
  const [presetIdx, setPresetIdx] = useState(0)
  const preset = PROVIDER_PRESETS[presetIdx]
  const [name, setName] = useState(preset.name)
  const [baseURL, setBaseURL] = useState(preset.baseURL)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(preset.defaultModel)

  // 按 group 重新组织预设，便于 select 用 optgroup 分组渲染
  const presetsByGroup = useMemo(() => {
    const order: ProviderGroup[] = ['cn', 'global', 'aggregator', 'local', 'experimental']
    const groups = order.map((g) => ({
      group: g,
      label: PROVIDER_GROUP_LABEL[g],
      items: PROVIDER_PRESETS.map((p, i) => ({ p, i })).filter(
        ({ p }) => p.group === g,
      ),
    }))
    return groups.filter((g) => g.items.length > 0)
  }, [])

  // 切预设时自动同步表单
  const switchPreset = (i: number) => {
    setPresetIdx(i)
    const p = PROVIDER_PRESETS[i]
    setName(p.name)
    setBaseURL(p.baseURL)
    setModel(p.defaultModel)
  }

  // 不需要 apiKey 的本地 / 自部署服务（启发式：默认 baseURL 含 localhost / 127 / YOUR_HOST）
  const isLocalLike =
    /localhost|127\.0\.0\.1|YOUR_HOST|YOUR_RESOURCE/i.test(preset.baseURL)

  const canAdd =
    name.trim().length > 0 &&
    model.trim().length > 0 &&
    (preset.type === 'window-ai' ||
      (baseURL.trim().length > 0 &&
        (isLocalLike || apiKey.trim().length > 0)))

  const handleAdd = () => {
    if (!canAdd) return
    addProvider({
      type: preset.type,
      name: name.trim(),
      baseURL: preset.type === 'window-ai' ? undefined : baseURL.trim(),
      apiKey: preset.type === 'window-ai' ? undefined : apiKey.trim() || undefined,
      model: model.trim(),
      embeddingModel: preset.defaultEmbeddingModel,
    })
    toast.success('已添加 Provider', name.trim())
    onAdded()
  }

  return (
    <div
      className={cn(
        'mt-2 p-3 rounded-md',
        'border border-slate-200 dark:border-slate-700',
        'bg-slate-50/50 dark:bg-slate-800/40',
        'space-y-2',
      )}
    >
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          添加 Provider
        </h5>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          取消
        </button>
      </div>

      <div>
        <label className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">
          预设
        </label>
        <select
          value={presetIdx}
          onChange={(e) => switchPreset(Number(e.target.value))}
          className={cn(
            'w-full px-2 py-1.5 text-sm rounded',
            'bg-white dark:bg-slate-900',
            'border border-slate-200 dark:border-slate-700',
            'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
          )}
        >
          {presetsByGroup.map((g) => (
            <optgroup key={g.group} label={g.label}>
              {g.items.map(({ p, i }) => (
                <option key={p.name} value={i}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {/* 选定预设的描述 */}
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          {preset.description}
        </p>
      </div>

      <Field label="名称" value={name} onChange={setName} />
      {preset.type !== 'window-ai' && (
        <Field label="Base URL" value={baseURL} onChange={setBaseURL} mono />
      )}
      {preset.type !== 'window-ai' && (
        <Field
          label="API Key"
          value={apiKey}
          onChange={setApiKey}
          mono
          type="password"
          placeholder={isLocalLike ? '本地服务可留空' : 'sk-...'}
        />
      )}
      <Field label="模型" value={model} onChange={setModel} mono />

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd}
          className={cn(
            'h-7 px-3 rounded text-xs font-medium',
            canAdd
              ? 'bg-brand text-white hover:bg-brand-600'
              : 'bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500 cursor-not-allowed',
          )}
        >
          添加
        </button>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * 路由行
 * ───────────────────────────────────────────────────────────── */

function RouteRow({
  task,
  label,
}: {
  task: 'chat' | 'organize' | 'embedding'
  label: string
}) {
  const providers = useAISettingsStore((s) => s.providers)
  const routing = useAISettingsStore((s) => s.routing)
  const setRoute = useAISettingsStore((s) => s.setRoute)
  const current = routing[task] ?? providers[0]?.id ?? ''

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 dark:text-slate-400 w-20 shrink-0">
        {label}
      </span>
      <select
        value={current}
        onChange={(e) => setRoute(task, e.target.value)}
        className={cn(
          'flex-1 px-2 py-1 text-xs rounded',
          'bg-white dark:bg-slate-900',
          'border border-slate-200 dark:border-slate-700',
          'outline-none focus:border-brand',
        )}
      >
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.model})
          </option>
        ))}
      </select>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * 通用字段
 * ───────────────────────────────────────────────────────────── */

function Field({
  label,
  value,
  onChange,
  mono,
  type = 'text',
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  mono?: boolean
  type?: 'text' | 'password'
  placeholder?: string
}) {
  return (
    <div>
      <label className="text-[11px] text-slate-500 dark:text-slate-400 block mb-0.5">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={cn(
          'w-full px-2 py-1.5 text-sm rounded',
          'bg-white dark:bg-slate-900',
          'border border-slate-200 dark:border-slate-700',
          'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
          mono && 'font-mono text-xs',
        )}
      />
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * 内容抓取 section（V2.0 §6.1）
 *
 * 三态：
 * - 隐私未同意：显示蓝色 alert + 「同意并启用」按钮，点击弹完整说明
 * - 已同意 + 空闲：状态网格 + 范围选择 + 开始按钮 + 撤回同意小字
 * - 运行中：进度条 + 当前抓取标题 + 取消
 *
 * 不依赖 isAIConfigured：本 section 是纯 fetch + Readability 流程，
 * 不调用 LLM，没有 Provider 也能工作。
 * ───────────────────────────────────────────────────────────── */

interface CrawlStatus {
  total: number
  ok: number
  failed: number
  /** 卡片中能被抓取的（http(s)）数量 */
  crawlableTotal: number
  /** 缺失数 = crawlableTotal - ok */
  missing: number
}

function CrawlSection() {
  const settings = useAISettingsStore()
  const cards = useBookmarkStore((s) => s.cards)
  const categories = useBookmarkStore((s) => s.categories)

  const stage = useCrawlerStore((s) => s.stage)
  const range = useCrawlerStore((s) => s.range)
  const progress = useCrawlerStore((s) => s.progress)
  const lastResult = useCrawlerStore((s) => s.lastResult)
  const errorMessage = useCrawlerStore((s) => s.errorMessage)
  const setRange = useCrawlerStore((s) => s.setRange)
  const start = useCrawlerStore((s) => s.start)
  const setProgress = useCrawlerStore((s) => s.setProgress)
  const finish = useCrawlerStore((s) => s.finish)
  const fail = useCrawlerStore((s) => s.fail)
  const cancel = useCrawlerStore((s) => s.cancel)
  const reset = useCrawlerStore((s) => s.reset)
  const refreshPageIndex = usePageIndex((s) => s.refresh)
  const clearPageIndex = usePageIndex((s) => s.clear)

  const [status, setStatus] = useState<CrawlStatus | null>(null)
  const [showPrivacyDialog, setShowPrivacyDialog] = useState(false)
  const topCategories = useMemo(
    () => categories.filter((c) => !c.parentId),
    [categories],
  )

  // 拉一次状态：mount 时 + 任务结束后 + cards 变了
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const counts = await countByStatus()
      const crawlableTotal = cards.filter((c) => isCrawlableUrl(c.url)).length
      if (!cancelled) {
        setStatus({
          total: counts.total,
          ok: counts.ok,
          failed: counts.failed,
          crawlableTotal,
          missing: Math.max(0, crawlableTotal - counts.ok),
        })
      }
    })()
    return () => {
      cancelled = true
    }
    // 仅在 cards 数量 / 任务结束后刷新；任务运行中靠 progress 显示，不重拉
  }, [cards, stage])

  const running = stage === 'running'
  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  // 选定范围下的待处理预估数（用于按钮上的 "(N)" 显示）
  const [estimatedPending, setEstimatedPending] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    void selectCardsForCrawling(range, cards, categories).then((list) => {
      if (!cancelled) setEstimatedPending(list.length)
    })
    return () => {
      cancelled = true
    }
  }, [range, cards, categories, stage])

  const handleRun = async () => {
    if (!settings.crawl.agreed) {
      // 没同意 → 弹隐私窗
      setShowPrivacyDialog(true)
      return
    }
    const targets = await selectCardsForCrawling(range, cards, categories)
    if (targets.length === 0) {
      toast.info('无可抓取项', '该范围内没有需要抓取的书签')
      return
    }
    if (
      targets.length > 50 &&
      !(await confirmDialog({
        title: `本次将抓取 ${targets.length} 个网页`,
        message: `每条最多 ~30s，预计总耗时约 ${Math.ceil(targets.length / 3)} 秒。开始？`,
        confirmText: '开始抓取',
      }))
    ) {
      return
    }

    const controller = new AbortController()
    start(controller)
    try {
      const result = await runCrawler({
        cards: targets,
        signal: controller.signal,
        onProgress: setProgress,
      })
      finish({ total: result.total, ok: result.ok, failed: result.failed })
      // 通知卡片角标层：indexedIds 集合可能变了
      void refreshPageIndex()
      if (result.failed === 0) {
        toast.success(
          '内容抓取完成',
          `成功 ${result.ok} / ${result.total} 条`,
        )
      } else {
        toast.warning(
          '内容抓取部分失败',
          `成功 ${result.ok} · 失败 ${result.failed}（可在「⚙ 设置」点击「重试失败」）`,
        )
      }
      // §6.3 autoSummarize 联动：开关开着就提示用户去触发批量备注
      // （故意不"自动跑"，避免静默消费 token；用户在 toast 上点 action 才真的跑）
      if (settings.autoSummarize && result.ok > 0) {
        toast.show({
          kind: 'info',
          title: '可继续生成 AI 备注',
          message: `${result.ok} 个新抓取的网页可以一键生成简短摘要`,
          duration: 8000,
          action: {
            label: '前往',
            variant: 'primary',
            onClick: () => {
              // 滚动到 SummarySection（用 location.hash 取巧；section 加 id 即可）
              document
                .getElementById('summary-section')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            },
          },
        })
      }
    } catch (err) {
      if (controller.signal.aborted) {
        reset()
        return
      }
      const msg = err instanceof Error ? err.message : '未知错误'
      fail(msg)
      toast.error('内容抓取出错', msg)
    }
  }

  const handleClear = async () => {
    if (
      !(await confirmDialog({
        title: '清空所有已抓取的网页正文？',
        message:
          '清空后语义搜索 / RAG 问答的「内容召回」将不可用，需要重新抓取。',
        confirmText: '清空',
        danger: true,
      }))
    ) {
      return
    }
    await clearPageContents()
    clearPageIndex()
    toast.success('已清空', '内容索引已重置')
    reset()
  }

  const handleAgree = () => {
    settings.setCrawlAgreed(true)
    setShowPrivacyDialog(false)
    toast.success('已同意', '可以开始抓取了')
  }

  const handleRevoke = async () => {
    if (
      !(await confirmDialog({
        title: '撤回内容抓取同意？',
        message:
          '撤回后，下次再次启动抓取时会重新弹隐私说明。本地已抓取的内容保留。',
        confirmText: '撤回同意',
        danger: true,
      }))
    ) {
      return
    }
    settings.setCrawlAgreed(false)
    toast.info('已撤回同意', '本地已抓取的内容仍保留；不会再有新的抓取')
  }

  return (
    <section>
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
        内容抓取
      </h4>
      <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
        抓取已收藏网页的正文（用 Mozilla Readability 提取主体内容），写入本机
        IndexedDB，供 V2.0 RAG 问答 / 语义搜索召回。
        <span className="text-slate-500"> 不会上传任何内容到服务器。</span>
      </p>

      {/* 状态网格 */}
      <div
        className={cn(
          'rounded-md border p-2.5 text-xs',
          'bg-slate-50 dark:bg-slate-800/40',
          'border-slate-200 dark:border-slate-700',
        )}
      >
        {status ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <StatRow label="可抓取书签" value={status.crawlableTotal} />
            <StatRow
              label="已成功索引"
              value={status.ok}
              tone={status.ok > 0 ? 'ok' : 'normal'}
            />
            <StatRow
              label="待抓取"
              value={status.missing}
              tone={status.missing > 0 ? 'warn' : 'ok'}
            />
            <StatRow
              label="失败"
              value={status.failed}
              tone={status.failed > 0 ? 'warn' : 'normal'}
            />
          </div>
        ) : (
          <div className="text-slate-400 py-1">读取索引状态…</div>
        )}
      </div>

      {/* 范围选择（仅未运行时） */}
      {!running && (
        <div className="mt-2 space-y-1.5">
          <RangeChip
            checked={range.type === 'untouched'}
            onClick={() => setRange({ type: 'untouched' })}
            label={CRAWL_RANGE_LABEL.untouched}
          />
          <RangeChip
            checked={range.type === 'failed'}
            onClick={() => setRange({ type: 'failed' })}
            label={CRAWL_RANGE_LABEL.failed}
            disabled={!status || status.failed === 0}
          />
          <RangeChip
            checked={range.type === 'all'}
            onClick={() => setRange({ type: 'all' })}
            label={CRAWL_RANGE_LABEL.all}
          />
          {topCategories.length > 0 && (
            <details className="group">
              <summary
                className={cn(
                  'cursor-pointer text-[11px] text-slate-500 dark:text-slate-400 px-2 py-1 rounded',
                  'hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                按某个顶层分类抓取…
              </summary>
              <div className="pl-2 mt-1 space-y-1 border-l-2 border-slate-100 dark:border-slate-700">
                {topCategories.map((c) => (
                  <RangeChip
                    key={c.id}
                    checked={range.type === 'category' && range.id === c.id}
                    onClick={() => setRange({ type: 'category', id: c.id })}
                    label={`${c.icon ?? '📁'} ${c.name}`}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* 进度条 */}
      {running && (
        <div className="mt-2 rounded-md border border-brand/30 bg-brand/5 px-2.5 py-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-brand font-medium">📥 正在抓取…</span>
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
          {progress.currentTitle && (
            <div
              className="text-[10px] text-slate-500 dark:text-slate-400 truncate"
              title={progress.currentTitle}
            >
              · {progress.currentTitle}
            </div>
          )}
          <button
            type="button"
            onClick={cancel}
            className="text-[10px] text-slate-400 hover:text-red-500"
          >
            取消任务（已完成项保留）
          </button>
        </div>
      )}

      {/* 错误条 */}
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

      {/* 上次结果摘要 */}
      {stage === 'done' && lastResult && (
        <div className="mt-2 rounded-md border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
          ✓ 上次抓取：成功 {lastResult.ok} / {lastResult.total}
          {lastResult.failed > 0 && (
            <span className="text-amber-600 dark:text-amber-300">
              （失败 {lastResult.failed}）
            </span>
          )}
        </div>
      )}

      {/* 操作按钮区 */}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <ActionBtn
          primary
          disabled={running || estimatedPending === 0}
          onClick={() => void handleRun()}
          title={
            !settings.crawl.agreed
              ? '首次使用前需要同意隐私说明'
              : estimatedPending === 0
                ? '该范围内没有需要抓取的书签'
                : '开始抓取所选范围'
          }
        >
          {!settings.crawl.agreed ? '✓ 同意并开始' : '📥 开始抓取'}
          {estimatedPending !== null && estimatedPending > 0 && (
            <span className="ml-1 tabular-nums opacity-80">
              ({estimatedPending})
            </span>
          )}
        </ActionBtn>
        <div className="flex-1" />
        <ActionBtn
          danger
          disabled={running || !status || status.total === 0}
          onClick={() => void handleClear()}
          title="清空所有已抓取的正文（不删书签本身）"
        >
          清空
        </ActionBtn>
      </div>

      {/* 已同意状态 + 撤回入口 */}
      {settings.crawl.agreed && (
        <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-2">
          <span>
            ✓ 已同意抓取
            {settings.crawl.agreedAt && (
              <> · {new Date(settings.crawl.agreedAt).toLocaleDateString()}</>
            )}
          </span>
          <button
            type="button"
            onClick={() => void handleRevoke()}
            className="text-slate-400 hover:text-red-500 underline"
          >
            撤回同意
          </button>
        </div>
      )}

      {/* 隐私说明弹窗 */}
      {showPrivacyDialog && (
        <CrawlPrivacyDialog
          pendingCount={estimatedPending ?? 0}
          onCancel={() => setShowPrivacyDialog(false)}
          onAgree={handleAgree}
        />
      )}
    </section>
  )
}

function RangeChip({
  checked,
  onClick,
  label,
  disabled,
}: {
  checked: boolean
  onClick: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1 rounded-md text-left text-xs transition-colors',
        'border',
        disabled
          ? 'border-slate-100 dark:border-slate-800 text-slate-300 cursor-not-allowed'
          : checked
            ? 'border-brand bg-brand/5 text-brand'
            : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-brand/40',
      )}
    >
      <span
        className={cn(
          'shrink-0 w-3 h-3 rounded-full border flex items-center justify-center',
          checked ? 'border-brand bg-brand' : 'border-slate-300 dark:border-slate-600',
        )}
        aria-hidden
      >
        {checked && <span className="w-1 h-1 rounded-full bg-white" />}
      </span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  )
}

/**
 * 隐私同意弹窗（§6.1 强制要求）：
 * 第一次开启抓取前显示，文案明确说"将下载 N 个网页内容到本地"。
 * 同意后写入 settings.crawl.agreed=true，后续不再弹（除非用户撤回）。
 */
function CrawlPrivacyDialog({
  pendingCount,
  onCancel,
  onAgree,
}: {
  pendingCount: number
  onCancel: () => void
  onAgree: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[10200] flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          // v0.21.16：max-h 自适应屏幕 + 内部滚动
          'w-[440px] max-w-[92vw] max-h-[calc(100vh-2rem)] flex flex-col rounded-lg shadow-2xl',
          'bg-white dark:bg-slate-800',
          'border border-slate-200 dark:border-slate-700',
        )}
      >
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span aria-hidden>🔒</span>
            内容抓取隐私说明
          </h3>
        </div>
        <div className="px-5 py-4 space-y-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed flex-1 min-h-0 overflow-y-auto">
          <p>
            Tab It 即将代你访问已收藏的{' '}
            <span className="font-semibold text-brand tabular-nums">
              {pendingCount}
            </span>{' '}
            个网页，下载其 HTML，用 Mozilla Readability 提取正文并保存到{' '}
            <span className="font-mono text-slate-500">本机 IndexedDB</span>。
          </p>
          <ul className="list-disc list-inside space-y-1 text-slate-500 dark:text-slate-400">
            <li>
              <span className="text-slate-700 dark:text-slate-200 font-medium">绝不上传</span>
              ：内容只存在你这台浏览器里
            </li>
            <li>
              <span className="text-slate-700 dark:text-slate-200 font-medium">不带登录态</span>
              ：fetch 时显式 <code className="font-mono">credentials: 'omit'</code>，
              不会发送 cookie / Authorization
            </li>
            <li>
              <span className="text-slate-700 dark:text-slate-200 font-medium">仅在你主动操作时</span>
              ：默认完全关闭；后台不会自动跑
            </li>
            <li>
              <span className="text-slate-700 dark:text-slate-200 font-medium">可随时撤回</span>
              ：撤回后不会再发起新的抓取
            </li>
          </ul>
          <p className="text-slate-500">
            浏览器层的「读取所有网站的数据」权限是 manifest 必需声明，
            实际行为由本扩展严格自我约束。
          </p>
        </div>
        <div className="px-5 py-3 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-700 shrink-0">
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              'px-3 py-1.5 text-sm rounded',
              'text-slate-600 dark:text-slate-300',
              'hover:bg-slate-100 dark:hover:bg-slate-700/60',
            )}
          >
            取消
          </button>
          <button
            type="button"
            onClick={onAgree}
            className={cn(
              'px-3 py-1.5 text-sm rounded font-medium',
              'bg-brand text-white hover:bg-brand-600',
            )}
          >
            我已了解并同意
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * AI 自动备注 section（V2.0 §6.3）
 *
 * 列表 + 范围选择 + 进度 + 一键批量；不覆盖用户已写的 description。
 * autoSummarize 开关只控制"crawler 完成后是否提示用户来这里"，
 * 不会真的后台静默调 LLM —— 避免无声消耗 token。
 * ───────────────────────────────────────────────────────────── */

function SummarySection() {
  const settings = useAISettingsStore()
  const cards = useBookmarkStore((s) => s.cards)
  const categories = useBookmarkStore((s) => s.categories)
  const updateCard = useBookmarkStore((s) => s.updateCard)

  const stage = useSummarizerStore((s) => s.stage)
  const range = useSummarizerStore((s) => s.range)
  const progress = useSummarizerStore((s) => s.progress)
  const lastResult = useSummarizerStore((s) => s.lastResult)
  const errorMessage = useSummarizerStore((s) => s.errorMessage)
  const setRange = useSummarizerStore((s) => s.setRange)
  const start = useSummarizerStore((s) => s.start)
  const setProgress = useSummarizerStore((s) => s.setProgress)
  const finish = useSummarizerStore((s) => s.finish)
  const fail = useSummarizerStore((s) => s.fail)
  const cancel = useSummarizerStore((s) => s.cancel)
  const reset = useSummarizerStore((s) => s.reset)

  // 估算待处理条数（仅给按钮上的 (N) 用）
  const [estimated, setEstimated] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    void selectCardsForSummarizing(range, cards, categories).then((list) => {
      if (!cancelled) setEstimated(list.length)
    })
    return () => {
      cancelled = true
    }
  }, [range, cards, categories, stage])

  const topCategories = useMemo(
    () => categories.filter((c) => !c.parentId),
    [categories],
  )
  const running = stage === 'running'
  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  const handleRun = async () => {
    const targets = await selectCardsForSummarizing(range, cards, categories)
    if (targets.length === 0) {
      toast.info('无可生成项', '该范围内没有需要生成备注的卡片')
      return
    }
    if (
      range.type === 'all' &&
      !(await confirmDialog({
        title: `覆盖 ${targets.length} 张卡片的备注？`,
        message: '"all" 模式会重新生成并覆盖已有备注。',
        confirmText: '覆盖',
        danger: true,
      }))
    ) {
      return
    }
    if (
      targets.length > 30 &&
      !(await confirmDialog({
        title: `为 ${targets.length} 张卡片生成备注`,
        message:
          '每张约 1 次 LLM 调用，按 token 计费。开始？',
        confirmText: '开始生成',
      }))
    ) {
      return
    }

    const controller = new AbortController()
    start(controller)
    try {
      const result = await runSummarizer({
        cards: targets,
        settings,
        signal: controller.signal,
        onProgress: setProgress,
      })
      // 写库：仅写入"AI 真给了 summary 的"；用户已写过 description 的在 select 阶段就过滤了
      let written = 0
      for (const r of result.results) {
        if (!r.summary) continue
        await updateCard(r.cardId, { description: r.summary })
        written++
      }
      finish({ total: result.total, ok: result.ok, failed: result.failed })
      if (written > 0) {
        toast.success('AI 备注已写入', `${written} 张卡片`)
      } else {
        toast.warning(
          '没有可用的备注',
          'AI 没能为这批书签生成有效摘要，可换个 Provider 重试',
        )
      }
    } catch (err) {
      if (controller.signal.aborted) {
        reset()
        return
      }
      const msg = err instanceof Error ? err.message : '未知错误'
      fail(msg)
      toast.error('AI 备注任务失败', msg)
    }
  }

  return (
    <section id="summary-section">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
        AI 自动备注
      </h4>
      <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
        基于已抓取正文，让 AI 为每张卡片生成一句话简短摘要（≤ 25 字），写入备注。
        <span className="text-slate-500"> 默认仅处理"已抓正文且没写备注"的卡片，不会覆盖你写的内容。</span>
      </p>

      {/* autoSummarize 开关 */}
      <ToggleRow
        label="抓取完成后提示生成备注"
        description="开启后，每次内容抓取完成会提示「已为你准备 N 条可生成备注」"
        checked={settings.autoSummarize}
        onChange={settings.setAutoSummarize}
      />

      {/* 范围选择 */}
      {!running && (
        <div className="mt-2 space-y-1.5">
          <RangeChip
            checked={range.type === 'untouched'}
            onClick={() => setRange({ type: 'untouched' })}
            label={SUMMARY_RANGE_LABEL.untouched}
          />
          <RangeChip
            checked={range.type === 'all'}
            onClick={() => setRange({ type: 'all' })}
            label={SUMMARY_RANGE_LABEL.all}
          />
          {topCategories.length > 0 && (
            <details className="group">
              <summary
                className={cn(
                  'cursor-pointer text-[11px] text-slate-500 dark:text-slate-400 px-2 py-1 rounded',
                  'hover:bg-slate-100 dark:hover:bg-slate-800',
                )}
              >
                按某个顶层分类生成备注…
              </summary>
              <div className="pl-2 mt-1 space-y-1 border-l-2 border-slate-100 dark:border-slate-700">
                {topCategories.map((c) => (
                  <RangeChip
                    key={c.id}
                    checked={range.type === 'category' && range.id === c.id}
                    onClick={() => setRange({ type: 'category', id: c.id })}
                    label={`${c.icon ?? '📁'} ${c.name}`}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* 进度条 */}
      {running && (
        <div className="mt-2 rounded-md border border-brand/30 bg-brand/5 px-2.5 py-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-brand font-medium">
              ✨ 正在生成备注…
            </span>
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
          {progress.currentTitle && (
            <div
              className="text-[10px] text-slate-500 dark:text-slate-400 truncate"
              title={progress.currentTitle}
            >
              · {progress.currentTitle}
            </div>
          )}
          <button
            type="button"
            onClick={cancel}
            className="text-[10px] text-slate-400 hover:text-red-500"
          >
            取消任务（已完成项保留）
          </button>
        </div>
      )}

      {/* 错误条 */}
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

      {/* 上次结果摘要 */}
      {stage === 'done' && lastResult && (
        <div className="mt-2 rounded-md border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
          ✓ 上次：成功 {lastResult.ok} / {lastResult.total}
          {lastResult.failed > 0 && (
            <span className="text-amber-600 dark:text-amber-300">
              （失败 {lastResult.failed}）
            </span>
          )}
        </div>
      )}

      {/* 操作按钮区 */}
      <div className="mt-2 flex items-center gap-1.5 flex-wrap">
        <ActionBtn
          primary
          disabled={running || estimated === 0}
          onClick={() => void handleRun()}
          title={
            estimated === 0
              ? '当前范围无可生成项；先在「内容抓取」里抓些正文'
              : '为选定范围生成 AI 备注'
          }
        >
          ✨ 批量生成备注
          {estimated !== null && estimated > 0 && (
            <span className="ml-1 tabular-nums opacity-80">({estimated})</span>
          )}
        </ActionBtn>
      </div>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────
 * 整理质检 section（V2.0 §6.4 重复 / 失效检测）
 *
 * 三色分组：🔴 失效 · 🟡 疑似重复 · 🔵 长期未访问 (≥6 月)
 * 用户勾选后批量删除 / 移动到指定分类。
 * ───────────────────────────────────────────────────────────── */

function QualitySection() {
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
                {c.icon ?? '📁'} {c.name}
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
