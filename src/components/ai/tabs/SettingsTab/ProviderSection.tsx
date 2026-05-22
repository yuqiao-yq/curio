import { useMemo, useState } from 'react'
import {
  useAISettingsStore,
  PROVIDER_PRESETS,
  PROVIDER_GROUP_LABEL,
  type ProviderGroup,
} from '../../../../ai/useAISettingsStore'
import { testConnection } from '../../../../ai/manager'
import type { AIProviderConfig } from '../../../../ai/types'
import { cn } from '../../../../utils/cn'
import { toast } from '../../../../stores/useToastStore'
import { confirmDialog } from '../../../Dialog'
import { Field } from './shared'

/* ─────────────────────────────────────────────────────────────
 * Provider 相关：单条编辑行 / 新增表单 / 路由行
 *
 * 三个组件耦合在 Provider 这个领域，物理上放一起：
 * - ProviderRow：列表里的一行，可改名/改路由/删/测试
 * - AddProviderForm：「+ 添加」点开后的表单，支持预设
 * - RouteRow：当有 ≥2 个 Provider 时出现，把任务路由到不同 Provider
 *
 * 主 shell（index.tsx）用 settings.providers.length 控制 RouteRow 是否渲染。
 * ───────────────────────────────────────────────────────────── */

export function ProviderRow({ config }: { config: AIProviderConfig }) {
  const updateProvider = useAISettingsStore((s) => s.updateProvider)
  const removeProvider = useAISettingsStore((s) => s.removeProvider)
  const [open, setOpen] = useState(false)
  const [testing, setTesting] = useState(false)

  const handleTest = async () => {
    setTesting(true)
    try {
      const r = await testConnection(config)
      if (r.ok) {
        toast.success('连接正常', r.message)
      } else {
        // 失败提示可能很长（chrome://flags 步骤等），延长展示时间到 30s 让用户看完
        toast.error('连接失败', r.message, 30_000)
      }
    } finally {
      setTesting(false)
    }
  }

  const handleDelete = async () => {
    if (
      await confirmDialog({
        title: `删除 Provider「${config.name}」？`,
        message:
          '只移除 Provider 配置（含 apiKey）；已写入的 embedding / RAG 索引等本地数据不受影响。',
        confirmText: '删除',
        danger: true,
      })
    ) {
      removeProvider(config.id)
    }
  }

  return (
    <div
      className={cn(
        'rounded-md border border-slate-200 dark:border-slate-700',
        'bg-white dark:bg-slate-800/40',
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-base leading-none">
          {config.type === 'window-ai' ? '🟢' : '☁'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
            {config.name}
          </div>
          <div className="text-[11px] text-slate-400 truncate font-mono">
            {config.model}
          </div>
        </div>
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className={cn(
            'h-7 px-2.5 rounded text-xs',
            'border border-slate-200 dark:border-slate-600',
            'hover:border-brand hover:text-brand transition-colors',
            testing && 'opacity-50 cursor-wait',
          )}
        >
          {testing ? '测试中…' : '测试连接'}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'w-7 h-7 inline-flex items-center justify-center rounded',
            'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
            'hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors',
            'transition-transform',
            open && 'rotate-180',
          )}
          title={open ? '收起' : '展开编辑'}
          aria-label="展开编辑"
        >
          ▾
        </button>
      </div>

      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-100 dark:border-slate-700/60">
          <Field
            label="名称"
            value={config.name}
            onChange={(v) => updateProvider(config.id, { name: v })}
          />
          {config.type !== 'window-ai' && (
            <Field
              label="Base URL"
              value={config.baseURL ?? ''}
              onChange={(v) => updateProvider(config.id, { baseURL: v.trim() })}
              mono
            />
          )}
          {config.type !== 'window-ai' && (
            <Field
              label="API Key"
              value={config.apiKey ?? ''}
              onChange={(v) => updateProvider(config.id, { apiKey: v.trim() })}
              mono
              type="password"
              placeholder="sk-..."
            />
          )}
          <Field
            label="对话模型"
            value={config.model}
            onChange={(v) => updateProvider(config.id, { model: v.trim() })}
            mono
          />
          {config.type !== 'window-ai' && (
            <Field
              label="Embedding 模型"
              value={config.embeddingModel ?? ''}
              onChange={(v) =>
                updateProvider(config.id, { embeddingModel: v.trim() || undefined })
              }
              mono
              placeholder="可选；如 text-embedding-3-small"
            />
          )}
          <div className="flex items-center justify-end pt-1">
            <button
              type="button"
              onClick={() => void handleDelete()}
              className={cn(
                'h-7 px-2.5 rounded text-xs',
                'text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors',
              )}
            >
              删除 Provider
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function AddProviderForm({
  onClose,
  onAdded,
}: {
  onClose: () => void
  onAdded: () => void
}) {
  const addProvider = useAISettingsStore((s) => s.addProvider)
  const [presetIdx, setPresetIdx] = useState(0)
  const preset = PROVIDER_PRESETS[presetIdx]
  const [name, setName] = useState(preset.name)
  const [baseURL, setBaseURL] = useState(preset.baseURL)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(preset.defaultModel)

  // 按 group 重新组织预设，便于 select 用 optgroup 分组渲染
  const presetsByGroup = useMemo(() => {
    const order: ProviderGroup[] = ['cn', 'global', 'aggregator', 'local', 'experimental']
    const groups = order.map((g) => ({
      group: g,
      label: PROVIDER_GROUP_LABEL[g],
      items: PROVIDER_PRESETS.map((p, i) => ({ p, i })).filter(
        ({ p }) => p.group === g,
      ),
    }))
    return groups.filter((g) => g.items.length > 0)
  }, [])

  // 切预设时自动同步表单
  const switchPreset = (i: number) => {
    setPresetIdx(i)
    const p = PROVIDER_PRESETS[i]
    setName(p.name)
    setBaseURL(p.baseURL)
    setModel(p.defaultModel)
  }

  // 不需要 apiKey 的本地 / 自部署服务（启发式：默认 baseURL 含 localhost / 127 / YOUR_HOST）
  const isLocalLike =
    /localhost|127\.0\.0\.1|YOUR_HOST|YOUR_RESOURCE/i.test(preset.baseURL)

  const canAdd =
    name.trim().length > 0 &&
    model.trim().length > 0 &&
    (preset.type === 'window-ai' ||
      (baseURL.trim().length > 0 &&
        (isLocalLike || apiKey.trim().length > 0)))

  const handleAdd = () => {
    if (!canAdd) return
    addProvider({
      type: preset.type,
      name: name.trim(),
      baseURL: preset.type === 'window-ai' ? undefined : baseURL.trim(),
      apiKey: preset.type === 'window-ai' ? undefined : apiKey.trim() || undefined,
      model: model.trim(),
      embeddingModel: preset.defaultEmbeddingModel,
    })
    toast.success('已添加 Provider', name.trim())
    onAdded()
  }

  return (
    <div
      className={cn(
        'mt-2 p-3 rounded-md',
        'border border-slate-200 dark:border-slate-700',
        'bg-slate-50/50 dark:bg-slate-800/40',
        'space-y-2',
      )}
    >
      <div className="flex items-center justify-between">
        <h5 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          添加 Provider
        </h5>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          取消
        </button>
      </div>

      <div>
        <label className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">
          预设
        </label>
        <select
          value={presetIdx}
          onChange={(e) => switchPreset(Number(e.target.value))}
          className={cn(
            'w-full px-2 py-1.5 text-sm rounded',
            'bg-white dark:bg-slate-900',
            'border border-slate-200 dark:border-slate-700',
            'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
          )}
        >
          {presetsByGroup.map((g) => (
            <optgroup key={g.group} label={g.label}>
              {g.items.map(({ p, i }) => (
                <option key={p.name} value={i}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {/* 选定预设的描述 */}
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
          {preset.description}
        </p>
      </div>

      <Field label="名称" value={name} onChange={setName} />
      {preset.type !== 'window-ai' && (
        <Field label="Base URL" value={baseURL} onChange={setBaseURL} mono />
      )}
      {preset.type !== 'window-ai' && (
        <Field
          label="API Key"
          value={apiKey}
          onChange={setApiKey}
          mono
          type="password"
          placeholder={isLocalLike ? '本地服务可留空' : 'sk-...'}
        />
      )}
      <Field label="模型" value={model} onChange={setModel} mono />

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={handleAdd}
          disabled={!canAdd}
          className={cn(
            'h-7 px-3 rounded text-xs font-medium',
            canAdd
              ? 'bg-brand text-white hover:bg-brand-600'
              : 'bg-slate-200 text-slate-400 dark:bg-slate-700 dark:text-slate-500 cursor-not-allowed',
          )}
        >
          添加
        </button>
      </div>
    </div>
  )
}

export function RouteRow({
  task,
  label,
}: {
  task: 'chat' | 'organize' | 'embedding'
  label: string
}) {
  const providers = useAISettingsStore((s) => s.providers)
  const routing = useAISettingsStore((s) => s.routing)
  const setRoute = useAISettingsStore((s) => s.setRoute)
  const current = routing[task] ?? providers[0]?.id ?? ''

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 dark:text-slate-400 w-20 shrink-0">
        {label}
      </span>
      <select
        value={current}
        onChange={(e) => setRoute(task, e.target.value)}
        className={cn(
          'flex-1 px-2 py-1 text-xs rounded',
          'bg-white dark:bg-slate-900',
          'border border-slate-200 dark:border-slate-700',
          'outline-none focus:border-brand',
        )}
      >
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.model})
          </option>
        ))}
      </select>
    </div>
  )
}
