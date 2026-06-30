import { useState } from 'react'
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
  type UserSettings,
} from '../../types/bookmark'
import { cn } from '../../utils/cn'
import { clampCardHeight, clampCardWidth } from '../../utils/cardGrid'
import { toast } from '../../stores/useToastStore'
import { GradientEditor } from '../GradientEditor'
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
        <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700 mb-4 -mx-5 px-5 overflow-x-auto">
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
              <div className="text-sm text-slate-700 dark:text-slate-200 mb-2">
                自定义尺寸
                <span className="ml-1 text-[11px] text-slate-400">
                  （min 与 max 相同则为固定值）
                </span>
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
      </div>
    </DialogShell>
  )
}
