import { useEffect, useMemo, useRef, useState } from 'react'
import { browser } from 'wxt/browser'
import { useBookmarkStore } from '../../src/stores/useBookmarkStore'
import {
  useAISettingsStore,
  useIsAIConfigured,
} from '../../src/ai/useAISettingsStore'
import { runSuggester } from '../../src/ai/services/suggester'
import type { Category } from '../../src/types/bookmark'
import { getHostname } from '../../src/utils/favicon'
import { cn } from '../../src/utils/cn'
import { FaviconImg } from '../../src/components/FaviconImg'
import { runLegacyMigrationOnce } from '../../src/services/legacyMigration'

/**
 * 浏览器工具栏图标的 Popup。
 *
 * 两个主操作：
 *  1. 「打开 Curio 新标签页」—— 打开一个新的 chrome://newtab
 *  2. 「添加当前页面」—— 把当前 active tab 的 title/url 加为 Curio 书签
 *
 * V1.0 §4.3 增加 ✨ AI 建议（一次调用 LLM 同时给出分类 / 备注 / 标签建议）：
 *  - AI 未配置时按钮隐藏（保持 popup 干净）
 *  - 只覆盖用户没主动改过的字段（dirty 跟踪），避免抹掉用户已经手敲的内容
 *  - 失败显示错误 + 重试按钮，不打断主流程
 *
 * 数据通道：
 *  - 复用 useBookmarkStore + useAISettingsStore；popup 与 newtab 是独立 web context，
 *    写入后 newtab 不会自动刷新（V1 接受这个限制）
 */
