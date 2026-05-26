import { useEffect, useMemo, useState } from 'react'
import { useBookmarkStore } from '../../../../../stores/useBookmarkStore'
import { collectTagUsage } from '../../../../../ai/services/tagger'
import { toast } from '../../../../../stores/useToastStore'
import { confirmDialog, promptDialog } from '../../../../Dialog'
import { cn } from '../../../../../utils/cn'

/* ──────────────────────────────────────────────────────────────────────
 * SECTION: 标签管理 —— 列出全库所有标签 + 计数 + 改名 / 合并 / 删除。
 * 点击标签会写入主搜索框 `#tag`，跨分类筛选所有匹配卡片。
 * ────────────────────────────────────────────────────────────────────── */

export function ManageSection() {
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
