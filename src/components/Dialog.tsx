import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { cn } from '../utils/cn'

/**
 * 统一替代 window.confirm / window.prompt 的浮窗对话系统。
 *
 * 设计目标：
 * - API 像原生 confirm/prompt 一样简单（async/await）
 * - 视觉与 Tab It 整体一致（已有 Topbar.DialogShell 同款）
 * - 支持暗色 / 浅色主题
 * - portal 挂 body，z-index 高于 toast(10000) / 浮窗(10100)，与隐私同意弹窗(10200) 并列
 * - Esc / 点击遮罩 = 取消；Enter = 确认（prompt 在输入框，confirm 在按钮）
 * - 默认 focus：confirm → 确认按钮；prompt → 输入框（且全选）
 * - 串行队列：连续 open 不会互相覆盖，按 FIFO 顺序展示
 *
 * 用法：
 *   const ok = await confirmDialog({ title: '删除该卡片？', danger: true })
 *   const name = await promptDialog({ title: '新分类名称', defaultValue: '我的收藏' })
 *
 * 必须在 App 顶层挂一个 <DialogHost /> 才能渲染。
 */

// ─── 类型 ─────────────────────────────────────────

export interface ConfirmOptions {
  title: string
  message?: string
  /** 确认按钮文案；默认 "确认" */
  confirmText?: string
  /** 取消按钮文案；默认 "取消" */
  cancelText?: string
  /** danger=true 时确认按钮变红（删除等破坏性操作） */
  danger?: boolean
}

export interface PromptOptions {
  title: string
  message?: string
  /** 输入框默认值 */
  defaultValue?: string
  placeholder?: string
  /** 是否允许空字符串提交；默认 false（空 → 视为取消） */
  allowEmpty?: boolean
  /** 多行（textarea），默认 false（单行 input） */
  multiline?: boolean
  confirmText?: string
  cancelText?: string
  /** 输入校验：返回 string 为错误信息，返回 undefined / null 为校验通过 */
  validate?: (value: string) => string | undefined | null
}

type DialogRequest =
  | {
      id: string
      kind: 'confirm'
      opts: ConfirmOptions
      resolve: (ok: boolean) => void
    }
  | {
      id: string
      kind: 'prompt'
      opts: PromptOptions
      resolve: (value: string | null) => void
    }

// ─── store（串行队列） ─────────────────────────────

interface DialogStore {
  current: DialogRequest | null
  queue: DialogRequest[]
  enqueue: (req: DialogRequest) => void
  finish: () => void
}

const useDialogStore = create<DialogStore>((set, get) => ({
  current: null,
  queue: [],
  enqueue(req) {
    const s = get()
    if (s.current) {
      set({ queue: [...s.queue, req] })
    } else {
      set({ current: req })
    }
  },
  finish() {
    const s = get()
    const [next, ...rest] = s.queue
    set({ current: next ?? null, queue: rest })
  },
}))

// ─── 公共 API ─────────────────────────────────────

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useDialogStore.getState().enqueue({
      id: uuid(),
      kind: 'confirm',
      opts,
      resolve,
    })
  })
}

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    useDialogStore.getState().enqueue({
      id: uuid(),
      kind: 'prompt',
      opts,
      resolve,
    })
  })
}

// ─── DialogHost ───────────────────────────────────

/**
 * 全局对话容器；App 顶层挂一次即可。
 */
export function DialogHost() {
  const current = useDialogStore((s) => s.current)
  const finish = useDialogStore((s) => s.finish)
  if (typeof document === 'undefined') return null
  if (!current) return null
  // 每次切换 current 都重建子组件（state 不串），避免上一次 prompt 输入残留
  return createPortal(
    <DialogView key={current.id} req={current} onClose={finish} />,
    document.body,
  )
}

function DialogView({
  req,
  onClose,
}: {
  req: DialogRequest
  onClose: () => void
}) {
  // 公共：取消 = resolve(false / null)
  const cancel = () => {
    if (req.kind === 'confirm') req.resolve(false)
    else req.resolve(null)
    onClose()
  }
  // 公共：Esc / 点击遮罩 = 取消
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="fixed inset-0 z-[10200] flex items-center justify-center bg-black/40 p-4"
      onClick={cancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          // v0.21.16：max-h 用 vh 自适应屏幕；flex 让 Header/Footer 固定、中间内容滚动
          'w-[400px] max-w-[92vw] max-h-[calc(100vh-2rem)] flex flex-col rounded-lg shadow-2xl',
          'bg-white dark:bg-slate-800',
          'border border-slate-200 dark:border-slate-700',
        )}
        role="dialog"
        aria-modal="true"
      >
        {req.kind === 'confirm' ? (
          <ConfirmBody req={req} onClose={onClose} />
        ) : (
          <PromptBody req={req} onClose={onClose} />
        )}
      </div>
    </div>
  )
}

// ─── ConfirmBody ──────────────────────────────────

