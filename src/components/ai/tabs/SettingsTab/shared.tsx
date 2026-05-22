import { cn } from '../../../../utils/cn'

/* ─────────────────────────────────────────────────────────────
 * SettingsTab 公共小组件
 *
 * 从原 SettingsTab.tsx 抽出，多个 section 共用：
 * - ToggleRow：iOS 风格开关行（SummarySection 也用）
 * - ActionBtn：统一动作按钮（primary / danger / default 三档）
 * - StatRow：状态网格单行（Embedding / Crawl 用）
 * - Field：可编辑表单字段（Provider 编辑 / 新增表单用）
 * - RangeChip：单选范围选择条目（Crawl / Summary 用）
 *
 * 故意放在共享文件而不是各 section 内部，避免相同样式在多个 section
 * 漂移；同时把 SettingsTab.tsx 拆成 7 个文件后，主 shell index.tsx
 * 也能轻松引用这些原子。
 * ───────────────────────────────────────────────────────────── */

export function ToggleRow({
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

export function ActionBtn({
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

export function StatRow({
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

export function Field({
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

export function RangeChip({
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
