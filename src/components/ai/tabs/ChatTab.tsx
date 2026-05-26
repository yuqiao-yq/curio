import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAIPanelStore } from '../../../ai/panel/usePanelStore'
import {
  useAISettingsStore,
  useIsAIConfigured,
} from '../../../ai/useAISettingsStore'
import {
  runChat,
  runRagChat,
  suggestChatTitle,
} from '../../../ai/services/chatter'
import type { RetrievedDoc } from '../../../ai/services/retriever'
import type { ChatMessage } from '../../../ai/types'
import { useBookmarkStore } from '../../../stores/useBookmarkStore'
import { usePageIndex } from '../../../ai/services/usePageIndex'
import { toast } from '../../../stores/useToastStore'
import { confirmDialog } from '../../Dialog'
import { cn } from '../../../utils/cn'

/**
 * 持久化到 tab.state 的消息：在 ChatMessage 之上额外挂 retrieved（仅 assistant 用），
 * 用于 UI 在气泡下方渲染引用书签列表。LLM 调用时不会发这个字段。
 */
interface StoredRef {
  id: string
  title: string
  url: string
  score: number
}
interface StoredMessage extends ChatMessage {
  retrieved?: StoredRef[]
}

/**
 * 「💬 对话」Tab —— V1 简化版
 *
 * 当前能力：
 * - 多轮聊天（无 RAG，纯通用对话）
 * - 流式输出 + 中止
 * - 自动从首条提问生成 tab 标题
 * - messages 持久化到 panel store 的 tab.state
 * - 复制单条消息 / 清空对话
 *
 * 暂未实现（V2 §6.2）：
 * - 检索本地书签 / 网页内容作为 context
 * - 引用来源标号 [1] [2]
 * - 多对话独立挂着（已支持，因为 tab 本身就是多份）
 */
