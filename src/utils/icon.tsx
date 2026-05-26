import { cn } from './cn'

/**
 * 图标值有三种来源（统一存储为 string）：
 *   1. emoji / 普通字符串：'📁' '⭐' 'A'
 *   2. 远端图片 URL：'https://...'  / 'http://...'
 *   3. 本地上传图片：'data:image/...'  (base64 dataURL)
 *
 * 这里给出统一的判定 + 渲染工具，业务层不必感知这些差异。
 */
export function isImageIcon(value?: string | null): boolean {
  if (!value) return false
  const v = value.trim()
  // 严格前缀：http(s):// 或 data:image/
  if (/^(https?:|data:image\/)/i.test(v)) return true
  // 容错：碰到过 c.icon 被存成裸 base64（'iVBORw0KGgo...'）或带有前导引号 / 零宽字符
  // 的情况；这种值不该当作纯文本 emoji 渲染（会喷一长串字符），按 image 处理 +
  // 兜底拼回 data:image/png;base64, 让 <img> 能尝试加载，加载失败 onError 隐藏。
  if (/^[a-z0-9+/=]{32,}$/i.test(v)) return true
  return false
}

/**
 * 把 isImageIcon 视为 image 但缺前缀的"裸 base64" 值修正回完整 data URL，
 * 让 <img src> 能正常加载。已经是 http(s)/data:image 前缀的值不动。
 */
function normalizeImageSrc(value: string): string {
  const v = value.trim()
  if (/^(https?:|data:image\/)/i.test(v)) return v
  if (/^[a-z0-9+/=]{32,}$/i.test(v)) return `data:image/png;base64,${v}`
  return v
}

interface IconViewProps {
  /** 图标值。空值 → 使用 fallback */
  value?: string
  /** 当 value 为空时显示的 emoji 占位（如 '📁'） */
  fallback?: string
  /** 渲染为 emoji 时的字号控制（tailwind 类） */
  emojiClassName?: string
  /** 渲染为图片时的尺寸控制（tailwind 类） */
  imgClassName?: string
  /** 容器额外样式 */
  className?: string
  /** title 提示 */
  title?: string
  /**
   * 是否给图标加一层圆角浅底框，统一 emoji 和图片图标的视觉语言。
   * 在暖色背景上 emoji 对比度低，加底框能显著改善可读性，并和带方框的
   * 自定义图片图标视觉权重一致。默认 false，不破坏老调用方。
   */
  boxed?: boolean
  /** boxed=true 时的容器尺寸/额外样式，由调用方按字号选择（如 'w-5 h-5'） */
  boxClassName?: string
}

/**
 * 通用图标渲染：根据值类型自动切换 <img/> 或文本。
 * 业务层只关心存什么，不需要管渲染分支。
 */
export function IconView({
  value,
  fallback = '📁',
  emojiClassName = 'text-base leading-none',
  imgClassName = 'w-5 h-5 rounded-sm object-contain',
  className,
  title,
  boxed = false,
  boxClassName,
}: IconViewProps) {
  const v = value?.trim()
  const isImg = isImageIcon(v)

  if (boxed) {
    return (
      <span
        title={title}
        className={cn(
          'inline-flex items-center justify-center rounded-md shrink-0',
          'bg-white/60 dark:bg-slate-700/50',
          'ring-1 ring-black/5 dark:ring-white/5',
          boxClassName,
          className,
        )}
      >
        {isImg ? (
          <img
            src={normalizeImageSrc(v!)}
            alt=""
            className={cn(imgClassName)}
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
            }}
          />
        ) : (
          <span className={cn(emojiClassName)}>{v || fallback}</span>
        )}
      </span>
    )
  }

  if (isImg) {
    return (
      <img
        src={normalizeImageSrc(v!)}
        alt=""
        title={title}
        className={cn(imgClassName, className)}
        onError={(e) => {
          ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
        }}
      />
    )
  }
  return (
    <span title={title} className={cn(emojiClassName, className)}>
      {v || fallback}
    </span>
  )
}

/**
 * 常用 emoji 候选（按场景大致分组）。
 * 控制在 ~60 个，覆盖常见使用场景，又不至于让选择面板溢出。
 */
export const COMMON_EMOJIS: string[] = [
  // 文件夹/分类基础
  '📁', '📂', '🗂️', '🗃️', '📋', '📝', '📄', '📑',
  // 收藏 / 标记
  '⭐', '🌟', '🔖', '🏷️', '❤️', '🔥', '💎', '👑',
  // 工作 / 学习
  '💼', '💻', '⌨️', '🖥️', '🖱️', '📊', '📈', '📉',
  '📚', '🎓', '🔬', '🧪', '✏️', '🖊️', '📐', '🧮',
  // 创意 / 设计
  '🎨', '🖌️', '🖼️', '🎬', '🎥', '📷', '🎵', '🎮',
  // 工具 / 配置
  '🛠️', '⚙️', '🔧', '🔨', '🧰', '🔌', '💡', '🔋',
  // 网络 / 通讯
  '🌐', '📧', '💬', '📞', '📱', '🔔', '📡', '☁️',
  // 生活 / 其他
  '🍔', '🛒', '✈️', '🏠', '🚀', '🎁', '🌈', '✅',
]
