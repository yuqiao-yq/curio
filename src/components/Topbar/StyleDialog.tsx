import { useEffect, useState } from 'react'
import {
  CARD_HEIGHT_MAX_PX,
  CARD_HEIGHT_MIN_PX,
  CARD_WIDTH_FIXED_DEFAULT,
  CARD_WIDTH_FLUID_MAX_DEFAULT,
  CARD_WIDTH_FLUID_MIN_DEFAULT,
  CARD_WIDTH_MAX_PX,
  CARD_WIDTH_MIN_PX,
  CUSTOM_H_MAX_DEFAULT,
  CUSTOM_H_MIN_DEFAULT,
  CUSTOM_W_MAX_DEFAULT,
  CUSTOM_W_MIN_DEFAULT,
  type StylePreset,
  type UserSettings,
} from '../../types/bookmark'
import { cn } from '../../utils/cn'
import { clampCardHeight, clampCardWidth } from '../../utils/cardGrid'
import {
  applyStylePreset,
  buildPresetExport,
  mergeUserPresets,
  parsePresetImport,
  pickPresettable,
} from '../../utils/stylePreset'
import { localRepo } from '../../repositories/LocalRepository'
import { toast } from '../../stores/useToastStore'
import { GradientEditor } from '../GradientEditor'
import { confirmDialog, promptDialog } from '../Dialog'
import { DialogShell } from './DialogShell'

/* ─────────────────────────────────────────────────────────────
 * 样式管理弹层：主题 + 自定义背景 + 文字颜色 + 内容布局。
 * Topbar 拆包时（v0.21.x）从单文件 1591 行中抽出，本文件约 480 行。
 * ───────────────────────────────────────────────────────────── */

const PRESET_WALLPAPERS: Array<{ key: string; label: string; value: string; preview: string }> = [
  // value 为空字符串表示"无自定义背景"，回退到 global.css 的渐变
  { key: 'none', label: '默认', value: '', preview: 'linear-gradient(135deg, #f8fafc, #e0e7ff)' },
  {
    key: 'aurora',
    label: '极光',
    value: 'linear-gradient(135deg, #c084fc 0%, #818cf8 50%, #38bdf8 100%)',
    preview: 'linear-gradient(135deg, #c084fc 0%, #818cf8 50%, #38bdf8 100%)',
  },
  {
    key: 'sunset',
    label: '暮色',
    value: 'linear-gradient(135deg, #fb923c 0%, #f472b6 100%)',
    preview: 'linear-gradient(135deg, #fb923c 0%, #f472b6 100%)',
  },
  {
    key: 'ocean',
    label: '深海',
    value: 'linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)',
    preview: 'linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)',
  },
  {
    key: 'forest',
    label: '林荫',
    value: 'linear-gradient(135deg, #34d399 0%, #10b981 100%)',
    preview: 'linear-gradient(135deg, #34d399 0%, #10b981 100%)',
  },
  {
    key: 'midnight',
    label: '午夜',
    value: 'linear-gradient(135deg, #1e293b 0%, #312e81 100%)',
    preview: 'linear-gradient(135deg, #1e293b 0%, #312e81 100%)',
  },
]

const THEME_OPTIONS: Array<{ key: UserSettings['theme']; label: string; icon: string }> = [
  { key: 'light', label: '明亮', icon: '☀️' },
  { key: 'dark', label: '黑暗', icon: '🌙' },
  { key: 'auto', label: '跟随系统', icon: '🖥️' },
]

const CARD_SIZE_OPTIONS: Array<{
  key: UserSettings['cardSize']
  label: string
  desc: string
}> = [
  { key: 'compact', label: '精简', desc: '只显示图标和名称，hover 高亮' },
  { key: 'standard', label: '标准', desc: '更紧凑，含域名 / 备注 / 标签' },
  { key: 'custom', label: '自定义', desc: '自由设置卡片宽 / 高的最小与最大值' },
]

const CARD_ICON_SIZE_OPTIONS: Array<{
  key: NonNullable<UserSettings['cardIconSize']>
  label: string
  desc: string
}> = [
  { key: 'small', label: '较小', desc: '接近浏览器 favicon 的视觉权重' },
  { key: 'standard', label: '标准', desc: '与卡片尺寸匹配的默认大小' },
]

/**
 * 「标准档」卡片宽度策略选项；仅当 cardSize === 'standard' 时展示。
 * - responsive：保留 2/3/4/5/6 列响应式断点（历史行为，默认）
 * - fluid    ：固定列数，每列宽度在 [min, max] 之间伸缩
 * - fixed    ：固定卡片宽度，列数随容器宽度自动变化（瀑布流式）
 */
const CARD_WIDTH_MODE_OPTIONS: Array<{
  key: NonNullable<UserSettings['cardWidthMode']>
  label: string
  desc: string
}> = [
  { key: 'responsive', label: '响应式（默认）', desc: '一行 2~6 列，按屏宽自动断点切换' },
  { key: 'fluid', label: '固定列数 + 伸缩', desc: '保留断点列数，每列宽度在最小/最大之间拉伸' },
  { key: 'fixed', label: '固定宽度（瀑布流）', desc: '单卡宽度固定，列数随屏宽变化' },
]

/**
 * 自定义档常用尺寸预设。第一项「标准」= CUSTOM_*_DEFAULT（点它 = 重置为默认）。
 * preview 用于按钮里直接画一个示意小方块，让用户看比例。
 */
const CARD_CUSTOM_PRESETS: Array<{
  key: string
  label: string
  desc: string
  wMin: number
  wMax: number
  hMin: number
  hMax: number
}> = [
  // 与原 standard 档（h-24）视觉一致；同时充当「重置」入口
  { key: 'standard', label: '标准', desc: '宽 160~240 · 高 96（默认）', wMin: 160, wMax: 240, hMin: 96, hMax: 96 },
  { key: 'compact', label: '紧凑', desc: '宽 140 · 高 80（最密）', wMin: 140, wMax: 140, hMin: 80, hMax: 80 },
  { key: 'large', label: '大卡', desc: '宽 200~280 · 高 140（信息舒展）', wMin: 200, wMax: 280, hMin: 140, hMax: 140 },
  { key: 'poster', label: '海报', desc: '宽 240 · 高 280（瀑布流式）', wMin: 240, wMax: 240, hMin: 280, hMax: 280 },
]

