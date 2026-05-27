import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '../utils/cn'
import { getFaviconUrl } from '../utils/favicon'
import { useBookmarkStore } from '../stores/useBookmarkStore'

/**
 * 统一搜索框（替代浏览器地址栏 + 站内书签搜索）
 *
 * 行为：
 * - 默认：实时本地搜索（输入即同步到 store.searchKeyword，BookmarkGrid 切到搜索结果视图）
 * - 输入以 `@web ` 开头 → 标记为「网页搜索模式」，本地搜索结果不再触发；
 *   回车时去掉前缀，用所选搜索引擎打开新标签页
 * - 输入以 `@bm ` 开头 → 强制本地搜索（语义化别名，行为与默认一致）
 * - 输入以 `@ai ` 开头 → AI 语义搜索：把原始字符串（含前缀）写入 store，
 *   BookmarkGrid 调 embedder.searchByEmbedding 按余弦相似度排序（V1.5 §5.1）
 * - 输入以 `#tag` 开头 → 标签筛选模式：把原始字符串（含 #）写入 store，
 *   BookmarkGrid 据此切换为「按 tag 精确筛选」视图。点书签卡上的 tag chip
 *   也会通过 store.setSearchKeyword('#xxx') 触发本框反向同步显示，统一入口。
 * - 默认模式回车：
 *     - 本地有匹配 → 打开第一个匹配书签（沿用用户最常见诉求：找一个书签直接打开）
 *     - 没有匹配     → 自动 fallback 到所选搜索引擎搜全网
 *
 * 之前 Breadcrumb 右侧也有一个独立的"搜索书签"框，跟顶部网页搜索分裂。
 * 现在统一到这里，减少认知负担与屏幕占用。
 */

interface Engine {
  id: string
  name: string
  /** 用于引擎图标的代表 URL */
  homepage: string
  /** {q} 占位符将被替换为编码后的查询词 */
  searchUrl: string
}

const ENGINES: Engine[] = [
  { id: 'google',     name: 'Google',     homepage: 'https://www.google.com',     searchUrl: 'https://www.google.com/search?q={q}' },
  { id: 'bing',       name: 'Bing',       homepage: 'https://www.bing.com',       searchUrl: 'https://www.bing.com/search?q={q}' },
  { id: 'baidu',      name: '百度',        homepage: 'https://www.baidu.com',       searchUrl: 'https://www.baidu.com/s?wd={q}' },
  { id: 'duckduckgo', name: 'DuckDuckGo', homepage: 'https://duckduckgo.com',     searchUrl: 'https://duckduckgo.com/?q={q}' },
]

const STORAGE_KEY = 'tabit:web-search-engine'

/**
 * v0.22.x 引导补充：placeholder 文案轮换。
 * 仅在「展开 + 未 focus + raw 为空」时切换，避免打断用户输入。
 * 4 秒一轮，循环展示，让用户被动发现隐藏入口（@ai / #tag / ⌘J）。
 */
const PLACEHOLDER_HINTS = [
  '搜索书签、输入网址，或使用 @web / #标签 / @ai',
  '试试 @ai 那篇讲 React 性能的',
  '试试 #工具 按标签筛选',
  '按 ⌘J / Ctrl+J 唤起 AI 助手',
] as const
const PLACEHOLDER_ROTATE_MS = 4000

