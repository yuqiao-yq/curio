import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { BookmarkCard } from '../types/bookmark'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { normalizeTags } from '../stores/useBookmarkStore/helpers'
import { cn } from '../utils/cn'
import { DialogShell } from './Topbar/DialogShell'

/**
 * 卡片标签编辑器（v0.22.2 引入）
 *
 * 之前 tag 只在 AI 浮窗 LabelsTab 有批量管理面板，单张卡片层面没有
 * 新增 / 删除 / 修改入口 —— 用户报的体验缺口。
 *
 * 设计：
 * - 复用 Topbar/DialogShell 通用弹层壳（与设置 / 数据管理弹窗同款视觉）
 * - 当前 tags 渲染为 chips，每个 chip 右侧 ✕ 删除
 * - 输入框 + Enter 或「+ 添加」按钮新增
 * - 自动聚合全库其他卡片的 tags 作为「常用」推荐，点击直接加入
 * - 提交前走 helpers.normalizeTags（trim / 12 字符上限 / 大小写去重 / ≤ 8 个）
 *   保持与全局 tag 数据契约一致
 * - 保存时调用 setCardTags（空数组 = 清空，会被 slice 标准化为 undefined）
 */

const MAX_TAGS = 8
const MAX_TAG_LENGTH = 12

interface Props {
  card: BookmarkCard
  onClose: () => void
}