/**
 * 文字颜色预设：覆盖最常见的浅/深底配色场景。
 * 第一项 value 为空 = 清除自定义，回退到主题默认色。
 */
const PRESET_FONT_COLORS: Array<{ key: string; label: string; value: string }> = [
  { key: 'default', label: '默认', value: '' },
  { key: 'black', label: '纯黑', value: '#0f172a' },
  { key: 'white', label: '纯白', value: '#f8fafc' },
  { key: 'gray', label: '中灰', value: '#475569' },
  { key: 'warm', label: '暖白', value: '#f5f5f4' },
  { key: 'amber', label: '琥珀', value: '#d97706' },
]

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

const TABS = [
  { key: 'theme', label: '外观主题', icon: '🌗' },
  { key: 'background', label: '背景', icon: '🖼️' },
  { key: 'font', label: '文字颜色', icon: '🅰' },
  { key: 'layout', label: '内容布局', icon: '🧱' },
  { key: 'presets', label: '预设', icon: '💾' },
] as const
type StyleTab = (typeof TABS)[number]['key']

export function StyleDialog({
  settings,
  onClose,
  onUpdate,
}: {
  settings: UserSettings
  onClose: () => void
  onUpdate: (patch: Partial<UserSettings>) => Promise<void>
}) {
  const [activeTab, setActiveTab] = useState<StyleTab>('theme')

  // 自定义图片 URL 输入（仅当 wallpaper 不在预设里时回填）
  const isPreset = PRESET_WALLPAPERS.some((p) => p.value === (settings.wallpaper ?? ''))
  const [customUrl, setCustomUrl] = useState(isPreset ? '' : (settings.wallpaper ?? ''))

  // 字体颜色 hex 文本草稿态：用户在输入框敲不完整 hex 时（如 #ab）不立即应用，
  // 仅当合法 hex 时才提交到 settings；与 GradientEditor 的 ColorRow 同一思路
  const currentFontColor = settings.fontColor ?? ''
  const [fontHexDraft, setFontHexDraft] = useState<string | null>(null)
  const fontHexDisplay = fontHexDraft ?? currentFontColor
  const fontHexInvalid =
    fontHexDraft !== null && fontHexDraft !== '' && !HEX_COLOR_RE.test(fontHexDraft)

  const commitFontHex = () => {
    if (fontHexDraft === null) return
    const v = fontHexDraft.trim()
    if (v === '') {
      void onUpdate({ fontColor: '' })
    } else if (HEX_COLOR_RE.test(v)) {
      void onUpdate({ fontColor: v.toLowerCase() })
    }
    setFontHexDraft(null)
  }

  const handlePickFontColor = (value: string) => {
    setFontHexDraft(null)
    void onUpdate({ fontColor: value })
  }

  /* ───── 标准档卡片宽度（fluid / fixed）draft + commit 助手 ─────
   * 数字输入沿用 fontHex 的 draft 模式：用户敲入过程中的中间态不立即写 settings，
   * 只在 blur / Enter 时 clamp + commit。fluid min/max 还要保证 min <= max。
   */
  const widthMode = settings.cardWidthMode ?? 'responsive'
  const fluidMin = settings.cardWidthMin ?? CARD_WIDTH_FLUID_MIN_DEFAULT
  const fluidMax = settings.cardWidthMax ?? CARD_WIDTH_FLUID_MAX_DEFAULT
  const fixedWidth = settings.cardWidthFixed ?? CARD_WIDTH_FIXED_DEFAULT
  const [fluidMinDraft, setFluidMinDraft] = useState<string | null>(null)
  const [fluidMaxDraft, setFluidMaxDraft] = useState<string | null>(null)
  const [fixedWidthDraft, setFixedWidthDraft] = useState<string | null>(null)

  const commitFluidMin = () => {
    if (fluidMinDraft === null) return
    const v = clampCardWidth(Number(fluidMinDraft), CARD_WIDTH_FLUID_MIN_DEFAULT)
    setFluidMinDraft(null)
    // min 提到当前 max 之上时把 max 也抬起来，避免存下非法范围
    const nextMax = Math.max(v, fluidMax)
    void onUpdate(
      nextMax === fluidMax
        ? { cardWidthMin: v }
        : { cardWidthMin: v, cardWidthMax: nextMax },
    )
  }
  const commitFluidMax = () => {
    if (fluidMaxDraft === null) return
    const raw = clampCardWidth(Number(fluidMaxDraft), CARD_WIDTH_FLUID_MAX_DEFAULT)
    // max 被压到 min 之下时回弹到 min，保持 min <= max
    const v = Math.max(raw, fluidMin)
    setFluidMaxDraft(null)
    void onUpdate({ cardWidthMax: v })
  }
  const commitFixedWidth = () => {
    if (fixedWidthDraft === null) return
    const v = clampCardWidth(Number(fixedWidthDraft), CARD_WIDTH_FIXED_DEFAULT)
    setFixedWidthDraft(null)
    void onUpdate({ cardWidthFixed: v })
  }

  /* ───── 自定义档（custom）4 个 W/H min/max 输入 draft + commit ─────
   * 与 fluid/fixed 同款 draft 模式；min > max 时自动把 max 抬到 min（仅 commit min 时触发）。
   * 高度复用 clampCardHeight；宽度复用 clampCardWidth。
   */
  const customWMin = settings.cardCustomWidthMin ?? CUSTOM_W_MIN_DEFAULT
  const customWMax = settings.cardCustomWidthMax ?? CUSTOM_W_MAX_DEFAULT
  const customHMin = settings.cardCustomHeightMin ?? CUSTOM_H_MIN_DEFAULT
  const customHMax = settings.cardCustomHeightMax ?? CUSTOM_H_MAX_DEFAULT
  const [customWMinDraft, setCustomWMinDraft] = useState<string | null>(null)
  const [customWMaxDraft, setCustomWMaxDraft] = useState<string | null>(null)
  const [customHMinDraft, setCustomHMinDraft] = useState<string | null>(null)
  const [customHMaxDraft, setCustomHMaxDraft] = useState<string | null>(null)

  const commitCustomWMin = () => {
    if (customWMinDraft === null) return
    const v = clampCardWidth(Number(customWMinDraft), CUSTOM_W_MIN_DEFAULT)
    setCustomWMinDraft(null)
    const nextMax = Math.max(v, customWMax)
    void onUpdate(
      nextMax === customWMax
        ? { cardCustomWidthMin: v }
        : { cardCustomWidthMin: v, cardCustomWidthMax: nextMax },
    )
  }
  const commitCustomWMax = () => {
    if (customWMaxDraft === null) return
    const raw = clampCardWidth(Number(customWMaxDraft), CUSTOM_W_MAX_DEFAULT)
    const v = Math.max(raw, customWMin)
    setCustomWMaxDraft(null)
    void onUpdate({ cardCustomWidthMax: v })
  }
  const commitCustomHMin = () => {
    if (customHMinDraft === null) return
    const v = clampCardHeight(Number(customHMinDraft), CUSTOM_H_MIN_DEFAULT)
    setCustomHMinDraft(null)
    const nextMax = Math.max(v, customHMax)
    void onUpdate(
      nextMax === customHMax
        ? { cardCustomHeightMin: v }
        : { cardCustomHeightMin: v, cardCustomHeightMax: nextMax },
    )
  }
  const commitCustomHMax = () => {
    if (customHMaxDraft === null) return
    const raw = clampCardHeight(Number(customHMaxDraft), CUSTOM_H_MAX_DEFAULT)
    const v = Math.max(raw, customHMin)
    setCustomHMaxDraft(null)
    void onUpdate({ cardCustomHeightMax: v })
  }

  /**
   * 应用一个常用预设：一次写入 4 个字段，同时清掉所有 draft（避免用户改了一半
   * 又点预设时把半成品 draft 提交到错的字段上）。第一个预设是「标准」=默认值，
   * 等价于「重置」。
   */
  const applyCustomPreset = (p: { wMin: number; wMax: number; hMin: number; hMax: number }) => {
    setCustomWMinDraft(null)
    setCustomWMaxDraft(null)
    setCustomHMinDraft(null)
    setCustomHMaxDraft(null)
    void onUpdate({
      cardCustomWidthMin: p.wMin,
      cardCustomWidthMax: p.wMax,
      cardCustomHeightMin: p.hMin,
      cardCustomHeightMax: p.hMax,
    })
  }
  /** 当前 W/H 与某个预设完全相等时高亮该预设 */
  const matchedPresetKey = CARD_CUSTOM_PRESETS.find(
    (p) =>
      p.wMin === customWMin &&
      p.wMax === customWMax &&
      p.hMin === customHMin &&
      p.hMax === customHMax,
  )?.key

  /* ───── 样式预设：列表 + 保存当前 + 重命名 / 删除 + 导入导出 ─────
   * 列表数据从 localRepo.getPresets() 拉，第一次 mount 时异步加载，
   * 之后所有 mutation（save / rename / delete / import / reset）都立即
   * setStylePresets + 落盘，避免反复读盘。
   */
  const [stylePresets, setStylePresets] = useState<StylePreset[]>([])
  const [presetsLoaded, setPresetsLoaded] = useState(false)
  useEffect(() => {
    void (async () => {
      const list = await localRepo.getPresets()
      setStylePresets(list)
      setPresetsLoaded(true)
    })()
  }, [])

  /** 把整组（含 builtin）写盘——LocalRepository.savePresets 内部会自动过滤掉 builtin */
  const persistPresets = async (list: StylePreset[]): Promise<void> => {
    setStylePresets(list)
    await localRepo.savePresets(list)
  }

  /** 把当前 settings 视觉子集存为新 user 预设 */
  const handleSaveCurrentAsPreset = async () => {
    const name = await promptDialog({
      title: '保存当前样式为预设',
      message: '给这个预设起个名字（之后在列表里可以一键应用）',
      placeholder: '例如：我的工作流',
      confirmText: '保存',
    })
    if (!name) return
    const now = Date.now()
    const preset: StylePreset = {
      id: crypto.randomUUID(),
      name: name.trim(),
      kind: 'user',
      settings: pickPresettable(settings),
      createdAt: now,
      updatedAt: now,
    }
    await persistPresets([...stylePresets, preset])
    toast.success('已保存预设', preset.name)
  }

  /** 应用某个预设：spread 它的 settings 子集到当前 settings */
  const handleApplyPreset = async (preset: StylePreset) => {
    await applyStylePreset(preset, onUpdate)
    toast.success('已应用预设', preset.name)
  }

  /** 重命名 user 预设（builtin 不允许） */
  const handleRenamePreset = async (preset: StylePreset) => {
    if (preset.kind !== 'user') return
    const name = await promptDialog({
      title: '重命名预设',
      defaultValue: preset.name,
      confirmText: '保存',
    })
    if (!name) return
    const next = stylePresets.map((p) =>
      p.id === preset.id ? { ...p, name: name.trim(), updatedAt: Date.now() } : p,
    )
    await persistPresets(next)
  }

  /** 删除 user 预设（带二次确认；builtin 不允许） */
  const handleDeletePreset = async (preset: StylePreset) => {
    if (preset.kind !== 'user') return
    const ok = await confirmDialog({
      title: `删除预设「${preset.name}」？`,
      message: '删除后无法恢复（除非之前导出过 JSON）。',
      danger: true,
      confirmText: '删除',
    })
    if (!ok) return
    await persistPresets(stylePresets.filter((p) => p.id !== preset.id))
  }

  /** 导出 user 预设为 JSON 文件并触发浏览器下载 */
  const handleExportPresets = () => {
    const userPresets = stylePresets.filter((p) => p.kind === 'user')
    if (userPresets.length === 0) {
      toast.warning('没有可导出的预设', '当前只有内置预设；先「保存当前样式为预设」再来')
      return
    }
    const json = buildPresetExport(userPresets)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `curio-presets-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('已导出', `${userPresets.length} 个预设已保存为 JSON`)
  }

  /** 从用户选择的 JSON 文件导入预设，按 id 合并去重 */
  const handleImportPresets = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const incoming = parsePresetImport(text)
        if (!incoming) {
          toast.error('导入失败', 'JSON 格式不合法')
          return
        }
        if (incoming.length === 0) {
          toast.warning('未导入任何预设', '文件解析成功但里面没有有效预设')
          return
        }
        const existingUser = stylePresets.filter((p) => p.kind === 'user')
        const merged = mergeUserPresets(existingUser, incoming)
        // 拼回 [...BUILTIN, ...merged]；BUILTIN 不变
        const next = [
          ...stylePresets.filter((p) => p.kind === 'builtin'),
          ...merged,
        ]
        await persistPresets(next)
        toast.success('已导入', `合并后共 ${merged.length} 个用户预设`)
      } catch (err) {
        toast.error('导入失败', err instanceof Error ? err.message : '未知错误')
      }
    }
    input.click()
  }

  /** 清空所有 user 预设（带二次确认；builtin 不动） */
  const handleResetPresets = async () => {
    const userCount = stylePresets.filter((p) => p.kind === 'user').length
    if (userCount === 0) {
      toast.warning('没有可清除的预设', '当前只有内置预设')
      return
    }
    const ok = await confirmDialog({
      title: `清空全部 ${userCount} 个用户预设？`,
      message: '此操作仅清除"用户预设"，内置预设不受影响；建议先「导出」备份。',
      danger: true,
      confirmText: '清空',
    })
    if (!ok) return
    await localRepo.clearPresets()
    setStylePresets(stylePresets.filter((p) => p.kind === 'builtin'))
    toast.success('已清空用户预设')
  }


  const handlePickPreset = (value: string) => {
    void onUpdate({ wallpaper: value })
    setCustomUrl('')
  }

  const handleApplyCustomUrl = () => {
    const url = customUrl.trim()
    if (!url) return
    void onUpdate({ wallpaper: url })
  }

  const handleUploadImage = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      // 限制 2MB，避免 chrome.storage.local 超限
      if (file.size > 2 * 1024 * 1024) {
        toast.error('图片过大', '请选择 2MB 以内的图片')
        return
      }
      const reader = new FileReader()
      reader.onload = async () => {
        const dataUrl = String(reader.result || '')
        if (!dataUrl) return
        await onUpdate({ wallpaper: dataUrl })
        setCustomUrl(dataUrl)
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  return (
    <DialogShell
      title={
        <span className="flex items-center gap-2">
          <span className="text-base">🎨</span>
          <span>样式管理</span>
        </span>
      }
      width={560}
      onClose={onClose}
    >
      <div>
        {/* Tab 切换：把原本平铺的 4 个 section 收成 4 个 tab，避免弹窗过长 */}
        {/*
          Tab 切换：把原本平铺的 4 个 section 收成 4 个 tab，避免弹窗过长。
          - overflow-x-auto 仅给 4+ tab 的横向兜底；同时关 overflow-y，否则 macOS
            上系统滚动条样式（::-webkit-scrollbar 半透明 thumb）会在 y 方向画出
            一条多余的竖滚动条（实际内容并未溢出）。
          - 桌面端尽量隐藏滚动条本体（依靠左右轻微 padding 暗示可滚），
            tab 按钮 hover/focus 时浏览器仍能正常滚到可见区。
        */}
        <div
          className={cn(
            'flex gap-1 border-b border-slate-200 dark:border-slate-700 mb-4 -mx-5 px-5',
            'overflow-x-auto overflow-y-hidden',
            // 隐藏滚动条本身（Firefox + WebKit）；不影响滚动能力
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          )}
        >
          {TABS.map((t) => {
            const active = activeTab === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={cn(
                  'px-3 py-2 text-sm flex items-center gap-1.5 border-b-2 -mb-px transition-colors shrink-0',
                  active
                    ? 'border-brand text-brand font-medium'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
                )}
              >
                <span className="text-xs leading-none">{t.icon}</span>
                {t.label}
              </button>
            )
          })}
        </div>

        {/* 主题 */}
        {activeTab === 'theme' && (
        <section className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white/55 dark:bg-slate-900/45 p-4">
          <div className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map((opt) => {
              const active = settings.theme === opt.key
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => void onUpdate({ theme: opt.key })}
                  className={cn(
                    'flex flex-col items-center gap-1 px-3 py-3 rounded-md border transition-all',
                    active
                      ? 'border-brand bg-brand/5 dark:bg-brand/10'
                      : 'border-slate-200 dark:border-slate-700 hover:border-brand/40 hover:bg-slate-50 dark:hover:bg-slate-700/40',
                  )}
                >
                  <span className="text-xl leading-none">{opt.icon}</span>
                  <span
                    className={cn(
                      'text-xs',
                      active
                        ? 'text-brand font-medium'
                        : 'text-slate-600 dark:text-slate-300',
                    )}
                  >
                    {opt.label}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
        )}

        {/* 自定义背景 */}
        {activeTab === 'background' && (
        <section className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white/55 dark:bg-slate-900/45 p-4">
          {/* 预设缩略图 */}
          <div className="grid grid-cols-6 gap-2 mb-3">
            {PRESET_WALLPAPERS.map((p) => {
              const active = (settings.wallpaper ?? '') === p.value
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => handlePickPreset(p.value)}
                  title={p.label}
                  className={cn(
                    'group relative h-14 rounded-md overflow-hidden border-2 transition-all',
                    active
                      ? 'border-brand ring-2 ring-brand/30'
                      : 'border-slate-200 dark:border-slate-700 hover:border-brand/50',
                  )}
                  style={{ backgroundImage: p.preview, backgroundSize: 'cover' }}
                >
                  {p.key === 'none' && (
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] text-slate-500">
                      默认
                    </span>
                  )}
                  {active && p.key !== 'none' && (
                    <span className="absolute bottom-0.5 right-0.5 text-[10px] bg-brand text-white px-1 rounded">
                      ✓
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* 自定义渐变 / 调色盘 */}
          <div className="mb-3">
            <div className="text-[11px] text-slate-400 mb-1.5">
              自定义渐变（调色盘）
            </div>
            <GradientEditor
              initialCss={settings.wallpaper}
              onApply={(css) => {
                void onUpdate({ wallpaper: css })
                setCustomUrl('')
              }}
            />
          </div>

          {/* 自定义图片：URL 输入 + 本地上传 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleApplyCustomUrl()
                }}
                placeholder="粘贴图片 URL（https:// 或 data:image/…）"
                className={cn(
                  'flex-1 px-3 py-1.5 text-sm rounded-md',
                  'border border-slate-200 dark:border-slate-700',
                  'bg-white dark:bg-slate-900',
                  'outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all',
                  'placeholder:text-slate-400',
                )}
              />
              <button
                type="button"
                onClick={handleApplyCustomUrl}
                disabled={!customUrl.trim()}
                className={cn(
                  'px-3 py-1.5 text-sm rounded font-medium transition-colors',
                  'bg-brand text-white hover:bg-brand-600',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                应用
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleUploadImage}
                className={cn(
                  'px-3 py-1.5 text-xs rounded transition-colors',
                  'border border-slate-200 dark:border-slate-700',
                  'text-slate-600 dark:text-slate-300',
                  'hover:bg-slate-100 dark:hover:bg-slate-700/60',
                )}
              >
                📁 从本地上传
              </button>
              {settings.wallpaper && (
                <button
                  type="button"
                  onClick={() => {
                    void onUpdate({ wallpaper: '' })
                    setCustomUrl('')
                  }}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded transition-colors',
                    'text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10',
                  )}
                >
                  ✕ 清除背景
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              提示：本地上传的图片会以 base64 存储在浏览器本地，建议小于 2MB。
            </p>
          </div>

          {/* 背景毛玻璃强度：在背景与内容之间叠一层 backdrop-filter: blur(Npx) */}
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60">
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                毛玻璃强度
              </span>
              <input
                type="range"
                min={0}
                max={32}
                step={1}
                value={settings.backgroundBlur ?? 0}
                onChange={(e) =>
                  void onUpdate({ backgroundBlur: Number(e.target.value) })
                }
                className="flex-1 accent-brand cursor-pointer"
                aria-label="背景毛玻璃强度"
              />
              <span className="w-12 text-right text-[11px] tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                {settings.backgroundBlur ?? 0} px
              </span>
              {(settings.backgroundBlur ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => void onUpdate({ backgroundBlur: 0 })}
                  className={cn(
                    'px-2 py-1 text-[11px] rounded transition-colors shrink-0',
                    'text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10',
                  )}
                  title="清除毛玻璃效果"
                  aria-label="清除毛玻璃效果"
                >
                  ✕
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
              在背景之上叠一层模糊（0 = 关闭；建议 4~16 px）。让背景更朦胧、内容更聚焦。
            </p>
          </div>
        </section>
        )}

        {/* 文字颜色 */}
        {activeTab === 'font' && (
        <section className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white/55 dark:bg-slate-900/45 p-4">
          {/* 预设色块 */}
          <div className="grid grid-cols-6 gap-2 mb-3">
            {PRESET_FONT_COLORS.map((p) => {
              const active = currentFontColor === p.value
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => handlePickFontColor(p.value)}
                  title={p.label}
                  className={cn(
                    'group relative h-10 rounded-md overflow-hidden border-2 transition-all',
                    active
                      ? 'border-brand ring-2 ring-brand/30'
                      : 'border-slate-200 dark:border-slate-700 hover:border-brand/50',
                  )}
                  style={
                    p.value
                      ? { backgroundColor: p.value }
                      : {
                          backgroundImage:
                            'linear-gradient(135deg, #f1f5f9 50%, #1e293b 50%)',
                        }
                  }
                  aria-label={p.label}
                >
                  {p.key === 'default' && (
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] text-slate-700 mix-blend-difference">
                      默认
                    </span>
                  )}
                  {active && p.key !== 'default' && (
                    <span className="absolute bottom-0.5 right-0.5 text-[10px] bg-brand text-white px-1 rounded">
                      ✓
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* 自定义调色：input[type=color] + hex 文本框 */}
          <div className="flex items-center gap-2 mb-1">
            <input
              type="color"
              value={
                HEX_COLOR_RE.test(currentFontColor) ? currentFontColor : '#000000'
              }
              onChange={(e) => handlePickFontColor(e.target.value.toLowerCase())}
              className={cn(
                'w-9 h-8 rounded cursor-pointer shrink-0 p-0 bg-transparent',
                'border border-slate-200 dark:border-slate-600',
              )}
              title="打开调色盘"
              aria-label="选择文字颜色"
            />
            <input
              type="text"
              value={fontHexDisplay}
              onChange={(e) => setFontHexDraft(e.target.value.trim())}
              onBlur={commitFontHex}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                if (e.key === 'Escape') setFontHexDraft(null)
              }}
              spellCheck={false}
              placeholder="#000000"
              className={cn(
                'w-28 px-2 py-1 text-xs font-mono rounded',
                'bg-white dark:bg-slate-900',
                'border border-slate-200 dark:border-slate-700',
                'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
                fontHexInvalid && 'border-red-300 dark:border-red-500/60',
              )}
            />
            {currentFontColor && (
              <button
                type="button"
                onClick={() => handlePickFontColor('')}
                className={cn(
                  'px-3 py-1.5 text-xs rounded transition-colors',
                  'text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10',
                )}
                title="清除自定义文字颜色"
              >
                ✕ 清除
              </button>
            )}
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            该颜色仅影响"未单独设色"的文字（如卡片标题等）；按钮主色、辅助灰字等带有自身样式的元素不会被覆盖。
          </p>
        </section>
        )}

        {/* 排版偏好（v0.21.15）：子文件夹 section 的默认展开/折叠 */}
        {activeTab === 'layout' && (
        <section className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white/55 dark:bg-slate-900/45 p-4">
          <div className="mb-3">
            <div className="text-sm text-slate-700 dark:text-slate-200 mb-2">
              书签卡片尺寸
            </div>
            <div className="grid grid-cols-3 gap-2">
              {CARD_SIZE_OPTIONS.map((opt) => {
                const active = (settings.cardSize ?? 'standard') === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => void onUpdate({ cardSize: opt.key })}
                    className={cn(
                      'text-left px-3 py-2.5 rounded-lg border transition-all',
                      active
                        ? 'border-brand bg-brand/5 ring-2 ring-brand/20 dark:bg-brand/10'
                        : 'border-slate-200 dark:border-slate-700 hover:border-brand/40 hover:bg-slate-50 dark:hover:bg-slate-700/40',
                    )}
                  >
                    <div
                      className={cn(
                        'text-sm font-medium',
                        active
                          ? 'text-brand'
                          : 'text-slate-700 dark:text-slate-200',
                      )}
                    >
                      {opt.label}
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-400">
                      {opt.desc}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
          {/* 标准档专属：卡片宽度策略（fluid 伸缩 / fixed 瀑布流），紧跟书签卡片尺寸下面 */}
          {(settings.cardSize ?? 'standard') === 'standard' && (
            <div className="mb-3 rounded-lg border border-slate-200/70 dark:border-slate-700/60 p-3 bg-slate-50/50 dark:bg-slate-800/30">
              <div className="text-sm text-slate-700 dark:text-slate-200 mb-2">
                卡片宽度
                <span className="ml-1 text-[11px] text-slate-400">
                  （仅标准档生效）
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {CARD_WIDTH_MODE_OPTIONS.map((opt) => {
                  const active = widthMode === opt.key
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => void onUpdate({ cardWidthMode: opt.key })}
                      className={cn(
                        'text-left px-3 py-2 rounded-lg border transition-all',
                        active
                          ? 'border-brand bg-brand/5 ring-2 ring-brand/20 dark:bg-brand/10'
                          : 'border-slate-200 dark:border-slate-700 hover:border-brand/40 hover:bg-slate-50 dark:hover:bg-slate-700/40',
                      )}
                    >
                      <div
                        className={cn(
                          'text-xs font-medium',
                          active
                            ? 'text-brand'
                            : 'text-slate-700 dark:text-slate-200',
                        )}
                      >
                        {opt.label}
                      </div>
                      <div className="mt-0.5 text-[10px] leading-relaxed text-slate-400">
                        {opt.desc}
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* fluid：min / max 输入 */}
              {widthMode === 'fluid' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-slate-500 dark:text-slate-400 w-16 shrink-0">
                      最小宽度
                    </label>
                    <input
                      type="number"
                      min={CARD_WIDTH_MIN_PX}
                      max={CARD_WIDTH_MAX_PX}
                      step={4}
                      value={fluidMinDraft ?? fluidMin}
                      onChange={(e) => setFluidMinDraft(e.target.value)}
                      onBlur={commitFluidMin}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                        if (e.key === 'Escape') setFluidMinDraft(null)
                      }}
                      className={cn(
                        'w-20 px-2 py-1 text-xs tabular-nums rounded',
                        'bg-white dark:bg-slate-900',
                        'border border-slate-200 dark:border-slate-700',
                        'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
                      )}
                    />
                    <span className="text-[11px] text-slate-400">px</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-slate-500 dark:text-slate-400 w-16 shrink-0">
                      最大宽度
                    </label>
                    <input
                      type="number"
                      min={CARD_WIDTH_MIN_PX}
                      max={CARD_WIDTH_MAX_PX}
                      step={4}
                      value={fluidMaxDraft ?? fluidMax}
                      onChange={(e) => setFluidMaxDraft(e.target.value)}
                      onBlur={commitFluidMax}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                        if (e.key === 'Escape') setFluidMaxDraft(null)
                      }}
                      className={cn(
                        'w-20 px-2 py-1 text-xs tabular-nums rounded',
                        'bg-white dark:bg-slate-900',
                        'border border-slate-200 dark:border-slate-700',
                        'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
                      )}
                    />
                    <span className="text-[11px] text-slate-400">px</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    列数仍按断点切换（2~6 列），每列宽度被夹在 {fluidMin}~{fluidMax}px。
                    若窗口窄到放不下，可能出现横向滚动。
                  </p>
                </div>
              )}

              {/* fixed：单卡固定宽度 */}
              {widthMode === 'fixed' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-slate-500 dark:text-slate-400 w-16 shrink-0">
                      卡片宽度
                    </label>
                    <input
                      type="number"
                      min={CARD_WIDTH_MIN_PX}
                      max={CARD_WIDTH_MAX_PX}
                      step={4}
                      value={fixedWidthDraft ?? fixedWidth}
                      onChange={(e) => setFixedWidthDraft(e.target.value)}
                      onBlur={commitFixedWidth}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                        if (e.key === 'Escape') setFixedWidthDraft(null)
                      }}
                      className={cn(
                        'w-20 px-2 py-1 text-xs tabular-nums rounded',
                        'bg-white dark:bg-slate-900',
                        'border border-slate-200 dark:border-slate-700',
                        'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
                      )}
                    />
                    <span className="text-[11px] text-slate-400">px</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    每张卡片固定 {fixedWidth}px，列数 = ⌊容器宽 / {fixedWidth}px⌋，
                    随窗口宽度无级变化（类似瀑布流）。
                  </p>
                </div>
              )}
            </div>
          )}
          {/* 自定义档专属：宽 / 高的 min / max 输入。仅当 cardSize === 'custom' 时展示 */}
          {settings.cardSize === 'custom' && (
            <div className="mb-3 rounded-lg border border-slate-200/70 dark:border-slate-700/60 p-3 bg-slate-50/50 dark:bg-slate-800/30">
              <div className="text-sm text-slate-700 dark:text-slate-200 mb-2 flex items-center justify-between gap-2">
                <span>
                  自定义尺寸
                  <span className="ml-1 text-[11px] text-slate-400">
                    （min 与 max 相同则为固定值）
                  </span>
                </span>
              </div>

              {/* 实时预览：直接按 draft / 实际值画一个 mock 卡片，让用户在调输入时立即看到效果 */}
              <div className="mb-3 px-3 py-3 rounded-md bg-white/60 dark:bg-slate-900/40 border border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center min-h-[120px]">
                {(() => {
                  // 用 draft 值（如果有）做预览，让用户敲入过程中就能看到效果，不必等 blur
                  const previewWMin = clampCardWidth(
                    customWMinDraft !== null ? Number(customWMinDraft) : customWMin,
                    customWMin,
                  )
                  const previewWMax = Math.max(
                    previewWMin,
                    clampCardWidth(
                      customWMaxDraft !== null ? Number(customWMaxDraft) : customWMax,
                      customWMax,
                    ),
                  )
                  const previewHMin = clampCardHeight(
                    customHMinDraft !== null ? Number(customHMinDraft) : customHMin,
                    customHMin,
                  )
                  const previewHMax = Math.max(
                    previewHMin,
                    clampCardHeight(
                      customHMaxDraft !== null ? Number(customHMaxDraft) : customHMax,
                      customHMax,
                    ),
                  )
                  // 容器内最大可用宽度（弹窗内容宽 ≈ 520，刨除 padding/边距 ≈ 460）；
                  // 预览卡片宽度取 min(previewWMax, 220)，避免预览把弹窗撑爆
                  const renderW = Math.min(previewWMax, 220)
                  // 高度按 min 显示（min === max 时即为固定值；min < max 时呈现"最小态"）
                  return (
                    <div
                      className={cn(
                        'card flex flex-col gap-2.5 p-3.5 overflow-hidden',
                        'border border-slate-200/80 dark:border-slate-700/80 shadow-sm',
                      )}
                      style={{
                        width: renderW,
                        minHeight: previewHMin,
                        maxHeight: previewHMax,
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <div className="w-9 h-9 rounded-lg bg-brand/20 flex items-center justify-center text-brand text-base shrink-0">
                          🔖
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold leading-snug line-clamp-2 text-slate-800 dark:text-slate-100">
                            预览：示例书签
                          </div>
                          <div className="text-[11px] text-slate-400 truncate mt-0.5">
                            example.com
                          </div>
                        </div>
                      </div>
                      {/* 高度自适应时（min < max）显示"备注"占位，让用户看出高度上限 */}
                      {previewHMax > previewHMin && (
                        <div className="text-xs leading-snug line-clamp-2 text-slate-500 dark:text-slate-400">
                          备注内容会自动撑高，但不超过 maxHeight。
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>

              {/* 预设按钮组（含「重置」语义：点「标准」= 回默认值） */}
              <div className="mb-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
                  常用预设
                  <span className="ml-1 text-slate-400/70">（点「标准」可重置为默认）</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {CARD_CUSTOM_PRESETS.map((p) => {
                    const active = matchedPresetKey === p.key
                    return (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => applyCustomPreset(p)}
                        title={p.desc}
                        className={cn(
                          'px-2 py-1.5 text-xs rounded-md border transition-all text-center',
                          active
                            ? 'border-brand bg-brand/5 text-brand font-medium ring-2 ring-brand/20 dark:bg-brand/10'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand/40 hover:bg-slate-50 dark:hover:bg-slate-700/40',
                        )}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              {/* 宽度行 */}
              <div className="flex items-center gap-2 mb-2">
                <label className="text-[11px] text-slate-500 dark:text-slate-400 w-10 shrink-0">
                  宽度
                </label>
                <input
                  type="number"
                  min={CARD_WIDTH_MIN_PX}
                  max={CARD_WIDTH_MAX_PX}
                  step={4}
                  value={customWMinDraft ?? customWMin}
                  onChange={(e) => setCustomWMinDraft(e.target.value)}
                  onBlur={commitCustomWMin}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                    if (e.key === 'Escape') setCustomWMinDraft(null)
                  }}
                  className={cn(
                    'w-20 px-2 py-1 text-xs tabular-nums rounded',
                    'bg-white dark:bg-slate-900',
                    'border border-slate-200 dark:border-slate-700',
                    'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
                  )}
                  aria-label="卡片最小宽度"
                />
                <span className="text-[11px] text-slate-400">~</span>
                <input
                  type="number"
                  min={CARD_WIDTH_MIN_PX}
                  max={CARD_WIDTH_MAX_PX}
                  step={4}
                  value={customWMaxDraft ?? customWMax}
                  onChange={(e) => setCustomWMaxDraft(e.target.value)}
                  onBlur={commitCustomWMax}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                    if (e.key === 'Escape') setCustomWMaxDraft(null)
                  }}
                  className={cn(
                    'w-20 px-2 py-1 text-xs tabular-nums rounded',
                    'bg-white dark:bg-slate-900',
                    'border border-slate-200 dark:border-slate-700',
                    'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
                  )}
                  aria-label="卡片最大宽度"
                />
                <span className="text-[11px] text-slate-400">px</span>
              </div>
              {/* 高度行 */}
              <div className="flex items-center gap-2 mb-2">
                <label className="text-[11px] text-slate-500 dark:text-slate-400 w-10 shrink-0">
                  高度
                </label>
                <input
                  type="number"
                  min={CARD_HEIGHT_MIN_PX}
                  max={CARD_HEIGHT_MAX_PX}
                  step={4}
                  value={customHMinDraft ?? customHMin}
                  onChange={(e) => setCustomHMinDraft(e.target.value)}
                  onBlur={commitCustomHMin}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                    if (e.key === 'Escape') setCustomHMinDraft(null)
                  }}
                  className={cn(
                    'w-20 px-2 py-1 text-xs tabular-nums rounded',
                    'bg-white dark:bg-slate-900',
                    'border border-slate-200 dark:border-slate-700',
                    'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
                  )}
                  aria-label="卡片最小高度"
                />
                <span className="text-[11px] text-slate-400">~</span>
                <input
                  type="number"
                  min={CARD_HEIGHT_MIN_PX}
                  max={CARD_HEIGHT_MAX_PX}
                  step={4}
                  value={customHMaxDraft ?? customHMax}
                  onChange={(e) => setCustomHMaxDraft(e.target.value)}
                  onBlur={commitCustomHMax}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                    if (e.key === 'Escape') setCustomHMaxDraft(null)
                  }}
                  className={cn(
                    'w-20 px-2 py-1 text-xs tabular-nums rounded',
                    'bg-white dark:bg-slate-900',
                    'border border-slate-200 dark:border-slate-700',
                    'outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
                  )}
                  aria-label="卡片最大高度"
                />
                <span className="text-[11px] text-slate-400">px</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                列数 = ⌊容器宽 / {customWMin}px⌋；
                {customWMin === customWMax
                  ? `每张卡片固定 ${customWMin}px 宽。`
                  : `每列宽度在 ${customWMin}~${customWMax}px 间自动放大。`}
                {customHMin === customHMax
                  ? `高度固定 ${customHMin}px。`
                  : `高度随内容在 ${customHMin}~${customHMax}px 间自适应。`}
              </p>
            </div>
          )}
          <div className="mb-3">
            <div className="text-sm text-slate-700 dark:text-slate-200 mb-2">
              图标尺寸
            </div>
            <div className="grid grid-cols-2 gap-2">
              {CARD_ICON_SIZE_OPTIONS.map((opt) => {
                const active = (settings.cardIconSize ?? 'standard') === opt.key
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => void onUpdate({ cardIconSize: opt.key })}
                    className={cn(
                      'text-left px-3 py-2.5 rounded-lg border transition-all',
                      active
                        ? 'border-brand bg-brand/5 ring-2 ring-brand/20 dark:bg-brand/10'
                        : 'border-slate-200 dark:border-slate-700 hover:border-brand/40 hover:bg-slate-50 dark:hover:bg-slate-700/40',
                    )}
                  >
                    <div
                      className={cn(
                        'text-sm font-medium',
                        active
                          ? 'text-brand'
                          : 'text-slate-700 dark:text-slate-200',
                      )}
                    >
                      {opt.label}
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-400">
                      {opt.desc}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
          <label
            className={cn(
              'flex items-start gap-3 px-3 py-2.5 rounded-md cursor-pointer',
              'border border-slate-200 dark:border-slate-700',
              'hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors',
            )}
          >
            <input
              type="checkbox"
              checked={settings.subSectionDefaultExpanded ?? false}
              onChange={(e) =>
                void onUpdate({ subSectionDefaultExpanded: e.target.checked })
              }
              className="mt-0.5 w-4 h-4 accent-brand cursor-pointer shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-slate-700 dark:text-slate-200">
                子文件夹默认展开
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                开启后，进入分类时其下所有子文件夹的书签 section 自动展开（一眼看到全部内容）。
                关闭则默认折叠，需要时点 header 展开。
              </div>
            </div>
          </label>

          {/* 书签卡片毛玻璃开关（v0.21.18）：默认开启，关闭后切到实色 */}
          <label
            className={cn(
              'mt-2 flex items-start gap-3 px-3 py-2.5 rounded-md cursor-pointer',
              'border border-slate-200 dark:border-slate-700',
              'hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors',
            )}
          >
            <input
              type="checkbox"
              checked={settings.cardGlass ?? true}
              onChange={(e) =>
                void onUpdate({ cardGlass: e.target.checked })
              }
              className="mt-0.5 w-4 h-4 accent-brand cursor-pointer shrink-0"
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-slate-700 dark:text-slate-200">
                书签卡片毛玻璃
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                开启（默认）：卡片半透明 + 背景模糊，与自定义背景融合更优雅。
                关闭：卡片纯实色背景，文字对比度更高，渲染更轻。
              </div>
            </div>
          </label>
        </section>
        )}

        {/* 样式预设 */}
        {activeTab === 'presets' && (
        <section className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white/55 dark:bg-slate-900/45 p-4">
          {/* 顶部：保存当前 */}
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <div className="text-sm text-slate-700 dark:text-slate-200 font-medium">
                我的样式预设
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                把当前样式存为预设，之后一键切换；导出 JSON 可跨设备同步或分享
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleSaveCurrentAsPreset()}
              className={cn(
                'px-3 py-1.5 text-xs rounded font-medium transition-colors shrink-0',
                'bg-brand text-white hover:bg-brand-600',
              )}
            >
              + 保存当前
            </button>
          </div>

          {/* 预设列表 */}
          {!presetsLoaded ? (
            <div className="text-[11px] text-slate-400 py-6 text-center">加载中…</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 mb-4">
              {stylePresets.map((p) => {
                const isBuiltin = p.kind === 'builtin'
                // 简单视觉预览：用 wallpaper（如果是 linear-gradient / 颜色）+ fontColor 拼一个小色块
                const previewBg = p.settings.wallpaper || 'linear-gradient(135deg, #f1f5f9, #e0e7ff)'
                const previewFont = p.settings.fontColor || (p.settings.theme === 'dark' ? '#f8fafc' : '#0f172a')
                return (
                  <div
                    key={p.id}
                    className={cn(
                      'group relative rounded-lg border p-2.5 transition-all',
                      'border-slate-200 dark:border-slate-700 bg-white/40 dark:bg-slate-800/30',
                      'hover:border-brand/40 hover:shadow-sm',
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      {/* 色块预览 */}
                      <div
                        className="w-12 h-12 rounded-md border border-slate-200 dark:border-slate-700 shrink-0 overflow-hidden flex items-center justify-center text-base font-semibold"
                        style={{ backgroundImage: previewBg, backgroundSize: 'cover', color: previewFont }}
                        title="样式预览"
                      >
                        Aa
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate flex items-center gap-1">
                          {p.name}
                          {isBuiltin && (
                            <span
                              className="text-[10px] text-slate-400"
                              title="内置预设，无法删除或重命名"
                            >
                              🔒
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {p.settings.cardSize ?? 'standard'} · {p.settings.theme ?? 'auto'}
                        </div>
                      </div>
                    </div>
                    {/* 操作行 */}
                    <div className="flex items-center gap-1 mt-2">
                      <button
                        type="button"
                        onClick={() => void handleApplyPreset(p)}
                        className={cn(
                          'flex-1 px-2 py-1 text-[11px] rounded transition-colors',
                          'bg-brand/10 text-brand hover:bg-brand/20',
                        )}
                      >
                        应用
                      </button>
                      {!isBuiltin && (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleRenamePreset(p)}
                            title="重命名"
                            className={cn(
                              'px-2 py-1 text-[11px] rounded transition-colors',
                              'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700/40',
                            )}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeletePreset(p)}
                            title="删除"
                            className={cn(
                              'px-2 py-1 text-[11px] rounded transition-colors',
                              'text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10',
                            )}
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* 导入 / 导出 / 重置 工具栏 */}
          <div className="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-700/60">
            <button
              type="button"
              onClick={handleExportPresets}
              className={cn(
                'px-3 py-1.5 text-xs rounded transition-colors',
                'border border-slate-200 dark:border-slate-700',
                'text-slate-600 dark:text-slate-300',
                'hover:bg-slate-100 dark:hover:bg-slate-700/60',
              )}
            >
              📤 导出全部
            </button>
            <button
              type="button"
              onClick={handleImportPresets}
              className={cn(
                'px-3 py-1.5 text-xs rounded transition-colors',
                'border border-slate-200 dark:border-slate-700',
                'text-slate-600 dark:text-slate-300',
                'hover:bg-slate-100 dark:hover:bg-slate-700/60',
              )}
            >
              📥 从 JSON 导入
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => void handleResetPresets()}
              className={cn(
                'px-3 py-1.5 text-xs rounded transition-colors',
                'text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10',
              )}
            >
              清空用户预设
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
            预设包含主题 / 背景 / 字色 / 卡片布局四类设置；仅存于本机，
            不随浏览器账号同步（避免壁纸 base64 占用 sync 配额）。
          </p>
        </section>
        )}
      </div>
    </DialogShell>
  )
}
