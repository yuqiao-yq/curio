import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../utils/cn'
import { COMMON_EMOJIS, IconView, isImageIcon } from '../utils/icon'
import { ImageCropDialog } from './ImageCropDialog'
import { toast } from '../stores/useToastStore'

type Tab = 'emoji' | 'url' | 'upload'

interface Props {
  /** 当前图标值（可能是 emoji / URL / dataURL） */
  value?: string
  /** 选中新值时回调（传 undefined 表示恢复默认） */
  onChange: (value: string | undefined) => void
  /** 触发器自定义渲染（不传则用默认按钮：当前 IconView） */
  trigger?: (open: () => void) => React.ReactNode
  /** 默认 emoji（用于"恢复默认"按钮的提示） */
  defaultEmoji?: string
  /** 上传图片大小上限（KB），默认 2048（裁剪场景需允许高分辨率源图） */
  maxUploadKB?: number
  /** 弹层水平对齐策略，默认 left（弹层左边对齐触发器左边） */
  align?: 'left' | 'right'
}

const POPOVER_WIDTH = 288 // = w-72
const POPOVER_MAX_HEIGHT = 360 // 估算最大高度，用于决定向上还是向下展开
const VIEWPORT_PAD = 8

/**
 * 通用图标选择器：
 * - Emoji：从常用候选里选
 * - URL：粘贴图片链接，实时预览
 * - 上传：选本地图片，转 base64 存入（用于离线/私域图）
 *
 * 弹层使用 React Portal 挂载到 document.body：
 * - 彻底脱离任何祖先的 overflow:hidden 裁切（侧栏 / 卡片）
 * - 不受祖先 transform/filter 创建的 stacking context 影响
 * - fixed 定位，根据 trigger 的 boundingRect 实时计算位置
 * - 边界自动翻转：右溢出 → 改右对齐；下溢出 → 向上展开
 */
