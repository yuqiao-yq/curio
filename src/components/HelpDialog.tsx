import { useEffect } from 'react'
import { cn } from '../utils/cn'

/**
 * 帮助文档弹窗
 *
 * 设计取舍：
 * - 复用顶栏 DialogShell 的视觉（标题/体/底三段 + 遮罩 + ESC 关闭），
 *   但不引入 react-markdown 等额外依赖，自己实现一个轻量 markdown 解析器，
 *   覆盖：标题 / 段落 / 列表 / fenced 代码块 / 行内代码 / 粗斜体 /
 *        链接 / 引用 / 分隔线 / 管道表格。
 * - 这样 docs/USER_GUIDE.md 既是仓库内开发者文档，也是弹窗内容唯一来源；
 *   通过 Vite 的 `?raw` 后缀以纯文本方式 import，避免双份维护。
 */
interface Props {
  /** 完整的 markdown 源文本（来自 docs/USER_GUIDE.md?raw） */
  source: string
  onClose: () => void
}

export function HelpDialog({ source, onClose }: Props) {
  // ESC 关闭（与 Topbar.DialogShell 的快捷键策略保持一致）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'flex flex-col w-[860px] max-w-full max-h-[88vh] rounded-lg shadow-2xl',
          'bg-white dark:bg-slate-800',
          'border border-slate-200 dark:border-slate-700',
        )}
      >
        {/* 头 */}
        <div className="px-5 py-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-700 shrink-0">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span className="text-base">📘</span>
            <span>使用文档</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'w-7 h-7 flex items-center justify-center rounded text-sm',
              'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
              'hover:bg-slate-100 dark:hover:bg-slate-700/60',
            )}
            title="关闭"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* 体（弹窗内独立滚动，不动背景） */}
        <div className="flex-1 overflow-y-auto px-6 py-5 prose-curio">
          <MarkdownView source={source} />
        </div>

        {/* 底 */}
        <div className="px-5 py-3 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-700 shrink-0">
          <span className="mr-auto text-[11px] text-slate-400">
            按 Esc 或点击空白区域关闭
          </span>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'px-3 py-1.5 text-sm rounded transition-colors',
              'text-slate-600 dark:text-slate-300',
              'hover:bg-slate-100 dark:hover:bg-slate-700/60',
            )}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * 轻量 Markdown 渲染器
 *
 * 块级解析（按行扫描，状态机）：
 *   - ``` fenced code block（保留原文，按行展示，可选语言提示）
 *   - # ## ### #### 标题（最多到 4 级）
 *   - --- *** ___ 分隔线
 *   - > 引用（合并连续行为一段）
 *   - - * + 无序列表 / 1. 2. 有序列表（连续同类合并）
 *   - | a | b |   pipe 表格（首行 + 分隔行 + 数据行）
 *   - 空行作为段落分隔
 *   - 其余作为段落（连续非空行合并为一段）
 *
 * 行内解析（recursive 替换为 React 节点数组）：
 *   - `inline code`
 *   - **bold** / __bold__
 *   - *italic* / _italic_
 *   - [text](url)
 *   - 自动换行（每行视为一个 token）
 * ───────────────────────────────────────────────────────────── */

function MarkdownView({ source }: { source: string }) {
  const blocks = parseBlocks(source)
  return (
    <>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </>
  )
}

// ─── 块类型定义 ─────────────────────────────────────
type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; lang: string; code: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'hr' }
  | {
      type: 'table'
      header: string[]
      align: ('left' | 'center' | 'right' | null)[]
      rows: string[][]
    }

function parseBlocks(src: string): Block[] {
  // 统一换行
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  const isBlank = (s: string) => s.trim() === ''
  // 分隔线：去掉空白后由 3+ 个相同的 `-` / `*` / `_` 组成
  const isHr = (s: string) => {
    const t = s.replace(/\s/g, '')
    return /^(-{3,}|\*{3,}|_{3,})$/.test(t)
  }

  while (i < lines.length) {
    const line = lines[i]

    // 1) Fenced code block
    const fence = /^\s*```\s*(\S*)\s*$/.exec(line)
    if (fence) {
      const lang = fence[1] || ''
      const buf: string[] = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      i++ // 跳过结束 ```
      blocks.push({ type: 'code', lang, code: buf.join('\n') })
      continue
    }

    // 2) 空行
    if (isBlank(line)) {
      i++
      continue
    }

    // 3) 标题
    const heading = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3 | 4
      blocks.push({ type: 'heading', level, text: heading[2] })
      i++
      continue
    }

    // 4) 分隔线
    if (isHr(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    // 5) 引用块（连续 > 行合并）
    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push({ type: 'quote', text: buf.join('\n') })
      continue
    }

    // 6) 表格（首行有 | 且下一行是分隔行）
    if (/\|/.test(line) && i + 1 < lines.length && isTableSepLine(lines[i + 1])) {
      const headerCells = splitTableRow(line)
      const align = parseTableAlign(lines[i + 1])
      i += 2
      const rows: string[][] = []
      while (
        i < lines.length &&
        /\|/.test(lines[i]) &&
        !isBlank(lines[i]) &&
        !/^\s*```/.test(lines[i])
      ) {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      blocks.push({ type: 'table', header: headerCells, align, rows })
      continue
    }

    // 7) 列表（无序 / 有序，连续同类合并）
    const ulMatch = /^\s*[-*+]\s+(.+)$/.exec(line)
    const olMatch = /^\s*\d+\.\s+(.+)$/.exec(line)
    if (ulMatch || olMatch) {
      const ordered = !!olMatch
      const items: string[] = []
      while (i < lines.length) {
        const cur = lines[i]
        const u = /^\s*[-*+]\s+(.+)$/.exec(cur)
        const o = /^\s*\d+\.\s+(.+)$/.exec(cur)
        if ((ordered && o) || (!ordered && u)) {
          items.push(((ordered ? o : u) as RegExpExecArray)[1])
          i++
        } else if (
          !isBlank(cur) &&
          /^\s{2,}\S/.test(cur) &&
          items.length > 0
        ) {
          // 列表项的续行（缩进 ≥ 2）拼到上一项
          items[items.length - 1] += '\n' + cur.trim()
          i++
        } else {
          break
        }
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    // 8) 段落：连续非空、非块级起始行合并
    const para: string[] = [line]
    i++
    while (i < lines.length) {
      const cur = lines[i]
      if (isBlank(cur)) break
      if (/^\s*```/.test(cur)) break
      if (/^(#{1,4})\s+/.test(cur)) break
      if (isHr(cur)) break
      if (/^\s*>\s?/.test(cur)) break
      if (/^\s*[-*+]\s+/.test(cur)) break
      if (/^\s*\d+\.\s+/.test(cur)) break
      if (/\|/.test(cur) && i + 1 < lines.length && isTableSepLine(lines[i + 1]))
        break
      para.push(cur)
      i++
    }
    blocks.push({ type: 'paragraph', text: para.join('\n') })
  }

  return blocks
}

function isTableSepLine(s: string): boolean {
  // 形如 | --- | :---: | ---: |
  const trimmed = s.trim()
  if (!/\|/.test(trimmed)) return false
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(trimmed)
}

function splitTableRow(s: string): string[] {
  let t = s.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map((c) => c.trim())
}

function parseTableAlign(
  s: string,
): ('left' | 'center' | 'right' | null)[] {
  return splitTableRow(s).map((c) => {
    const left = c.startsWith(':')
    const right = c.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    if (left) return 'left'
    return null
  })
}

// ─── 块渲染 ─────────────────────────────────────────
function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'heading': {
      const sizes: Record<number, string> = {
        1: 'text-2xl font-bold mt-2 mb-4 pb-2 border-b border-slate-200 dark:border-slate-700',
        2: 'text-xl font-semibold mt-7 mb-3 pb-1.5 border-b border-slate-200/70 dark:border-slate-700/70',
        3: 'text-base font-semibold mt-5 mb-2 text-slate-800 dark:text-slate-100',
        4: 'text-sm font-semibold mt-4 mb-1.5 text-slate-700 dark:text-slate-200',
      }
      const cls = sizes[block.level]
      const Tag = (`h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4')
      return (
        <Tag className={cn(cls, 'text-slate-900 dark:text-slate-50')}>
          <Inline text={block.text} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p className="my-3 leading-relaxed text-sm text-slate-700 dark:text-slate-300">
          <Inline text={block.text} />
        </p>
      )
    case 'code':
      return (
        <pre
          className={cn(
            'my-3 p-3 rounded-md overflow-x-auto text-xs leading-relaxed',
            'bg-slate-50 dark:bg-slate-900/60',
            'border border-slate-200 dark:border-slate-700',
            'font-mono text-slate-700 dark:text-slate-200',
          )}
        >
          <code>{block.code}</code>
        </pre>
      )
    case 'list':
      return block.ordered ? (
        <ol className="my-3 pl-6 list-decimal space-y-1 text-sm text-slate-700 dark:text-slate-300 marker:text-slate-400">
          {block.items.map((it, i) => (
            <li key={i} className="leading-relaxed">
              <Inline text={it} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="my-3 pl-6 list-disc space-y-1 text-sm text-slate-700 dark:text-slate-300 marker:text-slate-400">
          {block.items.map((it, i) => (
            <li key={i} className="leading-relaxed">
              <Inline text={it} />
            </li>
          ))}
        </ul>
      )
    case 'quote':
      return (
        <blockquote
          className={cn(
            'my-3 pl-3 py-1 border-l-4',
            'border-brand/40 bg-brand/5 dark:bg-brand/10',
            'text-sm text-slate-600 dark:text-slate-300',
            'rounded-r',
          )}
        >
          <Inline text={block.text} />
        </blockquote>
      )
    case 'hr':
      return <hr className="my-6 border-t border-slate-200 dark:border-slate-700" />
    case 'table':
      return (
        <div className="my-3 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900/60">
                {block.header.map((h, i) => (
                  <th
                    key={i}
                    className={cn(
                      'px-3 py-2 border border-slate-200 dark:border-slate-700',
                      'font-semibold text-slate-800 dark:text-slate-100',
                      alignClass(block.align[i]),
                    )}
                  >
                    <Inline text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr
                  key={ri}
                  className={ri % 2 ? 'bg-slate-50/40 dark:bg-slate-900/30' : ''}
                >
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={cn(
                        'px-3 py-2 border border-slate-200 dark:border-slate-700',
                        'text-slate-700 dark:text-slate-300 align-top',
                        alignClass(block.align[ci]),
                      )}
                    >
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

function alignClass(a: 'left' | 'center' | 'right' | null) {
  if (a === 'center') return 'text-center'
  if (a === 'right') return 'text-right'
  return 'text-left'
}

/* ─────────────────────────────────────────────────────────────
 * 行内解析：把单段文本切成 React 节点数组
 *
 * 优先级（从高到低）：
 *   1. 行内代码 `code`
 *   2. 链接 [text](url)
 *   3. 加粗 **text** / __text__
 *   4. 斜体 *text* / _text_
 *
 * 实现采用「正则 + 递归切分」：每次找最早出现的标记，
 * 把前缀按其余规则继续解析、把匹配体按对应规则解析、把后缀递归解析。
 * 这样既保证嵌套（粗体里出现链接也能正常）又避免写完整 AST。
 * ───────────────────────────────────────────────────────────── */
function Inline({ text }: { text: string }) {
  return <>{renderInline(text)}</>
}

function renderInline(text: string, keyPrefix = 'i'): React.ReactNode[] {
  // 先按行切分，给段落内自动换行（markdown 段内换行实际通常会被合并，
  // 但用户文档里偶尔需要 forced break，这里做温和处理：用空格连接，
  // 视觉上和源 markdown 接近且不破坏布局）
  const lines = text.split('\n')
  const joined = lines.join(' ')
  return parseInlineTokens(joined, keyPrefix)
}

function parseInlineTokens(
  text: string,
  keyPrefix: string,
): React.ReactNode[] {
  // 找最早匹配的标记
  type Hit = {
    start: number
    end: number
    kind: 'code' | 'link' | 'strong' | 'em'
    payload: any
  }

  const hits: Hit[] = []

  // 行内代码 `xxx`（不允许里面再有反引号）
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    hits.push({
      start: m.index!,
      end: m.index! + m[0].length,
      kind: 'code',
      payload: m[1],
    })
  }
  // 链接 [text](url)
  for (const m of text.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    hits.push({
      start: m.index!,
      end: m.index! + m[0].length,
      kind: 'link',
      payload: { text: m[1], href: m[2] },
    })
  }
  // 加粗 **xxx**（避免吃到斜体的 *xxx*）
  for (const m of text.matchAll(/\*\*([^*\n]+?)\*\*/g)) {
    hits.push({
      start: m.index!,
      end: m.index! + m[0].length,
      kind: 'strong',
      payload: m[1],
    })
  }
  // 加粗 __xxx__
  for (const m of text.matchAll(/__([^_\n]+?)__/g)) {
    hits.push({
      start: m.index!,
      end: m.index! + m[0].length,
      kind: 'strong',
      payload: m[1],
    })
  }
  // 斜体 *xxx*（避免与加粗重叠：要求左右非 *）
  for (const m of text.matchAll(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g)) {
    const prefix = m[1].length
    hits.push({
      start: m.index! + prefix,
      end: m.index! + prefix + m[2].length + 2,
      kind: 'em',
      payload: m[2],
    })
  }
  // 斜体 _xxx_
  for (const m of text.matchAll(/(^|[^_\w])_([^_\n]+?)_(?!_)/g)) {
    const prefix = m[1].length
    hits.push({
      start: m.index! + prefix,
      end: m.index! + prefix + m[2].length + 2,
      kind: 'em',
      payload: m[2],
    })
  }

  if (hits.length === 0) return [text]

  // 按 start 排序，去重叠（保留先出现的）
  hits.sort((a, b) => a.start - b.start || b.end - a.end)
  const filtered: Hit[] = []
  let cursor = 0
  for (const h of hits) {
    if (h.start < cursor) continue
    filtered.push(h)
    cursor = h.end
  }

  const nodes: React.ReactNode[] = []
  let pos = 0
  filtered.forEach((h, idx) => {
    if (h.start > pos) {
      nodes.push(text.slice(pos, h.start))
    }
    const k = `${keyPrefix}-${idx}`
    if (h.kind === 'code') {
      nodes.push(
        <code
          key={k}
          className={cn(
            'px-1 py-0.5 rounded text-[0.85em] font-mono',
            'bg-slate-100 dark:bg-slate-700/60',
            'text-rose-600 dark:text-rose-300',
          )}
        >
          {h.payload}
        </code>,
      )
    } else if (h.kind === 'link') {
      const { text: t, href } = h.payload
      nodes.push(
        <a
          key={k}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand hover:underline break-all"
        >
          {t}
        </a>,
      )
    } else if (h.kind === 'strong') {
      nodes.push(
        <strong key={k} className="font-semibold text-slate-900 dark:text-slate-50">
          {parseInlineTokens(String(h.payload), `${k}-`)}
        </strong>,
      )
    } else if (h.kind === 'em') {
      nodes.push(
        <em key={k} className="italic">
          {parseInlineTokens(String(h.payload), `${k}-`)}
        </em>,
      )
    }
    pos = h.end
  })
  if (pos < text.length) nodes.push(text.slice(pos))
  return nodes
}
