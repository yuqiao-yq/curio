import { useState } from 'react'
import type { UserSettings } from '../../types/bookmark'
import { cn } from '../../utils/cn'
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
  { key: 'sm', label: '小', desc: '更紧凑，适合大量书签' },
  { key: 'md', label: '中', desc: '默认尺寸，信息密度均衡' },
  { key: 'lg', label: '大', desc: '更舒展，备注更易读' },
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

export function StyleDialog({
  settings,
  onClose,
  onUpdate,
}: {
  settings: UserSettings
  onClose: () => void
  onUpdate: (patch: Partial<UserSettings>) => Promise<void>
}) {
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
      <div className="space-y-4">
        {/* 主题 */}
        <section className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white/55 dark:bg-slate-900/45 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            外观主题
          </h4>
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

        {/* 自定义背景 */}
        <section className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white/55 dark:bg-slate-900/45 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            背景
          </h4>

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

        {/* 文字颜色 */}
        <section className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white/55 dark:bg-slate-900/45 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            文字颜色
          </h4>

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

        {/* 排版偏好（v0.21.15）：子文件夹 section 的默认展开/折叠 */}
        <section className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white/55 dark:bg-slate-900/45 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            内容布局
          </h4>
          <div className="mb-3">
            <div className="text-sm text-slate-700 dark:text-slate-200 mb-2">
              书签卡片尺寸
            </div>
            <div className="grid grid-cols-3 gap-2">
              {CARD_SIZE_OPTIONS.map((opt) => {
                const active = (settings.cardSize ?? 'md') === opt.key
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
      </div>
    </DialogShell>
  )
}
