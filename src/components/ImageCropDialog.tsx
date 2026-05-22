import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Cropper, { type Area } from 'react-easy-crop'
import { cn } from '../utils/cn'

interface ImageCropDialogProps {
  /** 输入图片 dataURL（或可被 <img> 加载的 URL） */
  source: string
  /** 裁剪宽高比，默认 1（正方形，匹配图标位） */
  aspect?: number
  /** 应用裁剪后回调，参数为裁剪结果的 dataURL（PNG，原图分辨率） */
  onConfirm: (dataURL: string) => void
  /** 关闭/取消回调（点取消、按 Esc、点遮罩都走这里） */
  onCancel: () => void
}

/**
 * 自定义图标上传后的裁剪对话框。
 *
 * z-index = 10180，必须高于 IconPicker popover 的 9999，沿用
 * RelatedReadingDialog 同档；与 ToastContainer (10000)、AI panel (10080+) 不互踩。
 *
 * 输出语义：「保持原图分辨率」——canvas 尺寸 = croppedAreaPixels，
 * 用户在原图上框出多大区域，输出就多大像素，不再降采样。
 */
export function ImageCropDialog({
  source,
  aspect = 1,
  onConfirm,
  onCancel,
}: ImageCropDialogProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [busy, setBusy] = useState(false)

  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const handleApply = async () => {
    if (!croppedAreaPixels || busy) return
    setBusy(true)
    try {
      const dataURL = await getCroppedDataURL(source, croppedAreaPixels)
      onConfirm(dataURL)
    } catch (err) {
      console.error('[ImageCropDialog] 裁剪失败', err)
      setBusy(false)
    }
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="fixed inset-0 z-[10180] flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-[480px] max-w-[92vw] flex flex-col rounded-lg shadow-2xl overflow-hidden',
          'bg-white dark:bg-slate-800',
          'border border-slate-200 dark:border-slate-700',
        )}
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
            裁剪图标
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            拖拽调整位置，滑块或滚轮缩放，输出按原图分辨率
          </div>
        </div>

        <div className="relative w-full h-[320px] bg-slate-900">
          <Cropper
            image={source}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            cropShape="rect"
            showGrid
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            objectFit="contain"
          />
        </div>

        <div className="px-4 py-3 flex items-center gap-3 border-t border-slate-200 dark:border-slate-700">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
            缩放
          </span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-brand"
            aria-label="缩放"
          />
          <span className="text-[11px] text-slate-400 tabular-nums w-10 text-right shrink-0">
            {zoom.toFixed(2)}x
          </span>
        </div>

        <div className="px-4 py-3 flex justify-end gap-2 border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={cn(
              'px-3 py-1.5 text-sm rounded transition-colors',
              'text-slate-600 dark:text-slate-300',
              'hover:bg-slate-100 dark:hover:bg-slate-700/60',
              'disabled:opacity-50',
            )}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!croppedAreaPixels || busy}
            className={cn(
              'px-3 py-1.5 text-sm rounded font-medium transition-colors',
              'bg-brand text-white hover:bg-brand-600',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {busy ? '处理中…' : '应用'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * 把 source 图按 croppedAreaPixels 选区切出来，输出 PNG dataURL。
 *
 * canvas 尺寸 = 选区在原图上的实际像素，所以输出保留了用户选区的原始分辨率，
 * 不做任何降采样或压缩；PNG 是为了保留透明通道（图标场景常见）。
 */
async function getCroppedDataURL(source: string, area: Area): Promise<string> {
  const img = await loadImage(source)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(area.width)
  canvas.height = Math.round(area.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context 不可用')
  ctx.drawImage(
    img,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  return canvas.toDataURL('image/png')
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.crossOrigin = 'anonymous'
    img.src = src
  })
}