/** 前缀解析：把 raw 拆成「模式 + 实际查询词」 */
type Mode = 'auto' | 'web' | 'local' | 'tag' | 'ai'
function parseQuery(raw: string): { mode: Mode; q: string } {
  const trimmed = raw.replace(/^\s+/, '')
  // 容错：允许 @web、@web<空格>、@web<tab> 等
  if (/^@web(\s+|$)/i.test(trimmed)) {
    return { mode: 'web', q: trimmed.replace(/^@web\s*/i, '').trim() }
  }
  if (/^@bm(\s+|$)/i.test(trimmed)) {
    return { mode: 'local', q: trimmed.replace(/^@bm\s*/i, '').trim() }
  }
  if (/^@ai(\s+|$)/i.test(trimmed)) {
    return { mode: 'ai', q: trimmed.replace(/^@ai\s*/i, '').trim() }
  }
  // tag 模式：以 # 开头（不需要空格分隔，#xxx 即可）
  if (/^#/.test(trimmed)) {
    return { mode: 'tag', q: trimmed.replace(/^#+/, '').trim() }
  }
  return { mode: 'auto', q: trimmed.trim() }
}

/**
 * 把输入字符串尝试解析为可直接跳转的 URL；非 URL 返回 null。
 *
 * 匹配规则（按优先级）：
 *  1. 已带 scheme（http / https / ftp / file / chrome-extension 等）→ 用 URL 校验后直接返回 href
 *  2. localhost[:port][/path]                                          → 自动补 http://
 *  3. IPv4 [:port][/path]                                              → 自动补 http://
 *  4. 域名形式 host.tld[:port][/path][?query][#hash]                    → 自动补 https://
 *
 * 防误判：
 *  - 含空白字符的输入直接判否（避免 "hello.com 搜索" 这种被误识别）
 *  - 域名必须至少含一个 `.` 且 TLD 是 2~24 个字母（排除 `3.14` / `1.2.3` 等数字串）
 *  - 已带 scheme 的字符串若 URL 构造失败则判否
 *
 * 不在此处处理：以 `@`/`#` 开头的"模式前缀"由 parseQuery 先一步剥离/拦截，
 * 进入本函数的 q 已经是纯查询词。
 */
function tryAsUrl(raw: string): string | null {
  const s = raw.trim()
  if (!s || /\s/.test(s)) return null

  // 1) 已带 scheme
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try {
      return new URL(s).href
    } catch {
      return null
    }
  }

  // 2) localhost / localhost:port / localhost/path
  if (/^localhost(:\d+)?(\/.*)?$/i.test(s)) {
    try {
      return new URL('http://' + s).href
    } catch {
      return null
    }
  }

  // 3) IPv4[:port][/path]
  if (/^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(s)) {
    try {
      return new URL('http://' + s).href
    } catch {
      return null
    }
  }

  // 4) 域名形式：xxx.tld[:port][/path][?query][#hash]
  //    - 主机段允许 a-zA-Z0-9- 且不能以 - 开头/结尾
  //    - TLD 段必须是 2~24 位纯字母（防止把 "v1.2" / "package.json" 类误判）
  const domainRe =
    /^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)(\.([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?))*\.[a-zA-Z]{2,24}(:\d+)?(\/[^\s]*)?(\?[^\s]*)?(#[^\s]*)?$/
  if (!domainRe.test(s)) return null
  try {
    return new URL('https://' + s).href
  } catch {
    return null
  }
}

function loadEngine(): Engine {
  try {
    const id = localStorage.getItem(STORAGE_KEY)
    return ENGINES.find((e) => e.id === id) ?? ENGINES[0]
  } catch {
    return ENGINES[0]
  }
}

const HISTORY_KEY = 'tabit:search-history'
const HISTORY_MAX = 20

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((s): s is string => typeof s === 'string').slice(0, HISTORY_MAX)
  } catch {
    return []
  }
}

function saveHistory(list: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)))
  } catch {
    /* localStorage 写失败（隐身模式等）不影响搜索本身，吞掉 */
  }
}