function ConfirmBody({
  req,
  onClose,
}: {
  req: Extract<DialogRequest, { kind: 'confirm' }>
  onClose: () => void
}) {
  const { title, message, confirmText, cancelText, danger } = req.opts
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null)

  // 默认 focus 确认按钮，方便用户直接 Enter
  useEffect(() => {
    confirmBtnRef.current?.focus()
  }, [])

  const onConfirm = () => {
    req.resolve(true)
    onClose()
  }
  const onCancel = () => {
    req.resolve(false)
    onClose()
  }

  return (
    <>
      <Header title={title} onClose={onCancel} />
      {/* 中间内容可滚动；message 极少超长，但极端场景下也能 fallback 滚动 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {message && (
          <div className="px-5 py-3 text-xs text-slate-500 dark:text-slate-400 leading-relaxed whitespace-pre-wrap break-words">
            {message}
          </div>
        )}
      </div>
      <Footer>
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            'px-3 py-1.5 text-sm rounded',
            'text-slate-600 dark:text-slate-300',
            'hover:bg-slate-100 dark:hover:bg-slate-700/60',
          )}
        >
          {cancelText ?? '取消'}
        </button>
        <button
          ref={confirmBtnRef}
          type="button"
          onClick={onConfirm}
          className={cn(
            'px-3 py-1.5 text-sm rounded font-medium text-white',
            danger
              ? 'bg-red-500 hover:bg-red-600'
              : 'bg-brand hover:bg-brand-600',
          )}
        >
          {confirmText ?? '确认'}
        </button>
      </Footer>
    </>
  )
}

// ─── PromptBody ───────────────────────────────────

function PromptBody({
  req,
  onClose,
}: {
  req: Extract<DialogRequest, { kind: 'prompt' }>
  onClose: () => void
}) {
  const {
    title,
    message,
    defaultValue,
    placeholder,
    allowEmpty,
    multiline,
    confirmText,
    cancelText,
    validate,
  } = req.opts

  const [value, setValue] = useState(defaultValue ?? '')
  const [touched, setTouched] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // mount 时 focus 并全选默认值（与原生 prompt 行为对齐）
  useEffect(() => {
    if (multiline) {
      textareaRef.current?.focus()
      textareaRef.current?.select()
    } else {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [multiline])

  const validateError = (() => {
    if (validate) {
      const r = validate(value)
      if (r) return r
    }
    if (!allowEmpty && value.trim().length === 0) {
      return touched ? '请输入内容' : '' // 未碰过时不显示错误
    }
    return ''
  })()
  const canSubmit = !allowEmpty
    ? value.trim().length > 0 && !validateError
    : !validateError

  const onConfirm = () => {
    setTouched(true)
    if (!canSubmit) return
    const out = allowEmpty ? value : value.trim()
    req.resolve(out)
    onClose()
  }
  const onCancel = () => {
    req.resolve(null)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // 单行：Enter = 提交；Shift+Enter 无意义（保留默认换行被 input 自己忽略）
    // 多行：Cmd/Ctrl+Enter = 提交；纯 Enter = 换行
    if (e.key === 'Enter') {
      if (!multiline) {
        e.preventDefault()
        onConfirm()
      } else if (e.metaKey || e.ctrlKey) {
        e.preventDefault()
        onConfirm()
      }
    }
  }

  return (
    <>
      <Header title={title} onClose={onCancel} />
      {/* 中间输入区可滚动（长 message + multiline textarea 时尤为必要） */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-2">
        {message && (
          <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed whitespace-pre-wrap break-words">
            {message}
          </div>
        )}
        {multiline ? (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={4}
            className={cn(
              'w-full px-2 py-1.5 text-sm rounded resize-y min-h-[80px]',
              'bg-white dark:bg-slate-900',
              'border border-slate-200 dark:border-slate-700',
              'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
              'placeholder:text-slate-400',
              validateError &&
                'border-sky-300 dark:border-sky-500/60 focus:border-sky-400 focus:ring-sky-400/30',
            )}
          />
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className={cn(
              'w-full px-2 py-1.5 text-sm rounded',
              'bg-white dark:bg-slate-900',
              'border border-slate-200 dark:border-slate-700',
              'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
              'placeholder:text-slate-400',
              validateError &&
                'border-sky-300 dark:border-sky-500/60 focus:border-sky-400 focus:ring-sky-400/30',
            )}
          />
        )}
        {validateError && (
          <div className="text-[11px] text-sky-500 dark:text-sky-400">{validateError}</div>
        )}
        {multiline && (
          <div className="text-[10px] text-slate-400">
            Cmd / Ctrl + Enter 提交 · Esc 取消
          </div>
        )}
      </div>
      <Footer>
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            'px-3 py-1.5 text-sm rounded',
            'text-slate-600 dark:text-slate-300',
            'hover:bg-slate-100 dark:hover:bg-slate-700/60',
          )}
        >
          {cancelText ?? '取消'}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!canSubmit}
          className={cn(
            'px-3 py-1.5 text-sm rounded font-medium',
            canSubmit
              ? 'bg-brand text-white hover:bg-brand-600'
              : 'bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500 cursor-not-allowed',
          )}
        >
          {confirmText ?? '确认'}
        </button>
      </Footer>
    </>
  )
}

// ─── 公共子片段 ─────────────────────────────────────

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="px-5 py-3 flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
      <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 leading-tight whitespace-pre-wrap break-words">
        {title}
      </h3>
      <button
        type="button"
        onClick={onClose}
        className={cn(
          'shrink-0 w-7 h-7 inline-flex items-center justify-center rounded text-sm',
          'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
          'hover:bg-slate-100 dark:hover:bg-slate-700/60',
        )}
        title="关闭 (Esc)"
        aria-label="关闭"
      >
        ✕
      </button>
    </div>
  )
}

function Footer({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 py-3 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-700 shrink-0">
      {children}
    </div>
  )
}
