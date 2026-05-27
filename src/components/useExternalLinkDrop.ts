import { useCallback, useRef, useState } from 'react'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { toast } from '../stores/useToastStore'

/**
 * 外部链接拖入快速添加书签（v0.22.x）
 *
 * 与 dnd-kit 内部卡片拖拽完全独立：
 * - dnd-kit 走自定义事件系统，不挂原生 DataTransfer.types
 * - 我们通过 types 判断是不是"外部"拖入（含 text/uri-list / text/plain / text/html）
 * - 同时挂监听不会让两套系统打架
 *
 * 触发场景：
 * - 从另一个 tab 拖一个 link / page favicon 到 Curio → 自动添加书签
 * - 从桌面 / Finder 拖一个 .url / .webloc 文件 → 解析 URL 后添加
 *
 * 目标分类判定（优先级从高到低）：
 *   1. 拖入位置命中某个 [data-card-drop-target] → 用该 section 的分类
 *   2. 当前 activeCategory（用户已选中的分类）
 *   3. 都没有 → toast 错误，提示先选分类
 *
 * 标题来源（优先级从高到低）：
 *   1. text/html 里的 <a> 文本（拖 tab 的链接通常会附 HTML 片段，含 anchor 文本）
 *   2. URL 的 hostname（兜底，用户可后续双击编辑）
 */

export interface UseExternalLinkDropResult {
  /** 当前拖入悬停的目标分类 id（用于视觉反馈层显示「松开添加到 X」） */
  hoveredCategoryId: string | null
  /** main 元素上挂的 dragover */
  onDragOver: (e: React.DragEvent<HTMLElement>) => void
  /** main 元素上挂的 dragleave */
  onDragLeave: (e: React.DragEvent<HTMLElement>) => void
  /** main 元素上挂的 drop */
  onDrop: (e: React.DragEvent<HTMLElement>) => void
}

export function useExternalLinkDrop(): UseExternalLinkDropResult {
  const addCard = useBookmarkStore((s) => s.addCard)
  const activeCategoryId = useBookmarkStore((s) => s.activeCategoryId)
  const categories = useBookmarkStore((s) => s.categories)

  const [hoveredCategoryId, setHoveredCategoryId] = useState<string | null>(null)
  // 引用计数避免子元素 dragleave 误清空：每次 dragenter +1，dragleave -1
  // 但 React 合成事件没有 dragenter on hook level，简化为「检查 relatedTarget 是否仍在 main 内」
  const dragDepthRef = useRef(0)

  const resolveTargetCategoryId = useCallback(
    (e: React.DragEvent<HTMLElement>): string | null => {
      const node = e.target as HTMLElement | null
      const dropTarget = node?.closest('[data-card-drop-target]')
      const fromSection = dropTarget?.getAttribute('data-card-drop-target')
      return fromSection ?? activeCategoryId ?? null
    },
    [activeCategoryId],
  )

  const onDragOver = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (!isExternalUrlDrag(e)) return
      e.preventDefault() // 必须 preventDefault，浏览器才会触发 drop
      // copy 光标比 move 更符合"添加书签"的语义
      e.dataTransfer.dropEffect = 'copy'
      const next = resolveTargetCategoryId(e)
      if (next !== hoveredCategoryId) setHoveredCategoryId(next)
    },
    [hoveredCategoryId, resolveTargetCategoryId],
  )

  const onDragLeave = useCallback((e: React.DragEvent<HTMLElement>) => {
    if (!isExternalUrlDrag(e)) return
    // 子元素 dragleave 时 relatedTarget 仍在 currentTarget 内 → 忽略
    const next = e.relatedTarget as Node | null
    if (next && e.currentTarget.contains(next)) return
    dragDepthRef.current = 0
    setHoveredCategoryId(null)
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      if (!isExternalUrlDrag(e)) return
      e.preventDefault()
      setHoveredCategoryId(null)
      dragDepthRef.current = 0

      const parsed = parseUrlFromDataTransfer(e.dataTransfer)
      if (!parsed) {
        // 拖入了东西但解析不出 URL（可能是纯文本 / 不支持的协议）
        toast.error('未识别为链接', '拖入内容不是合法的 http/https URL')
        return
      }

      const targetCatId = resolveTargetCategoryId(e)
      if (!targetCatId) {
        toast.error(
          '请先选择一个分类',
          '左侧侧栏选中目标分类后，再拖入链接',
        )
        return
      }
      const cat = categories.find((c) => c.id === targetCatId)
      if (!cat) return

      void (async () => {
        try {
          await addCard({
            categoryId: targetCatId,
            title: parsed.title,
            url: parsed.url,
          })
          toast.success(
            '已添加书签',
            `「${parsed.title}」→ ${cat.name}`,
          )
        } catch (err) {
          console.error('[link-drop] addCard failed', err)
          toast.error(
            '添加失败',
            err instanceof Error ? err.message : '未知错误',
          )
        }
      })()
    },
    [addCard, categories, resolveTargetCategoryId],
  )

  return { hoveredCategoryId, onDragOver, onDragLeave, onDrop }
}

/* ─── 内部工具 ─────────────────────────────────────── */

/**
 * 判断是不是来自外部的 URL 拖拽
 * - dnd-kit 内部拖拽：types 是空（不挂原生 DataTransfer）
 * - 外部链接：包含 text/uri-list 或 text/plain
 * - 外部文件：包含 Files（拖 .url / .webloc 等本地文件）
 */
function isExternalUrlDrag(e: React.DragEvent): boolean {
  const types = e.dataTransfer?.types
  if (!types || types.length === 0) return false
  return (
    types.includes('text/uri-list') ||
    types.includes('text/plain') ||
    types.includes('text/html')
  )
}

interface ParsedUrl {
  url: string
  title: string
}

/**
 * 从 DataTransfer 解析出 URL + 标题
 * - URL 必须是 http / https，其他协议（chrome://、file:// 等）拒绝
 * - 标题优先取 text/html 的 <a> 文本，否则用 hostname
 */
function parseUrlFromDataTransfer(dt: DataTransfer | null): ParsedUrl | null {
  if (!dt) return null

  // 1) 找 URL：优先 text/uri-list（W3C 标准），回退 text/plain
  let rawUrl = ''
  const uriList = dt.getData('text/uri-list')
  if (uriList) {
    // uri-list 格式：每行一个 URL，# 开头是注释；取第一个非注释行
    for (const line of uriList.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      rawUrl = t
      break
    }
  }
  if (!rawUrl) {
    const plain = dt.getData('text/plain').trim()
    if (plain && /^https?:\/\//i.test(plain)) rawUrl = plain
  }
  if (!rawUrl) return null

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  if (!/^https?:$/i.test(parsed.protocol)) return null

  // 2) 找标题：从 text/html 解析 <a> 标签的文本
  let title = ''
  const html = dt.getData('text/html')
  if (html) {
    // 用 DOMParser 比正则更稳，能处理嵌套 HTML / 转义实体
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const a = doc.querySelector('a')
      const text = a?.textContent?.trim()
      if (text && text !== parsed.href) title = text
    } catch {
      /* DOMParser 失败兜底 */
    }
  }

  // 3) 兜底：hostname 作标题；用户可后续双击编辑
  if (!title) title = parsed.hostname

  // 标题截断到 200 字符（防止 HTML 里塞了一大段文本）
  return { url: rawUrl, title: title.slice(0, 200) }
}