export function IconPicker({
  value,
  onChange,
  trigger,
  defaultEmoji = '📁',
  maxUploadKB = 2048,
  align = 'left',
}: Props) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>(() =>
    isImageIcon(value) ? 'url' : 'emoji',
  )
  const [urlDraft, setUrlDraft] = useState(isImageIcon(value) ? value! : '')
  // 上传后待裁剪的源图 dataURL；非空 = 裁剪框打开
  const [cropSource, setCropSource] = useState<string | null>(null)

  // 弹层位置（fixed 坐标）
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const triggerWrapRef = useRef<HTMLSpanElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // ── 点击 / 滚轮外部关闭 ──────────────────────────
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (triggerWrapRef.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // ── 打开时同步 tab + URL 草稿 ──────────────────
  useEffect(() => {
    if (open) {
      setTab(isImageIcon(value) ? 'url' : 'emoji')
      setUrlDraft(isImageIcon(value) ? value! : '')
    }
  }, [open, value])

  // ── 计算弹层位置（首次 + scroll/resize 时） ────────
  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const trigger = triggerWrapRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight

      // 水平：默认左对齐，align="right" 则右对齐；超界自动夹回
      let left =
        align === 'right'
          ? rect.right - POPOVER_WIDTH
          : rect.left
      if (left + POPOVER_WIDTH > vw - VIEWPORT_PAD) {
        left = vw - POPOVER_WIDTH - VIEWPORT_PAD
      }
      if (left < VIEWPORT_PAD) left = VIEWPORT_PAD

      // 垂直：默认在触发器下方；下方放不下且上方更宽裕 → 改为向上展开
      const spaceBelow = vh - rect.bottom - VIEWPORT_PAD
      const spaceAbove = rect.top - VIEWPORT_PAD
      let top: number
      if (spaceBelow >= POPOVER_MAX_HEIGHT || spaceBelow >= spaceAbove) {
        top = rect.bottom + 6
      } else {
        // 向上展开：弹层底边贴近触发器顶部
        top = Math.max(VIEWPORT_PAD, rect.top - POPOVER_MAX_HEIGHT - 6)
      }

      setPos({ top, left })
    }
    update()
    window.addEventListener('scroll', update, true) // capture：捕获所有滚动容器
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, align])

  const pick = (next: string | undefined) => {
    onChange(next)
    setOpen(false)
  }

  const handleUpload = (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件')
      return
    }
    const sizeKB = file.size / 1024
    if (sizeKB > maxUploadKB) {
      toast.error(
        '图片过大',
        `${sizeKB.toFixed(0)}KB，上限 ${maxUploadKB}KB`,
      )
      return
    }
    const reader = new FileReader()
    reader.onload = () => setCropSource(String(reader.result))
    reader.onerror = () => toast.error('读取失败')
    reader.readAsDataURL(file)
  }

  const popover = open && pos && createPortal(
    <div
      ref={popoverRef}
      // 阻止冒泡，避免外层卡片接到 click/拖拽事件
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ top: pos.top, left: pos.left, width: POPOVER_WIDTH }}
      className={cn(
        'fixed z-[9999] p-2 rounded-lg',
        'border border-slate-200 dark:border-slate-700',
        'bg-white dark:bg-slate-800 shadow-xl',
      )}
    >
      {/* 顶部：当前图标预览 + tab 切换 + 恢复默认 */}
      <div className="flex items-center gap-1 mb-2">
        <div
          className={cn(
            'w-8 h-8 flex items-center justify-center rounded',
            'bg-slate-100 dark:bg-slate-900 shrink-0',
          )}
        >
          <IconView
            value={value}
            fallback={defaultEmoji}
            emojiClassName="text-xl leading-none"
            imgClassName="w-6 h-6 rounded-sm object-contain"
          />
        </div>
        <div className="flex-1 grid grid-cols-3 gap-0.5 bg-slate-100 dark:bg-slate-900 rounded p-0.5">
          {(
            [
              ['emoji', 'Emoji'],
              ['url', '链接'],
              ['upload', '上传'],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                'text-xs py-1 rounded transition-colors',
                tab === k
                  ? 'bg-white dark:bg-slate-700 text-brand font-medium shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-200',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => pick(undefined)}
          className={cn(
            'text-[11px] px-1.5 py-1 rounded shrink-0',
            'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
            'hover:bg-slate-100 dark:hover:bg-slate-700/60',
          )}
          title="恢复默认图标"
        >
          重置
        </button>
      </div>

      {/* Emoji 网格 */}
      {tab === 'emoji' && (
        <div className="grid grid-cols-8 gap-0.5 max-h-56 overflow-y-auto pr-1">
          {COMMON_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => pick(e)}
              className={cn(
                'aspect-square flex items-center justify-center rounded text-lg leading-none',
                'hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors',
                value === e && 'bg-brand/10 ring-1 ring-brand/40',
              )}
              title={e}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {/* URL 输入 */}
      {tab === 'url' && (
        <div className="flex flex-col gap-2 py-1">
          <input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="https://example.com/icon.png"
            spellCheck={false}
            className={cn(
              'w-full px-2 py-1.5 text-xs rounded font-mono',
              'bg-white dark:bg-slate-900',
              'border border-slate-200 dark:border-slate-700',
              'focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand/30',
            )}
          />
          {urlDraft && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>预览：</span>
              <img
                src={urlDraft}
                alt=""
                className="w-6 h-6 rounded-sm object-contain bg-slate-100 dark:bg-slate-900"
              />
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!urlDraft.trim()}
              onClick={() => pick(urlDraft.trim())}
              className={cn(
                'px-2.5 py-1 rounded text-xs font-medium transition-colors',
                urlDraft.trim()
                  ? 'bg-brand text-white hover:bg-brand-600'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed dark:bg-slate-700 dark:text-slate-500',
              )}
            >
              应用
            </button>
          </div>
        </div>
      )}

      {/* 上传 */}
      {tab === 'upload' && (
        <div className="flex flex-col gap-2 py-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleUpload(file)
              e.target.value = '' // 允许重复选同一文件
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              'w-full py-6 rounded border-2 border-dashed text-xs',
              'border-slate-300 dark:border-slate-600',
              'text-slate-500 dark:text-slate-400',
              'hover:border-brand hover:text-brand transition-colors',
            )}
          >
            点击选择本地图片
            <div className="text-[10px] mt-1 opacity-60">
              支持 PNG / JPG / SVG，上限 {maxUploadKB}KB；选好后可裁剪
            </div>
          </button>
        </div>
      )}
    </div>,
    document.body,
  )

  return (
    <>
      {/* 触发器：用 inline 块包一层，便于通过 ref 拿到位置 */}
      <span ref={triggerWrapRef} className="inline-flex">
        {trigger ? (
          trigger(() => setOpen((v) => !v))
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
            className={cn(
              'flex items-center justify-center w-7 h-7 rounded',
              'hover:bg-slate-100 dark:hover:bg-slate-700/60 transition-colors',
            )}
            title="修改图标"
          >
            <IconView
              value={value}
              fallback={defaultEmoji}
              emojiClassName="text-lg leading-none"
              imgClassName="w-5 h-5 rounded-sm object-contain"
            />
          </button>
        )}
      </span>
      {popover}
      {cropSource && (
        <ImageCropDialog
          source={cropSource}
          onConfirm={(dataURL) => {
            setCropSource(null)
            pick(dataURL)
          }}
          onCancel={() => setCropSource(null)}
        />
      )}
    </>
  )
}
