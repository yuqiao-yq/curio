import { useEffect, useRef, useState } from 'react'
import type { UserSettings } from '../../../types/bookmark'
import { SIDEBAR_WIDTH_DEFAULT } from '../../../types/bookmark'
import { clampSidebarWidth } from '../utils'

/* ──────────────────────────────────────────────────────────────────────
 * 侧栏宽度拖拽。
 *
 * ⚠ 时序坑（已修复）：
 *   App 首次 mount 时 store.init() 还没完成，savedSidebarWidth = undefined，
 *   这时如果用 useEffect([resizing]) 自动持久化会立即把 240 默认值写入 storage，
 *   覆盖之前真实保存的宽度。
 *   修复：拖拽 / 双击 这两个用户行为里**显式调用** updateSettings，
 *   不再依赖 useEffect 的隐式触发。useRef 用来在 pointerup 闭包里拿到最新宽度。
 * ────────────────────────────────────────────────────────────────────── */

export function useSidebarWidth(
  savedSidebarWidth: number | undefined,
  collapsed: boolean,
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>,
) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
    clampSidebarWidth(savedSidebarWidth ?? SIDEBAR_WIDTH_DEFAULT),
  )
  const sidebarWidthRef = useRef(sidebarWidth)
  sidebarWidthRef.current = sidebarWidth
  // 是否正在拖拽 → 拖拽中关闭 width 过渡，否则会跟手抖动
  const [resizing, setResizing] = useState(false)

  // settings.sidebarWidth 异步加载完成后回填一次（首次 init 时本地 state 拿到的是默认值）。
  // 注意：拖拽过程中不要被外部回填覆盖。
  useEffect(() => {
    if (resizing) return
    if (typeof savedSidebarWidth !== 'number') return
    const next = clampSidebarWidth(savedSidebarWidth)
    if (next !== sidebarWidthRef.current) {
      setSidebarWidth(next)
    }
  }, [savedSidebarWidth, resizing])

  // 全局监听 pointermove/up：避免拖到侧栏外面失焦后无法继续拖
  useEffect(() => {
    if (!resizing) return
    const onMove = (e: PointerEvent) => {
      // viewport 左边到指针的距离 = 侧栏新宽度（侧栏紧贴页面左边缘）
      setSidebarWidth(clampSidebarWidth(e.clientX))
    }
    const onUp = () => {
      setResizing(false)
      // 松手即持久化：用 ref 拿最新宽度，避免闭包 stale
      if (!collapsed) {
        void updateSettings({ sidebarWidth: sidebarWidthRef.current })
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    // 拖拽期间禁用文本选中，否则鼠标会一路选中页面文字
    const prevUserSelect = document.body.style.userSelect
    const prevCursor = document.body.style.cursor
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.style.userSelect = prevUserSelect
      document.body.style.cursor = prevCursor
    }
  }, [resizing, collapsed, updateSettings])

  const handleResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    setResizing(true)
  }

  /** 双击调整柄 → 恢复默认宽度（与开发者工具的拖柄交互一致） */
  const handleResizeReset = () => {
    setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)
    if (!collapsed) void updateSettings({ sidebarWidth: SIDEBAR_WIDTH_DEFAULT })
  }

  return {
    sidebarWidth,
    resizing,
    handleResizeStart,
    handleResizeReset,
  }
}