export function TagsEditorDialog({ card, onClose }: Props) {
  const setCardTags = useBookmarkStore((s) => s.setCardTags)
  const allCards = useBookmarkStore((s) => s.cards)

  // 全库已有 tags（除自己），用于「常用」推荐
  const suggested = useMemo(() => {
    const counter = new Map<string, number>()
    for (const c of allCards) {
      if (c.id === card.id) continue
      if (!c.tags) continue
      for (const t of c.tags) counter.set(t, (counter.get(t) ?? 0) + 1)
    }
    // 按使用次数降序，截断 12 个
    return Array.from(counter.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([t]) => t)
  }, [allCards, card.id])

  const [tags, setTags] = useState<string[]>(() => card.tags ?? [])
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const original = useMemo(
    () => normalizeTags(card.tags ?? []).join('\u0001'),
    [card.tags],
  )

  // 进入后自动聚焦输入框
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  /**
   * 添加 tag 共用逻辑：
   * - trim + 去 `#` 前缀
   * - 长度 / 数量 / 重复校验
   * - 大小写不敏感比对（与 normalizeTags 行为对齐）
   */
  const tryAddTag = (raw: string): boolean => {
    const t = raw.trim().replace(/^#+/, '').slice(0, MAX_TAG_LENGTH)
    if (!t) {
      setError(null)
      return false
    }
    if (tags.length >= MAX_TAGS) {
      setError(`最多 ${MAX_TAGS} 个标签`)
      return false
    }
    const lower = t.toLowerCase()
    if (tags.some((existing) => existing.toLowerCase() === lower)) {
      setError(`「${t}」已存在`)
      return false
    }
    setTags([...tags, t])
    setError(null)
    return true
  }

  const removeTag = (t: string) => {
    setTags(tags.filter((x) => x !== t))
    setError(null)
  }

  const handleSubmitInput = () => {
    if (tryAddTag(input)) setInput('')
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await setCardTags(card.id, tags)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const dirty = normalizeTags(tags).join('\u0001') !== original
  const reachedMax = tags.length >= MAX_TAGS

  return createPortal(
    <DialogShell
      title={
        <span className="flex items-center gap-2">
          <TagSvg />
          <span>编辑标签</span>
          <span className="text-xs font-normal text-slate-400 truncate max-w-[220px]">
            「{card.title}」
          </span>
        </span>
      }
      width={480}
      onClose={() => (saving ? undefined : onClose())}
      footer={
        <>
          <span className="mr-auto text-[11px] text-slate-400">
            {tags.length}/{MAX_TAGS} · 每个 ≤ {MAX_TAG_LENGTH} 字
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className={cn(
              'px-3 py-1.5 text-sm rounded transition-colors',
              'text-slate-600 dark:text-slate-300',
              'hover:bg-slate-100 dark:hover:bg-slate-700/60',
              saving && 'opacity-50 cursor-not-allowed',
            )}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !dirty}
            className={cn(
              'px-3 py-1.5 text-sm font-medium rounded transition-colors',
              dirty
                ? 'bg-brand text-white hover:bg-brand-600'
                : 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500 cursor-not-allowed',
              saving && 'opacity-70',
            )}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* 当前 tags 区 */}
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            当前标签
          </div>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span
                  key={t}
                  className={cn(
                    'inline-flex items-center gap-1 pl-2 pr-1 h-7 rounded-full text-xs',
                    'bg-brand/10 text-brand dark:bg-brand/20',
                  )}
                >
                  <span className="max-w-[120px] truncate">{t}</span>
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    className={cn(
                      'inline-flex items-center justify-center w-4 h-4 rounded-full',
                      'text-brand/70 hover:text-brand hover:bg-brand/15',
                      'transition-colors',
                    )}
                    title={`移除「${t}」`}
                    aria-label={`移除标签 ${t}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-400 italic">
              暂无标签 · 在下方输入框添加
            </div>
          )}
        </div>

        {/* 输入新 tag */}
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
            新增标签
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value.slice(0, MAX_TAG_LENGTH))
                if (error) setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSubmitInput()
                }
              }}
              disabled={reachedMax}
              placeholder={
                reachedMax
                  ? `已达上限 ${MAX_TAGS} 个`
                  : '输入标签名，按 Enter 添加'
              }
              maxLength={MAX_TAG_LENGTH}
              className={cn(
                'flex-1 h-9 px-3 text-sm rounded-md',
                'bg-white dark:bg-slate-900',
                'border border-slate-200 dark:border-slate-700',
                'focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
                'disabled:bg-slate-50 dark:disabled:bg-slate-800/60',
                'disabled:text-slate-400 disabled:cursor-not-allowed',
              )}
            />
            <button
              type="button"
              onClick={handleSubmitInput}
              disabled={reachedMax || !input.trim()}
              className={cn(
                'h-9 px-3 text-sm font-medium rounded-md transition-colors',
                input.trim() && !reachedMax
                  ? 'bg-brand text-white hover:bg-brand-600'
                  : 'bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500 cursor-not-allowed',
              )}
            >
              + 添加
            </button>
          </div>
          {error && (
            <div className="mt-1.5 text-[11px] text-rose-500">{error}</div>
          )}
        </div>

        {/* 常用 tags（聚合全库其他卡片） */}
        {suggested.length > 0 && (
          <div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
              常用（点击添加）
            </div>
            <div className="flex flex-wrap gap-1.5">
              {suggested.map((t) => {
                const already = tags.some(
                  (x) => x.toLowerCase() === t.toLowerCase(),
                )
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => tryAddTag(t)}
                    disabled={already || reachedMax}
                    className={cn(
                      'inline-flex items-center px-2 h-6 rounded-full text-[11px]',
                      'transition-colors',
                      already
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-300 dark:text-slate-600 cursor-not-allowed'
                        : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-brand/10 hover:text-brand',
                    )}
                    title={already ? '已添加' : `添加「${t}」`}
                  >
                    {already ? '✓ ' : '+ '}
                    <span className="max-w-[100px] truncate">{t}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </DialogShell>,
    document.body,
  )
}

/** 与 CardMenu.MenuIcons 同款 14×14 stroke 风格的 tag icon */
function TagSvg() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <circle cx="7" cy="7" r="1" />
    </svg>
  )
}

/** 给 BookmarkCardItem 菜单复用同款 icon（避免重复 svg 字面量） */
export { TagSvg as TagIcon }