export function WebSearchBox() {
  const [engine, setEngine] = useState<Engine>(() => loadEngine())
  const [raw, setRaw] = useState('')
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [history, setHistory] = useState<string[]>(() => loadHistory())
  const wrapRef = useRef<HTMLDivElement | null>(null)

  /** 把一次提交记入最近搜索：去重 + 置顶，超过 HISTORY_MAX 截断 */
  const recordHistory = (q: string) => {
    const v = q.trim()
    if (!v) return
    setHistory((prev) => {
      const next = [v, ...prev.filter((s) => s !== v)].slice(0, HISTORY_MAX)
      saveHistory(next)
      return next
    })
  }
  const removeHistory = (q: string) => {
    setHistory((prev) => {
      const next = prev.filter((s) => s !== q)
      saveHistory(next)
      return next
    })
  }
  const clearHistory = () => {
    saveHistory([])
    setHistory([])
  }

  /**
   * v0.21.19：默认收起态，只露引擎按钮 + "搜索"占位；
   * hover / 聚焦 / 已有输入 / 引擎下拉打开 → 展开到最大宽度，展示完整提示。
   * 用 max-width 而非 width 做过渡，避免 flex 父容器抢回宽度造成跳变。
   */
  const expanded = hovered || focused || raw.length > 0 || open

  // placeholder 轮换索引：仅在空闲态（展开但未 focus 也无输入）时推进
  const [phIndex, setPhIndex] = useState(0)
  const placeholderIdle = expanded && !focused && raw.length === 0
  useEffect(() => {
    if (!placeholderIdle) return
    const t = setInterval(
      () => setPhIndex((i) => (i + 1) % PLACEHOLDER_HINTS.length),
      PLACEHOLDER_ROTATE_MS,
    )
    return () => clearInterval(t)
  }, [placeholderIdle])

  // 本地搜索：把"实际查询词"同步到 store（@web 模式时清掉，避免主区被误切到搜索视图）
  const cards = useBookmarkStore((s) => s.cards)
  const setSearchKeyword = useBookmarkStore((s) => s.setSearchKeyword)
  const storeKeyword = useBookmarkStore((s) => s.searchKeyword)
  const parsed = useMemo(() => parseQuery(raw), [raw])

  /**
   * 推导"按当前 raw 应写入 store 的值"。挑出来 useMemo 复用：
   * - web 模式：清掉，避免主区误切到本地搜索
   * - tag 模式：保留 `#xxx` 原文写入 store（让 BookmarkGrid 据此切换为 tag 筛选视图）
   * - ai 模式：保留 `@ai xxx` 原文写入 store（让 BookmarkGrid 走语义检索）
   * - local / auto：写入"去前缀"的 q（兼容历史行为）
   */
  const derivedKeyword = useMemo(() => {
    if (parsed.mode === 'web') return ''
    if (parsed.mode === 'tag') return parsed.q ? `#${parsed.q}` : ''
    if (parsed.mode === 'ai') return parsed.q ? `@ai ${parsed.q}` : ''
    return parsed.q
  }, [parsed])

  /**
   * v0.21.x debounce：每次按键都把 keyword 写进 store 会让 BookmarkGrid 整张表
   * 重做 Map + 排序 + 重渲染；中文输入法的 composition 期会非常卡。
   * 这里 180ms idle 后再写一次，让用户停止输入后再触发搜索。
   *
   * lastWrittenRef 记录最近一次"我们主动写进 store 的值"，用于：
   *   1) 与 derived 比较，避免在 debounce 期间反复 clearTimeout/setTimeout
   *   2) 让反向同步（下方 useEffect）区分外部源 vs 自己刚写入的回声 ——
   *      没有它的话，debounce 期间 store 仍是旧值，反向同步会把 raw 抹掉，
   *      造成用户输入被吞。
   *
   * 清空场景（按 ✕ / Esc）→ 立即 flush，否则用户看到的搜索结果会迟滞 180ms。
   */
  const lastWrittenRef = useRef<string>('')
  useEffect(() => {
    if (derivedKeyword === lastWrittenRef.current) return
    if (derivedKeyword === '') {
      lastWrittenRef.current = ''
      setSearchKeyword('')
      return
    }
    const t = setTimeout(() => {
      lastWrittenRef.current = derivedKeyword
      setSearchKeyword(derivedKeyword)
    }, 180)
    return () => clearTimeout(t)
  }, [derivedKeyword, setSearchKeyword])

  // 卸载时清掉 store keyword，避免下次 mount 残留
  useEffect(() => {
    return () => {
      lastWrittenRef.current = ''
      setSearchKeyword('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * 反向同步：外部源（卡片上 tag chip / 标签管理面板）通过
   * `setSearchKeyword('#xxx')` 触发筛选时，搜索框也要显示出 `#xxx`，
   * 否则用户看不到当前过滤条件、也无法清除。
   *
   * 用 lastWrittenRef 区分：storeKeyword 不等于我们最近一次写入的值时，
   * 说明是外部源动了，才把它拷回 raw。这样 debounce 期间不会被自己的回声打断。
   */
  useEffect(() => {
    if (storeKeyword !== lastWrittenRef.current) {
      lastWrittenRef.current = storeKeyword
      setRaw(storeKeyword)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeKeyword])

  // 持久化用户选择的引擎
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, engine.id)
    } catch {
      /* ignore */
    }
  }, [engine])

  // 点击外部关闭引擎下拉
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  /** 找到第一个匹配本地书签（默认模式回车的目标） */
  const firstLocalMatch = useMemo(() => {
    if (parsed.mode !== 'auto' || !parsed.q) return null
    const kw = parsed.q.toLowerCase()
    return (
      cards.find(
        (c) =>
          c.title.toLowerCase().includes(kw) ||
          c.url.toLowerCase().includes(kw),
      ) ?? null
    )
  }, [cards, parsed.mode, parsed.q])

  /**
   * 当前 q 是否看起来是 URL —— 仅在 auto 模式判定。
   * - local / web / tag / ai 各自有明确语义，即使输入是 URL 也不抢行为
   *   （例如 `@bm github.com` 表达的是"在本地书签里搜 github.com"，应保留原语义）
   */
  const urlPreview = useMemo(() => {
    if (parsed.mode !== 'auto' || !parsed.q) return null
    return tryAsUrl(parsed.q)
  }, [parsed.mode, parsed.q])

  const goWebSearch = (q: string) => {
    if (!q) return
    const url = engine.searchUrl.replace('{q}', encodeURIComponent(q))
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const submit = () => {
    const { mode, q } = parsed
    if (!q) return
    // 记录最近搜索：保留完整 raw（含 @web/@ai/#tag 前缀），
    // 之后点回这条历史能完整还原模式
    recordHistory(raw)

    if (mode === 'web') {
      goWebSearch(q)
      setRaw('')
      return
    }
    // tag / ai 模式回车：什么都不做（持续筛选；按 ✕ / Esc 才退出）
    if (mode === 'tag' || mode === 'ai') return

    // auto 模式：URL > 本地匹配 > 网页搜索
    //   优先级理由：用户明确粘了 / 敲了一个 URL，意图非常清晰，
    //   不应再分散到"本地模糊匹配"或"网页搜索"。
    //   如果用户确实想"用 URL 当关键词搜本地书签"，可显式 `@bm xxx` 兜底。
    if (mode === 'auto' && urlPreview) {
      window.open(urlPreview, '_blank', 'noopener,noreferrer')
      setRaw('')
      return
    }

    // local / auto：先尝试打开第一个匹配；没有就 fallback 到网页搜索（auto 模式下）
    if (firstLocalMatch) {
      window.open(firstLocalMatch.url, '_blank', 'noopener,noreferrer')
      setRaw('')
      return
    }
    if (mode === 'auto') {
      goWebSearch(q)
      setRaw('')
    }
    // local 模式没有匹配时不强行跳网页，避免误操作
  }

  // 视觉上模式标识：默认显示引擎 favicon，@web 模式高亮，@bm / tag / ai 各自有彩色徽标
  // auto 模式下若 q 被识别为 URL，临时切到 emerald 色 "链接" 徽标，让用户知道回车会直接跳转
  const isUrl = parsed.mode === 'auto' && !!urlPreview
  const modeChip = (
    <span
      className={cn(
        'shrink-0 inline-flex items-center gap-1 h-7 px-2 rounded-full text-[11px] font-medium',
        'transition-colors',
        parsed.mode === 'web'
          ? 'bg-brand text-white'
          : parsed.mode === 'local'
            ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300'
            : parsed.mode === 'tag'
              ? 'bg-violet-100 dark:bg-violet-500/20 text-violet-700 dark:text-violet-300'
              : parsed.mode === 'ai'
                ? 'bg-fuchsia-100 dark:bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300'
                : isUrl
                  ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                  : 'text-slate-400',
      )}
      title={
        parsed.mode === 'web'
          ? '网页搜索模式（@web）'
          : parsed.mode === 'local'
            ? '仅本地书签（@bm）'
            : parsed.mode === 'tag'
              ? '按标签筛选（#tag）'
              : parsed.mode === 'ai'
                ? 'AI 语义搜索（@ai）—— 需先在「⚙ 设置」生成 embedding'
                : isUrl
                  ? `识别为链接，回车直接打开：${urlPreview}`
                  : '本地优先；@web 网页搜索 · #tag 标签筛选 · @ai 语义搜索'
      }
    >
      {parsed.mode === 'web'
        ? '网页'
        : parsed.mode === 'local'
          ? '书签'
          : parsed.mode === 'tag'
            ? '标签'
            : parsed.mode === 'ai'
              ? '✨ AI'
              : isUrl
                ? '链接'
                : '智能'}
    </span>
  )

  /**
   * 历史下拉显示条件：
   * - 输入框聚焦
   * - 当前 raw 为空（用户清空了或还没输入）
   * - 有历史
   * - 引擎下拉未打开（同一位置同时只显示一个 popover）
   */
  const showHistory =
    focused && raw.length === 0 && history.length > 0 && !open

  return (
    <div
      ref={wrapRef}
      data-tour="search-box"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'relative mx-auto',
        // ease-out-expo 让展开/收起带回弹手感而不是机械匀速
        'transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]',
      )}
      // 用 width 而非 maxWidth：grid auto 轨道下 max-width 不会撑开盒子，
      // 必须显式给出宽度才能真正达到目标尺寸；max-width:100% 兜底窄屏
      style={{ width: expanded ? 540 : 360, maxWidth: '100%' }}
    >
      <div
        className={cn(
          'flex items-center gap-1.5 h-11 pl-2.5 pr-1.5 rounded-2xl',
          'border border-slate-200/80 dark:border-slate-700/80',
          'bg-white/80 dark:bg-slate-900/75 backdrop-blur',
          'shadow-sm shadow-slate-900/5',
          'focus-within:border-brand/70 focus-within:ring-4 focus-within:ring-brand/15 focus-within:shadow-md focus-within:bg-white dark:focus-within:bg-slate-900',
          'transition-all duration-300',
        )}
      >
        {/* 引擎选择按钮 */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex items-center gap-1 h-8 px-2 rounded-xl shrink-0',
            'text-xs text-slate-600 dark:text-slate-300',
            'hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors',
          )}
          title={`切换网页搜索引擎（当前：${engine.name}）`}
        >
          <img
            src={getFaviconUrl(engine.homepage, 16)}
            alt=""
            className="w-4 h-4 rounded-sm"
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
            }}
          />
          <span className="text-[10px] text-slate-400 leading-none">▾</span>
        </button>

        {/* divider + 模式徽标：收起态隐藏（淡出 + 收宽），让搜索框保持轻盈 */}
        <div
          className={cn(
            'flex items-center gap-1.5 overflow-hidden shrink-0',
            'transition-all duration-300 ease-out',
            expanded
              ? 'max-w-[120px] opacity-100'
              : 'max-w-0 opacity-0 -ml-1.5',
          )}
          aria-hidden={!expanded}
        >
          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-0.5 shrink-0" />
          {modeChip}
        </div>

        <input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') setRaw('')
          }}
          placeholder={expanded ? PLACEHOLDER_HINTS[phIndex] : '搜索'}
          className={cn(
            'flex-1 min-w-0 h-full px-2 text-[15px] bg-transparent outline-none',
            'placeholder:text-slate-400',
          )}
        />

        {raw && (
          <button
            type="button"
            onClick={() => setRaw('')}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-1.5 text-xs h-7 shrink-0"
            title="清空 (Esc)"
          >✕</button>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={
            !parsed.q || parsed.mode === 'tag' || parsed.mode === 'ai'
          }
          tabIndex={expanded ? 0 : -1}
          aria-hidden={!expanded}
          className={cn(
            'h-8 rounded-xl text-xs font-semibold shrink-0 overflow-hidden whitespace-nowrap',
            'transition-all duration-300 ease-out',
            expanded ? 'max-w-[120px] px-3 opacity-100' : 'max-w-0 px-0 opacity-0',
            parsed.q && parsed.mode !== 'tag' && parsed.mode !== 'ai'
              ? 'bg-brand text-white hover:bg-brand-600'
              : 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500 cursor-not-allowed',
          )}
          title={
            parsed.mode === 'web'
              ? `用 ${engine.name} 搜索网页 (Enter)`
              : parsed.mode === 'tag'
                ? '标签筛选无需回车；点 ✕ 退出筛选'
                : parsed.mode === 'ai'
                  ? '语义搜索无需回车；输入即按相似度排序'
                  : isUrl
                    ? `前往：${urlPreview}`
                    : firstLocalMatch
                      ? `打开匹配书签：${firstLocalMatch.title}`
                      : `用 ${engine.name} 搜索网页 (Enter)`
          }
        >
          {parsed.mode === 'tag'
            ? '筛选中'
            : parsed.mode === 'ai'
              ? '✨ 检索中'
              : isUrl
                ? '前往'
                : parsed.mode === 'web' || (parsed.mode === 'auto' && !firstLocalMatch)
                  ? '搜网页'
                  : '打开'}
        </button>
      </div>

      {/* 最近搜索下拉：聚焦且 raw 为空时显示
          mousedown preventDefault 避免点击让 input 失焦，从而触发收起动画把列表"点空" */}
      {showHistory && (
        <div
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            'absolute z-20 left-0 right-0 mt-1.5 py-1 rounded-lg max-h-[320px] overflow-y-auto',
            'border border-slate-200 dark:border-slate-700',
            'bg-white dark:bg-slate-800 shadow-lg',
          )}
        >
          <div className="px-3 pt-1.5 pb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400">
            <span>最近搜索</span>
            <button
              type="button"
              onClick={clearHistory}
              className="normal-case tracking-normal text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              title="清空全部历史"
            >
              清空
            </button>
          </div>
          {history.map((q) => (
            <div
              key={q}
              className={cn(
                'group/hist flex items-center gap-1 px-2 text-sm',
                'hover:bg-slate-100 dark:hover:bg-slate-700/60',
                'text-slate-700 dark:text-slate-200',
              )}
            >
              <button
                type="button"
                onClick={() => setRaw(q)}
                className="flex-1 min-w-0 flex items-center gap-2 px-1 py-1.5 text-left truncate"
                title={`再次搜索：${q}`}
              >
                <span className="text-slate-400 shrink-0">⌕</span>
                <span className="truncate">{q}</span>
              </button>
              <button
                type="button"
                onClick={() => removeHistory(q)}
                className={cn(
                  'shrink-0 opacity-0 group-hover/hist:opacity-100 transition-opacity',
                  'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
                  'px-1.5 h-6 text-xs',
                )}
                title="删除这条记录"
                aria-label={`删除历史：${q}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 引擎下拉列表 */}
      {open && (
        <div
          className={cn(
            'absolute z-20 left-0 mt-1.5 min-w-[200px] py-1 rounded-lg',
            'border border-slate-200 dark:border-slate-700',
            'bg-white dark:bg-slate-800 shadow-lg',
          )}
        >
          <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-slate-400">
            网页搜索引擎
          </div>
          {ENGINES.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => { setEngine(e); setOpen(false) }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left',
                'hover:bg-slate-100 dark:hover:bg-slate-700/60',
                e.id === engine.id ? 'text-brand font-medium' : 'text-slate-700 dark:text-slate-200',
              )}
            >
              <img
                src={getFaviconUrl(e.homepage, 16)}
                alt=""
                className="w-4 h-4 rounded-sm"
                onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
              />
              <span className="flex-1">{e.name}</span>
              {e.id === engine.id && <span className="text-xs">✓</span>}
            </button>
          ))}
          <div className="mt-1 px-3 pt-1.5 pb-1 border-t border-slate-100 dark:border-slate-700/60 text-[10px] text-slate-400 leading-relaxed">
            提示：<code className="font-mono text-slate-500">@web 关键字</code> 走网页搜索；<code className="font-mono text-slate-500">@bm 关键字</code> 仅查本地书签；<code className="font-mono text-slate-500">#标签名</code> 按标签筛选；<code className="font-mono text-slate-500">@ai 关键字</code> AI 语义搜索（需先在 ⚙ 设置生成 embedding）。
          </div>
        </div>
      )}
    </div>
  )
}
