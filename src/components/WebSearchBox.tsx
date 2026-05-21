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

export function WebSearchBox() {
  const [engine, setEngine] = useState<Engine>(() => loadEngine())
  const [raw, setRaw] = useState('')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // 本地搜索：把"实际查询词"同步到 store（@web 模式时清掉，避免主区被误切到搜索视图）
  const cards = useBookmarkStore((s) => s.cards)
  const setSearchKeyword = useBookmarkStore((s) => s.setSearchKeyword)
  const storeKeyword = useBookmarkStore((s) => s.searchKeyword)
  const parsed = useMemo(() => parseQuery(raw), [raw])

  /**
   * 把 raw 同步到 store.searchKeyword：
   * - web 模式：清掉，避免主区误切到本地搜索
   * - tag 模式：保留 `#xxx` 原文写入 store（让 BookmarkGrid 据此切换为 tag 筛选视图）
   * - ai 模式：保留 `@ai xxx` 原文写入 store（让 BookmarkGrid 走语义检索）
   * - local / auto：写入"去前缀"的 q（兼容历史行为）
   */
  useEffect(() => {
    if (parsed.mode === 'web') {
      setSearchKeyword('')
    } else if (parsed.mode === 'tag') {
      setSearchKeyword(parsed.q ? `#${parsed.q}` : '')
    } else if (parsed.mode === 'ai') {
      setSearchKeyword(parsed.q ? `@ai ${parsed.q}` : '')
    } else {
      setSearchKeyword(parsed.q)
    }
    // 组件卸载时清掉，避免下次 mount 残留
    return () => setSearchKeyword('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.mode, parsed.q])

  /**
   * 反向同步：外部源（卡片上 tag chip / 标签管理面板）通过
   * `setSearchKeyword('#xxx')` 触发筛选时，搜索框也要显示出 `#xxx`，
   * 否则用户看不到当前过滤条件、也无法清除。
   *
   * 触发条件：storeKeyword 与本地推得的"应写入值"不一致时，把 storeKeyword
   * 拷贝到 raw（这一步会再触发上面那个 useEffect，但二者最终一致后停止迭代）。
   */
  useEffect(() => {
    // 计算"按当前 raw 应写入 store 的值"
    let derived = ''
    if (parsed.mode === 'web') derived = ''
    else if (parsed.mode === 'tag') derived = parsed.q ? `#${parsed.q}` : ''
    else if (parsed.mode === 'ai') derived = parsed.q ? `@ai ${parsed.q}` : ''
    else derived = parsed.q
    if (storeKeyword !== derived) {
      setRaw(storeKeyword)
    }
    // 仅依赖 storeKeyword：raw 变化时另一个 useEffect 已经在维护一致性
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
        'shrink-0 inline-flex items-center gap-1 h-6 px-1.5 rounded text-[10px] font-medium',
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

  return (
    <div ref={wrapRef} className="relative flex-1 max-w-xl mx-auto">
      <div
        className={cn(
          'flex items-center gap-1 h-9 pl-2 pr-1 rounded-lg',
          'border border-slate-200 dark:border-slate-700',
          'bg-white/60 dark:bg-slate-800/60 backdrop-blur',
          'focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20 transition-all',
        )}
      >
        {/* 引擎选择按钮 */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex items-center gap-1 h-7 px-1.5 rounded shrink-0',
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

        <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1 shrink-0" />

        {modeChip}

        <input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') setRaw('')
          }}
          placeholder="搜索书签 / 网页…  @web 网页 · #标签 · @ai 语义"
          className={cn(
            'flex-1 min-w-0 h-full px-2 text-sm bg-transparent outline-none',
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
          className={cn(
            'h-7 px-2.5 rounded text-xs font-medium transition-colors shrink-0',
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