export function ChatTab({ tabId }: { tabId: string }) {
  const configured = useIsAIConfigured()
  // 只订阅 header / 切换路由 / 中文警告分支用到的三块；
  // 其余字段（apiKey/privacy 等）变更不会触发本组件 re-render。
  const { providers, chatRoute, setRoute } = useAISettingsStore(
    useShallow((s) => ({
      providers: s.providers,
      chatRoute: s.routing.chat,
      setRoute: s.setRoute,
    })),
  )
  const cards = useBookmarkStore((s) => s.cards)
  const indexedIds = usePageIndex((s) => s.indexedIds)

  // 从 panel store 读 / 写 当前 tab 的对话历史 + RAG 模式开关
  const tab = useAIPanelStore((s) => s.tabs.find((t) => t.id === tabId))
  const patchTab = useAIPanelStore((s) => s.patchTab)
  const messages = (tab?.state?.messages as StoredMessage[] | undefined) ?? []
  /**
   * RAG 模式（§6.2）：开启后每条提问会先用 query embedding 检索 top K 已索引内容，
   * 把片段作为 system context 拼 prompt。默认关闭，让用户主动 opt-in。
   */
  const ragEnabled = (tab?.state?.ragEnabled as boolean | undefined) ?? false
  const setRagEnabled = (v: boolean) =>
    patchTab(tabId, {
      state: { ...(tab?.state ?? {}), ragEnabled: v },
    })

  // 当前流式中的"临时 assistant 消息"，未结束前不写 store
  const [streamingText, setStreamingText] = useState<string | null>(null)
  // ref 镜像最新流式文本：闭包里需要拿"中止时已积累的内容"，setState 是异步的
  const streamingTextRef = useRef<string | null>(null)
  streamingTextRef.current = streamingText
  const [input, setInput] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const sending = streamingText !== null

  // 自动滚到底部
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length, streamingText])

  // 写入 messages 到 store + 联动 tab title
  const updateMessages = (next: StoredMessage[]) => {
    const newTitle =
      tab?.title === '对话' || !tab?.title || tab?.title === '新对话'
        ? suggestChatTitle(next)
        : undefined
    patchTab(tabId, {
      state: { ...(tab?.state ?? {}), messages: next },
      ...(newTitle ? { title: newTitle } : {}),
    })
  }

  const handleSend = async () => {
    const content = input.trim()
    if (!content || sending) return
    if (!configured) {
      toast.warning('请先配置 AI', '在「⚙ 设置」中添加一个 Provider')
      return
    }

    const userMsg: StoredMessage = { role: 'user', content }
    const nextMessages = [...messages, userMsg]
    updateMessages(nextMessages)
    setInput('')
    inputRef.current?.focus()

    setStreamingText('')
    const controller = new AbortController()
    abortRef.current = controller
    // 仅在 RAG 模式下保留 retrieve 结果，写入最终 assistant 消息
    let lastRetrieved: RetrievedDoc[] = []
    try {
      if (ragEnabled) {
        const r = await runRagChat({
          query: content,
          // 把对话历史发给模型（system 由 retriever 注入；clean 历史里的旧 system）
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          cards,
          settings: useAISettingsStore.getState(),
          signal: controller.signal,
          onDelta: (_, full) => setStreamingText(full),
          onRetrieved: (docs) => {
            lastRetrieved = docs
          },
        })
        const final: StoredMessage = {
          role: 'assistant',
          content: r.text,
          retrieved: r.retrieved.map((d) => ({
            id: d.card.id,
            title: d.card.title,
            url: d.card.url,
            score: d.score,
          })),
        }
        updateMessages([...nextMessages, final])
      } else {
        const r = await runChat({
          // 加一条简短 system 引导
          messages: [
            {
              role: 'system',
              content:
                '你是一个友好、严谨的助手。回答精炼、有条理；涉及代码用 ``` 代码块，避免冗余客套。',
            },
            ...nextMessages.map((m) => ({ role: m.role, content: m.content })),
          ],
          settings: useAISettingsStore.getState(),
          signal: controller.signal,
          onDelta: (_, full) => setStreamingText(full),
        })
        const final: StoredMessage = { role: 'assistant', content: r.text }
        updateMessages([...nextMessages, final])
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // 用户主动中止：把已生成的部分作为 assistant 消息留下（用 ref 拿最新值）
        const partialText = streamingTextRef.current ?? ''
        if (partialText.trim().length > 0) {
          const partial: StoredMessage = {
            role: 'assistant',
            content: partialText + '\n\n_（已中止）_',
            retrieved: ragEnabled
              ? lastRetrieved.map((d) => ({
                  id: d.card.id,
                  title: d.card.title,
                  url: d.card.url,
                  score: d.score,
                }))
              : undefined,
          }
          updateMessages([...nextMessages, partial])
        }
      } else {
        const msg = err instanceof Error ? err.message : '未知错误'
        toast.error('AI 回答失败', msg)
        // 删掉刚发的 user 消息让用户能编辑后重发
        updateMessages(messages)
        setInput(content)
      }
    } finally {
      setStreamingText(null)
      streamingTextRef.current = null
      abortRef.current = null
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleClear = async () => {
    if (messages.length === 0) return
    if (
      !(await confirmDialog({
        title: '清空当前对话？',
        message: '当前 tab 内的所有消息将被清除。',
        danger: true,
      }))
    )
      return
    updateMessages([])
  }

  const handleCopy = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast.success('已复制'),
      () => toast.error('复制失败'),
    )
  }

  /**
   * 导出为 markdown：把整段对话拼成 md 文档下载。
   * - role 用 ## 标题分隔
   * - retrieved 引用以脚注样式列在每条 assistant 消息末尾
   * - 文件名取 tab.title + 时间戳
   */
  const handleExport = () => {
    if (messages.length === 0) {
      toast.info('对话为空', '没有可导出的内容')
      return
    }
    const lines: string[] = []
    lines.push(`# ${tab?.title ?? 'Tab It 对话'}`)
    lines.push('')
    lines.push(`> 导出于 ${new Date().toLocaleString()}`)
    lines.push('')
    for (const m of messages) {
      if (m.role === 'system') continue
      lines.push(`## ${m.role === 'user' ? '🙋 用户' : '✨ 助手'}`)
      lines.push('')
      lines.push(m.content)
      lines.push('')
      if (m.retrieved && m.retrieved.length > 0) {
        lines.push('**参考来源：**')
        for (let i = 0; i < m.retrieved.length; i++) {
          const r = m.retrieved[i]
          lines.push(`- [${i + 1}] [${r.title}](${r.url}) · ${(r.score * 100).toFixed(0)}%`)
        }
        lines.push('')
      }
    }
    const md = lines.join('\n')
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const safeTitle = (tab?.title ?? 'chat').replace(/[\\/:*?"<>|]/g, '_')
    a.href = url
    a.download = `tabit-${safeTitle}-${new Date()
      .toISOString()
      .slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('已导出', `${messages.length} 条消息`)
  }

  if (!configured) {
    return <NoAINotice />
  }

  // 当前 chat 路由对应的 Provider（用于 header 展示模型名 + 中文警告判断）
  const currentChatProvider =
    providers.find((p) => p.id === (chatRoute ?? providers[0]?.id)) ?? null
  const isWindowAI = currentChatProvider?.type === 'window-ai'
  // 远程 Provider 列表（供"快速切换"用）
  const remoteProviders = providers.filter((p) => p.type !== 'window-ai')
  const switchToRemote = (providerId: string) => {
    setRoute('chat', providerId)
    toast.success(
      '已切换 chat 路由',
      providers.find((p) => p.id === providerId)?.name ?? '',
    )
  }

  // 是否有任何已抓取正文（决定 RAG 开关 disabled 与否）
  const hasIndexed = indexedIds.size > 0

  return (
    <div className="flex flex-col h-full">
      {/* 顶部：当前 Provider + RAG 开关 + 导出 + 清空 */}
      <ChatHeader
        modelName={currentChatProvider?.model}
        canClear={messages.length > 0}
        onClear={() => void handleClear()}
        onExport={handleExport}
        ragEnabled={ragEnabled}
        ragAvailable={hasIndexed}
        onToggleRag={setRagEnabled}
        indexedCount={indexedIds.size}
      />

      {/* 中文场景的语言能力警告：Chrome Gemini Nano 仅 en/es/ja，
          中文输入会让模型按英文 token 空间瞎拼出乱码 */}
      {isWindowAI && (
        <ChineseLangWarning
          remoteProviders={remoteProviders.map((p) => ({
            id: p.id,
            label: `${p.name} (${p.model})`,
          }))}
          onSwitch={switchToRemote}
        />
      )}

      {/* 中间：消息流 */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-3 py-3 space-y-3">
        {messages.length === 0 && streamingText === null ? (
          <EmptyHint />
        ) : (
          <>
            {messages.map((m, i) => (
              <Bubble
                key={i}
                role={m.role}
                content={m.content}
                retrieved={m.retrieved}
                onCopy={() => handleCopy(m.content)}
              />
            ))}
            {streamingText !== null && (
              <Bubble role="assistant" content={streamingText || '…'} streaming />
            )}
          </>
        )}
      </div>

      {/* 底部：输入区 */}
      <div
        className={cn(
          'border-t border-slate-200 dark:border-slate-700',
          'bg-slate-50/60 dark:bg-slate-800/40',
          'p-2 flex items-end gap-2',
        )}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter 发送；纯 Enter 换行（更适合多行问句）
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void handleSend()
            }
          }}
          placeholder={
            sending
              ? 'AI 正在回答…'
              : ragEnabled
                ? '基于你的本地索引提问，Cmd+Enter 发送'
                : '输入消息，Cmd+Enter 发送'
          }
          rows={2}
          disabled={sending}
          className={cn(
            'flex-1 resize-none rounded-md px-2 py-1.5 text-sm',
            'bg-white dark:bg-slate-900',
            'border border-slate-200 dark:border-slate-700',
            'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
            'placeholder:text-slate-400',
            'max-h-32',
          )}
          spellCheck={false}
        />
        {sending ? (
          <button
            type="button"
            onClick={handleStop}
            className={cn(
              'shrink-0 h-8 px-3 rounded-md text-xs font-medium',
              'bg-red-500 text-white hover:bg-red-600 transition-colors',
            )}
            title="停止生成"
          >
            停止
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!input.trim()}
            className={cn(
              'shrink-0 h-8 px-3 rounded-md text-xs font-medium transition-colors',
              input.trim()
                ? 'bg-brand text-white hover:bg-brand-600'
                : 'bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500 cursor-not-allowed',
            )}
            title="发送 (Cmd/Ctrl+Enter)"
          >
            发送
          </button>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
 * 子组件：Header / Empty / Bubble
 * ───────────────────────────────────────────────────────────── */

function ChatHeader({
  modelName,
  canClear,
  onClear,
  onExport,
  ragEnabled,
  ragAvailable,
  onToggleRag,
  indexedCount,
}: {
  modelName?: string
  canClear: boolean
  onClear: () => void
  onExport: () => void
  ragEnabled: boolean
  ragAvailable: boolean
  onToggleRag: (v: boolean) => void
  indexedCount: number
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 shrink-0',
        'border-b border-slate-200 dark:border-slate-700',
        'text-[11px]',
      )}
    >
      <span className="text-slate-400">使用</span>
      <span className="font-mono text-slate-600 dark:text-slate-300 truncate max-w-[100px]">
        {modelName ?? '(未配置)'}
      </span>

      {/* RAG 开关：仅当已索引内容 > 0 时可启用；hover 显示数量 */}
      <button
        type="button"
        onClick={() => onToggleRag(!ragEnabled)}
        disabled={!ragAvailable}
        title={
          ragAvailable
            ? ragEnabled
              ? `已开启「问问我的书签库」（${indexedCount} 个网页已索引）`
              : `开启「问问我的书签库」（${indexedCount} 个网页已索引）`
            : '请先在「⚙ 设置 → 内容抓取」抓取一些网页正文'
        }
        className={cn(
          'inline-flex items-center gap-1 h-5 px-1.5 rounded text-[10px] font-medium',
          'transition-colors shrink-0',
          ragEnabled
            ? 'bg-fuchsia-100 dark:bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300'
            : ragAvailable
              ? 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
              : 'text-slate-300 dark:text-slate-600 cursor-not-allowed',
        )}
      >
        <span aria-hidden>📚</span>
        <span>{ragEnabled ? 'RAG · 开' : 'RAG'}</span>
      </button>

      <div className="flex-1" />
      <button
        type="button"
        onClick={onExport}
        disabled={!canClear}
        className={cn(
          'h-6 px-2 rounded text-[11px]',
          canClear
            ? 'text-slate-500 hover:text-brand hover:bg-slate-100 dark:hover:bg-slate-800'
            : 'text-slate-300 cursor-not-allowed',
        )}
        title="导出为 Markdown"
      >
        导出 .md
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={!canClear}
        className={cn(
          'h-6 px-2 rounded text-[11px]',
          canClear
            ? 'text-slate-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10'
            : 'text-slate-300 cursor-not-allowed',
        )}
      >
        清空
      </button>
    </div>
  )
}

function ChineseLangWarning({
  remoteProviders,
  onSwitch,
}: {
  remoteProviders: Array<{ id: string; label: string }>
  onSwitch: (providerId: string) => void
}) {
  const addTab = useAIPanelStore((s) => s.addTab)
  return (
    <div
      className={cn(
        'shrink-0 px-3 py-2 text-[11px] leading-relaxed',
        'bg-amber-50 dark:bg-amber-500/10',
        'text-amber-800 dark:text-amber-300',
        'border-b border-amber-200 dark:border-amber-800/40',
      )}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden>⚠️</span>
        <div className="flex-1">
          <strong>Chrome 内置 AI 不支持中文输出</strong>
          ，仅支持 en / es / ja。中文提问会得到乱码（token 在英文空间瞎拼）。
          {remoteProviders.length > 0 ? (
            <span> 建议立即切换到远程 Provider：</span>
          ) : (
            <span> 请添加一个远程 Provider（DeepSeek / OpenAI / 智谱等）。</span>
          )}
        </div>
      </div>
      <div className="mt-1.5 ml-5 flex flex-wrap items-center gap-1.5">
        {remoteProviders.length > 0 ? (
          remoteProviders.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSwitch(p.id)}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded',
                'bg-amber-200/70 dark:bg-amber-500/20',
                'text-amber-900 dark:text-amber-200',
                'hover:bg-amber-300 dark:hover:bg-amber-500/30 transition-colors',
                'font-medium',
              )}
            >
              切换到 {p.label}
            </button>
          ))
        ) : (
          <button
            type="button"
            onClick={() => addTab('settings')}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded',
              'bg-amber-200/70 dark:bg-amber-500/20',
              'text-amber-900 dark:text-amber-200',
              'hover:bg-amber-300 dark:hover:bg-amber-500/30 transition-colors',
              'font-medium',
            )}
          >
            前往设置添加 Provider
          </button>
        )}
      </div>
    </div>
  )
}

function EmptyHint() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-center pt-4 text-slate-400">
      <div className="text-3xl">💬</div>
      <p className="text-xs leading-relaxed max-w-[280px]">
        和 AI 对话。开启顶部的{' '}
        <span className="inline-flex items-center gap-0.5 px-1 rounded bg-fuchsia-100 dark:bg-fuchsia-500/20 text-fuchsia-700 dark:text-fuchsia-300 font-medium">
          📚 RAG
        </span>{' '}
        后，AI 会基于你已抓取过的网页正文回答，并附上 [1] [2] 引用来源。
        <br />
        <span className="text-[10px] text-slate-300 dark:text-slate-600">
          先在「⚙ 设置 → 内容抓取」抓些网页正文，RAG 模式才会被启用
        </span>
      </p>
    </div>
  )
}

function Bubble({
  role,
  content,
  streaming,
  retrieved,
  onCopy,
}: {
  role: 'user' | 'assistant' | 'system'
  content: string
  streaming?: boolean
  retrieved?: StoredRef[]
  onCopy?: () => void
}) {
  if (role === 'system') return null
  const isUser = role === 'user'
  return (
    <div
      className={cn(
        'group flex gap-2',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      {!isUser && (
        <span
          className={cn(
            'shrink-0 w-6 h-6 rounded-full inline-flex items-center justify-center text-xs',
            'bg-brand/10 text-brand',
          )}
          aria-hidden
        >
          ✨
        </span>
      )}
      <div
        className={cn(
          'max-w-[85%] flex flex-col gap-1.5',
          isUser ? 'items-end' : 'items-start',
        )}
      >
        <div
          className={cn(
            'rounded-2xl px-3 py-2 text-sm leading-relaxed',
            'whitespace-pre-wrap break-words',
            isUser
              ? 'bg-brand text-white rounded-tr-sm'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-tl-sm',
          )}
        >
          <RichText content={content} />
          {streaming && (
            <span className="inline-block w-1.5 h-3.5 bg-current ml-0.5 animate-pulse align-text-bottom" />
          )}
        </div>
        {/* RAG 引用列表：紧贴消息气泡下方 */}
        {!isUser && retrieved && retrieved.length > 0 && (
          <ReferencesList refs={retrieved} />
        )}
      </div>
      {!isUser && onCopy && !streaming && (
        <button
          type="button"
          onClick={onCopy}
          className={cn(
            'shrink-0 self-start mt-1 w-6 h-6 inline-flex items-center justify-center rounded',
            'text-slate-400 hover:text-brand',
            'opacity-0 group-hover:opacity-100 transition-opacity',
            'hover:bg-slate-100 dark:hover:bg-slate-700/60',
          )}
          title="复制"
          aria-label="复制"
        >
          ⎘
        </button>
      )}
    </div>
  )
}

/**
 * RAG 引用列表（§6.2）：在 assistant 消息下方渲染本次回答用到的来源。
 * - 编号 [1] [2] 与 system prompt 中给 AI 的标号一一对应
 * - 点击 → 在新标签页打开原网页
 * - score 用 0..100 显示
 */
function ReferencesList({ refs }: { refs: StoredRef[] }) {
  return (
    <div
      className={cn(
        'rounded-md px-2 py-1.5 text-[11px] leading-relaxed',
        'bg-slate-50 dark:bg-slate-800/40',
        'border border-slate-200 dark:border-slate-700/60',
        'space-y-0.5 max-w-full',
      )}
    >
      <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-0.5">
        参考来源 ({refs.length})
      </div>
      {refs.map((r, i) => (
        <a
          key={r.id}
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            'flex items-baseline gap-1.5 group/ref truncate',
            'text-slate-700 dark:text-slate-300 hover:text-brand',
          )}
          title={r.url}
        >
          <span className="shrink-0 text-fuchsia-500 tabular-nums">
            [{i + 1}]
          </span>
          <span className="truncate flex-1 group-hover/ref:underline">
            {r.title}
          </span>
          <span className="shrink-0 text-[10px] text-slate-400 tabular-nums">
            {Math.round(r.score * 100)}%
          </span>
        </a>
      ))}
    </div>
  )
}

/**
 * 极简 markdown 渲染：保留换行 + 抽出 ``` 代码块。
 * 完整 markdown 引用 react-markdown 会增加 ~50KB 体积，V1 阶段先这样。
 */
function RichText({ content }: { content: string }) {
  const parts = useMemo(() => splitCodeBlocks(content), [content])
  return (
    <>
      {parts.map((p, i) =>
        p.type === 'code' ? (
          <pre
            key={i}
            className={cn(
              'my-1.5 px-2.5 py-1.5 rounded text-[12px] font-mono leading-snug overflow-x-auto',
              'bg-slate-900 text-slate-100',
              'border border-slate-700',
            )}
          >
            {p.lang && (
              <div className="text-[10px] text-slate-400 mb-1">{p.lang}</div>
            )}
            <code>{p.text}</code>
          </pre>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

type Part = { type: 'text' | 'code'; text: string; lang?: string }

function splitCodeBlocks(text: string): Part[] {
  const parts: Part[] = []
  const re = /```(\w+)?\n?([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push({ type: 'text', text: text.slice(last, m.index) })
    }
    parts.push({ type: 'code', lang: m[1], text: m[2].replace(/\n$/, '') })
    last = m.index + m[0].length
  }
  if (last < text.length) {
    parts.push({ type: 'text', text: text.slice(last) })
  }
  return parts.length > 0 ? parts : [{ type: 'text', text }]
}

/* ─────────────────────────────────────────────────────────────
 * 通用：未配置 AI 提示
 * ───────────────────────────────────────────────────────────── */

function NoAINotice() {
  const addTab = useAIPanelStore((s) => s.addTab)
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 gap-3 text-center">
      <div className="text-5xl">⚙</div>
      <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">
        请先配置 AI Provider
      </h3>
      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-[280px]">
        对话需要至少一个可用的 LLM Provider（DeepSeek / OpenAI / Moonshot 等）。
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