export default function Popup() {
  const init = useBookmarkStore((s) => s.init)
  const initialized = useBookmarkStore((s) => s.initialized)
  const categories = useBookmarkStore((s) => s.categories)
  const activeCategoryId = useBookmarkStore((s) => s.activeCategoryId)
  const addCard = useBookmarkStore((s) => s.addCard)
  const cards = useBookmarkStore((s) => s.cards)

  // AI 设置 —— popup 与 newtab 共享 storage，但 store 是各 entrypoint 独立的内存
  // 所以这里仍要显式 init 一次
  const aiInit = useAISettingsStore((s) => s.init)
  const aiHydrated = useAISettingsStore((s) => s.hydrated)
  const aiConfigured = useIsAIConfigured()
  const aiAvailable = aiHydrated && aiConfigured

  // 当前 active tab 信息（用于「添加当前页面」）
  const [tabInfo, setTabInfo] = useState<{ url: string; title: string } | null>(
    null,
  )
  const [draftTitle, setDraftTitle] = useState('')
  const [draftDesc, setDraftDesc] = useState('')
  /** tags 用空格 / 逗号分隔的原始字符串保存草稿态；提交时再解析 */
  const [draftTagsRaw, setDraftTagsRaw] = useState('')
  const [targetCategoryId, setTargetCategoryId] = useState<string>('')

  /**
   * dirty 跟踪：避免 AI 建议覆盖用户主动改过的字段。
   * - title 默认从浏览器标题预填，用户改过 → categoryDirty 也跟着收紧。
   * - 几个字段独立标记是为了让 AI 能仅修补"没动过的"那部分。
   */
  const dirty = useRef({
    title: false,
    desc: false,
    tags: false,
    category: false,
  })

  // AI 建议态
  const [aiState, setAiState] = useState<{
    loading: boolean
    error: string | null
    /** 上一次的建议数据；用于显示「分类已被 AI 改为 xxx」等提示 */
    last: {
      categoryName?: string
      description?: string
      tags?: string[]
    } | null
  }>({ loading: false, error: null, last: null })
  const aiAbortRef = useRef<AbortController | null>(null)

  // 提交态：'idle' | 'saving' | 'saved' | 'duplicate' | 'invalid'
  const [submitState, setSubmitState] = useState<
    'idle' | 'saving' | 'saved' | 'duplicate' | 'invalid'
  >('idle')

  // ─── 跟随系统主题 ─────────────────────────────
  // popup 没有完整的主题选择 UI，简单跟随 prefers-color-scheme
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (isDark: boolean) =>
      document.documentElement.classList.toggle('dark', isDark)
    apply(mq.matches)
    const onChange = (e: MediaQueryListEvent) => apply(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // ─── 初始化：拉 store + AI settings + 当前 tab ───────────────
  useEffect(() => {
    // 老用户首次打开 popup 时，可能 background / newtab 都还没跑过迁移；
    // 这里先 await 一次再 init，确保读到的是迁移后的 curio:* 数据。
    void (async () => {
      try {
        await runLegacyMigrationOnce()
      } catch {
        /* 迁移失败不阻塞 popup 主流程 */
      }
      void init()
      void aiInit()
    })()
    void loadActiveTab().then((info) => {
      if (!info) return
      setTabInfo(info)
      setDraftTitle(info.title)
    })
  }, [init, aiInit])

  // 默认目标分类：优先用 newtab 上次激活的；否则取第一个顶层分类
  useEffect(() => {
    if (!initialized) return
    if (targetCategoryId) return
    const fallback =
      activeCategoryId ??
      categories.find((c) => !c.parentId)?.id ??
      categories[0]?.id ??
      ''
    setTargetCategoryId(fallback)
  }, [initialized, activeCategoryId, categories, targetCategoryId])

  // 顶层 + 子级，按 order 排序，渲染时用前缀缩进表达层级
  const flatCategories = useMemo(() => buildIndentedList(categories), [
    categories,
  ])

  /** 当前草稿 tags（解析后） */
  const parsedTags = useMemo(() => parseTagsInput(draftTagsRaw), [draftTagsRaw])

  // ─── 操作 ────────────────────────────────────────

  const handleOpenNewTab = () => {
    // 用 chrome.* 直接调，避免 WXT browser 类型对 path 的 PublicPath 收敛
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      const url = chrome.runtime.getURL('/newtab.html')
      void browser.tabs.create({ url })
      window.close()
      return
    }
    // 兜底：直接 fallback 到 newtab 命名（Firefox 也用同名）
    void browser.tabs.create({ url: 'newtab.html' })
    window.close()
  }

  const handleAskAI = async () => {
    if (!tabInfo || !aiAvailable) return
    // 取消上一次未完成的请求（用户可能反复点）
    aiAbortRef.current?.abort()
    const controller = new AbortController()
    aiAbortRef.current = controller
    setAiState({ loading: true, error: null, last: null })
    try {
      const result = await runSuggester({
        page: { title: draftTitle || tabInfo.title, url: tabInfo.url },
        categories,
        cards,
        settings: useAISettingsStore.getState(),
        signal: controller.signal,
      })
      // 仅在本次请求未被取消时应用结果
      if (controller.signal.aborted) return
      // 取「目标分类的名字」用于 last 展示
      const suggestedCategoryName = result.suggestedCategoryId
        ? categories.find((c) => c.id === result.suggestedCategoryId)?.name
        : undefined
      setAiState({
        loading: false,
        error: null,
        last: {
          categoryName: suggestedCategoryName,
          description: result.description,
          tags: result.tags,
        },
      })
      // 自动填充：仅覆盖用户没主动改过的字段
      if (!dirty.current.desc && result.description) {
        setDraftDesc(result.description)
      }
      if (!dirty.current.tags && result.tags.length > 0) {
        setDraftTagsRaw(result.tags.join(' '))
      }
      if (
        !dirty.current.category &&
        result.suggestedCategoryId &&
        result.suggestedCategoryId !== targetCategoryId
      ) {
        setTargetCategoryId(result.suggestedCategoryId)
      }
    } catch (err) {
      if (controller.signal.aborted) return
      const msg = err instanceof Error ? err.message : '未知错误'
      setAiState({ loading: false, error: msg, last: null })
    }
  }

  const handleAddCurrentPage = async () => {
    if (!tabInfo || !targetCategoryId) return
    const title = draftTitle.trim() || tabInfo.title || tabInfo.url
    const url = tabInfo.url.trim()
    if (!url) {
      setSubmitState('invalid')
      return
    }
    // 避免重复添加：同分类下 url 相同直接提示
    const exists = cards.some(
      (c) => c.categoryId === targetCategoryId && c.url === url,
    )
    if (exists) {
      setSubmitState('duplicate')
      // 2 秒后回到 idle，避免一直堵在错误态
      setTimeout(() => setSubmitState('idle'), 2000)
      return
    }
    try {
      setSubmitState('saving')
      await addCard({
        categoryId: targetCategoryId,
        title,
        url,
        description: draftDesc,
        tags: parsedTags,
      })
      setSubmitState('saved')
      // 1.2 秒后自动关闭，保持轻量
      setTimeout(() => window.close(), 1200)
    } catch {
      setSubmitState('invalid')
    }
  }

  const isInternalTab = tabInfo
    ? /^(chrome|edge|about|moz-extension|chrome-extension):/i.test(tabInfo.url)
    : false

  const canAdd =
    !!tabInfo &&
    !isInternalTab &&
    !!targetCategoryId &&
    submitState !== 'saving' &&
    submitState !== 'saved'

  return (
    // 显式固定宽度，做 index.html 那段 !important 的双重保险
    <div
      style={{ width: 360 }}
      className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
    >
      {/* ───── Header ───── */}
      <header className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-200 dark:border-slate-700 whitespace-nowrap">
        <span className="text-base font-semibold text-brand leading-none">
          Curio
        </span>
        <span className="text-[10px] text-slate-400 leading-none truncate">
          书签整理新标签页
        </span>
      </header>

      {/* ───── 主操作 ───── */}
      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={handleOpenNewTab}
          className={cn(
            'w-full h-9 inline-flex items-center justify-center gap-2 rounded-md',
            'bg-brand text-white text-sm font-medium whitespace-nowrap',
            'hover:bg-brand-600 transition-colors',
          )}
        >
          <span aria-hidden>＋</span>
          打开 Curio 新标签页
        </button>
      </div>

      {/* ───── 添加当前页面 ───── */}
      <section className="px-3 pt-3 pb-3">
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            添加当前页面
          </h4>
          {/* AI 建议按钮：仅当 AI 已配置且当前是可添加的网页时显示 */}
          {aiAvailable && tabInfo && !isInternalTab && (
            <button
              type="button"
              onClick={() => void handleAskAI()}
              disabled={aiState.loading}
              className={cn(
                'inline-flex items-center gap-1 px-2 h-6 rounded text-[11px] font-medium transition-colors',
                aiState.loading
                  ? 'bg-brand/10 text-brand cursor-wait'
                  : 'bg-brand/10 text-brand hover:bg-brand/20',
              )}
              title="让 AI 一键建议分类、备注与标签"
            >
              <span aria-hidden className={aiState.loading ? 'animate-pulse' : ''}>
                ✨
              </span>
              <span>{aiState.loading ? '思考中…' : 'AI 建议'}</span>
            </button>
          )}
        </div>

        {!tabInfo ? (
          <div className="text-xs text-slate-400 py-2">读取当前页面信息…</div>
        ) : isInternalTab ? (
          <div
            className={cn(
              'text-xs px-2.5 py-2 rounded',
              'bg-slate-50 dark:bg-slate-800',
              'text-slate-500 dark:text-slate-400',
            )}
          >
            浏览器内部页面（{getProtocolLabel(tabInfo.url)}）无法被添加为书签。
          </div>
        ) : (
          <div className="space-y-2">
            {/* 当前页面预览：favicon + url */}
            <div
              className={cn(
                'flex items-center gap-2 px-2 py-1.5 rounded',
                'bg-slate-50 dark:bg-slate-800/60',
                'border border-slate-200 dark:border-slate-700',
              )}
            >
              <FaviconImg
                url={tabInfo.url}
                size={16}
                className="w-4 h-4 rounded-sm shrink-0"
                fallbackClassName="w-4 h-4 rounded-sm text-[10px] shrink-0"
              />
              <span
                className="text-[11px] text-slate-500 dark:text-slate-400 truncate"
                title={tabInfo.url}
              >
                {getHostname(tabInfo.url)}
              </span>
            </div>

            {/* AI 错误条 */}
            {aiState.error && (
              <div
                className={cn(
                  'flex items-center justify-between gap-2 px-2 py-1.5 rounded text-[11px]',
                  'bg-red-50 dark:bg-red-500/10',
                  'border border-red-200 dark:border-red-500/30',
                  'text-red-600 dark:text-red-300',
                )}
              >
                <span className="flex-1 truncate" title={aiState.error}>
                  AI 建议失败：{aiState.error}
                </span>
                <button
                  type="button"
                  onClick={() => void handleAskAI()}
                  className="shrink-0 underline hover:no-underline"
                >
                  重试
                </button>
              </div>
            )}

            {/* 标题（可编辑） */}
            <input
              value={draftTitle}
              onChange={(e) => {
                setDraftTitle(e.target.value)
                dirty.current.title = true
              }}
              placeholder="书签标题"
              className={cn(
                'w-full px-2 py-1.5 text-sm rounded',
                'bg-white dark:bg-slate-900',
                'border border-slate-200 dark:border-slate-700',
                'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
                'placeholder:text-slate-400',
              )}
            />

            {/* 备注（可选；AI 建议会填充此处） */}
            <div className="relative">
              <textarea
                value={draftDesc}
                onChange={(e) => {
                  setDraftDesc(e.target.value)
                  dirty.current.desc = true
                }}
                placeholder="备注（可选；点 ✨ AI 自动建议）"
                rows={2}
                className={cn(
                  'w-full px-2 py-1.5 text-xs rounded resize-none',
                  'bg-white dark:bg-slate-900',
                  'border border-slate-200 dark:border-slate-700',
                  'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
                  'placeholder:text-slate-400',
                )}
              />
            </div>

            {/* 标签（用空格 / 逗号分隔；下方实时显示解析后的 chips） */}
            <div className="space-y-1">
              <input
                value={draftTagsRaw}
                onChange={(e) => {
                  setDraftTagsRaw(e.target.value)
                  dirty.current.tags = true
                }}
                placeholder="标签（空格 / 逗号分隔；最多 8 个）"
                className={cn(
                  'w-full px-2 py-1.5 text-xs rounded',
                  'bg-white dark:bg-slate-900',
                  'border border-slate-200 dark:border-slate-700',
                  'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
                  'placeholder:text-slate-400',
                )}
              />
              {parsedTags.length > 0 && (
                <div className="flex items-center flex-wrap gap-1 px-0.5">
                  {parsedTags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center px-1.5 h-4 rounded text-[10px] bg-brand/10 text-brand"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 分类选择 */}
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                添加到
              </label>
              <select
                value={targetCategoryId}
                onChange={(e) => {
                  setTargetCategoryId(e.target.value)
                  dirty.current.category = true
                }}
                disabled={!initialized || flatCategories.length === 0}
                className={cn(
                  'flex-1 px-2 py-1.5 text-sm rounded',
                  'bg-white dark:bg-slate-900',
                  'border border-slate-200 dark:border-slate-700',
                  'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
                  'disabled:opacity-60',
                )}
              >
                {flatCategories.length === 0 ? (
                  <option value="">（暂无分类，请先到主页面新建）</option>
                ) : (
                  flatCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {'  '.repeat(c.depth)}
                      {c.depth > 0 ? '└ ' : ''}
                      {c.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* AI 建议提示条：当 AI 给了 categoryName 但被 dirty 阻止覆盖时
                给用户一个"AI 推荐 → 立即采用"的快捷链接 */}
            {aiState.last?.categoryName &&
              dirty.current.category &&
              aiState.last.categoryName !==
                categories.find((c) => c.id === targetCategoryId)?.name && (
                <div className="text-[10px] text-slate-400 px-0.5">
                  ✨ AI 建议分类：
                  <button
                    type="button"
                    onClick={() => {
                      const hit = categories.find(
                        (c) => c.name === aiState.last?.categoryName,
                      )
                      if (hit) setTargetCategoryId(hit.id)
                    }}
                    className="text-brand hover:underline"
                  >
                    {aiState.last.categoryName}
                  </button>
                </div>
              )}

            {/* 状态条 + 提交按钮 */}
            <div className="flex items-center gap-2 pt-0.5">
              <StatusHint state={submitState} />
              <button
                type="button"
                onClick={handleAddCurrentPage}
                disabled={!canAdd}
                className={cn(
                  'h-8 px-3 text-xs font-medium rounded shrink-0 transition-colors',
                  canAdd
                    ? 'bg-brand text-white hover:bg-brand-600'
                    : 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500 cursor-not-allowed',
                )}
              >
                {submitState === 'saving'
                  ? '添加中…'
                  : submitState === 'saved'
                    ? '✓ 已添加'
                    : '添加到 Curio'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * 读取当前激活的 tab 信息。
 * 失败（无 tabs 权限 / 用户拒绝 / popup 被独立打开）时返回 null。
 */
async function loadActiveTab(): Promise<{ url: string; title: string } | null> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true })
    const t = tabs[0]
    if (!t || !t.url) return null
    return { url: t.url, title: (t.title || '').trim() }
  } catch {
    return null
  }
}

/**
 * 把分类树拉平为 [{ id, name, depth }, ...]，按层级缩进显示在 select 中。
 * 严格按 order 排序，确保和侧栏顺序一致。
 */
function buildIndentedList(
  categories: Category[],
): Array<{ id: string; name: string; depth: number }> {
  const byParent = new Map<string, Category[]>()
  for (const c of categories) {
    const k = c.parentId ?? ''
    const list = byParent.get(k) ?? []
    list.push(c)
    byParent.set(k, list)
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.order - b.order)
  }
  const result: Array<{ id: string; name: string; depth: number }> = []
  const dfs = (parentKey: string, depth: number) => {
    const siblings = byParent.get(parentKey) ?? []
    for (const c of siblings) {
      result.push({ id: c.id, name: c.name, depth })
      dfs(c.id, depth + 1)
    }
  }
  dfs('', 0)
  return result
}

/**
 * 解析 tags 输入框：按 空格 / 逗号 / 中文逗号 / 顿号 拆分。
 * 与 useBookmarkStore.normalizeTags 同口径（trim、去空、去重、上限）。
 * 这里只做轻校验，最终落库前 store 还会再过一次硬上限。
 */
function parseTagsInput(raw: string): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(/[\s,，、]+/)) {
    const t = part.trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t.slice(0, 12))
    if (out.length >= 8) break
  }
  return out
}

/** 浏览器内部 URL 的友好标识 */
function getProtocolLabel(url: string): string {
  const m = /^([a-z-]+):/i.exec(url)
  return m ? m[1] : '内部'
}

function StatusHint({
  state,
}: {
  state: 'idle' | 'saving' | 'saved' | 'duplicate' | 'invalid'
}) {
  if (state === 'duplicate') {
    return (
      <span className="flex-1 text-[11px] text-amber-600 dark:text-amber-400">
        该分类下已有此 URL
      </span>
    )
  }
  if (state === 'invalid') {
    return (
      <span className="flex-1 text-[11px] text-red-500">
        添加失败，请检查标题与 URL
      </span>
    )
  }
  return <span className="flex-1" />
}
