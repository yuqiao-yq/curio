import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAIPanelStore } from '../../ai/panel/usePanelStore'
import { useDraggable } from '../../ai/panel/useDraggable'
import { useResizable } from '../../ai/panel/useResizable'
import { useShallow } from 'zustand/react/shallow'
import {
  PANEL_DEFAULT_SIZE,
  defaultPanelPosition,
  type AITabType,
  type PanelPosition,
  type PanelSize,
} from '../../ai/types'
import { useAISettingsStore, useIsAIConfigured } from '../../ai/useAISettingsStore'
import { WindowAIProvider } from '../../ai/providers/window-ai'
import { cn } from '../../utils/cn'
import { AIPanelHeader } from './AIPanelHeader'
import { AIPanelTabs } from './AIPanelTabs'
import { AIPanelMinimized } from './AIPanelMinimized'
import { ChatTab } from './tabs/ChatTab'
import { OrganizeTab } from './tabs/OrganizeTab'
import { LabelsTab } from './tabs/LabelsTab'
import { SettingsTab } from './tabs/SettingsTab'

/**
 * AI 浮窗主容器。
 *
 * 三种渲染态：
 * 1. 不可见（visible=false）            → 返回 null
 * 2. 最小化（visible=true, minimized）  → 渲染 AIPanelMinimized
 * 3. 展开 / 最大化                     → 渲染完整浮窗
 *
 * 通过 React Portal 挂到 document.body，避免被祖先 overflow / transform
 * 创建的 stacking context 困住。
 */
export function AIPanel() {
  const visible = useAIPanelStore((s) => s.visible)
  const minimized = useAIPanelStore((s) => s.minimized)
  const maximized = useAIPanelStore((s) => s.maximized)
  const position = useAIPanelStore((s) => s.position)
  const size = useAIPanelStore((s) => s.size)
  const tabs = useAIPanelStore((s) => s.tabs)
  const activeTabId = useAIPanelStore((s) => s.activeTabId)
  const setPosition = useAIPanelStore((s) => s.setPosition)
  const setSize = useAIPanelStore((s) => s.setSize)
  const toggleMaximize = useAIPanelStore((s) => s.toggleMaximize)

  // 视口默认值（仅在 SSR 兜底用，client 侧 init 时已 clamp 过）
  const fallbackPos = useMemo<PanelPosition>(
    () =>
      typeof window !== 'undefined'
        ? defaultPanelPosition({
            width: window.innerWidth,
            height: window.innerHeight,
          })
        : { x: 200, y: 100 },
    [],
  )
  const effectivePos = position ?? fallbackPos
  const effectiveSize: PanelSize = size ?? PANEL_DEFAULT_SIZE

  // 拖动 + 缩放 hooks（仅在非最大化时启用）
  const { onPointerDown: onDragPointerDown } = useDraggable({
    position: effectivePos,
    size: effectiveSize,
    onChange: setPosition,
    disabled: maximized,
  })
  const { onPointerDown: onResizePointerDown } = useResizable({
    size: effectiveSize,
    onChange: setSize,
    disabled: maximized,
  })

  // ESC 不关闭浮窗（与 modal 区分）；点击外部也不关闭，确保"持续存在"
  useEffect(() => {
    // 这里不做任何 outside-click / escape 处理，是有意为之
  }, [])

  if (typeof document === 'undefined') return null
  if (!visible) return null

  // 最小化态
  if (minimized) {
    return createPortal(<AIPanelMinimized />, document.body)
  }

  const activeTab = tabs.find((t) => t.id === activeTabId)

  // 最大化时居中 + 半透明遮罩
  const maxStyle: React.CSSProperties = maximized
    ? {
        position: 'fixed',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(70vw, 1200px)',
        height: '80vh',
      }
    : {
        position: 'fixed',
        left: 0,
        top: 0,
        transform: `translate3d(${effectivePos.x}px, ${effectivePos.y}px, 0)`,
        width: effectiveSize.width,
        height: effectiveSize.height,
      }

  const panelEl = (
    <>
      {/* 最大化时的半透明背景遮罩；点击遮罩 → 退出最大化 */}
      {maximized && (
        <div
          className="fixed inset-0 z-[10090] bg-black/30"
          onClick={() => toggleMaximize()}
          aria-hidden
        />
      )}
      <div
        style={{ ...maxStyle, willChange: 'transform' }}
        className={cn(
          'z-[10100] flex flex-col',
          'rounded-lg overflow-hidden',
          'bg-white dark:bg-slate-900',
          'border border-slate-200 dark:border-slate-700',
          'shadow-2xl',
          // 让浮窗内的 input 等控件聚焦时不会有外层 scroll
        )}
        role="dialog"
        aria-label="AI 助手"
      >
        <AIPanelHeader onDragPointerDown={onDragPointerDown} />
        <AIPanelTabs />

        {/* 内容区（每个 tab 自己实现） */}
        <div
          data-no-drag
          className="flex-1 min-h-0 overflow-auto bg-white dark:bg-slate-900"
        >
          {activeTab ? (
            <TabContent type={activeTab.type} tabId={activeTab.id} />
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-400">
              点击上方 + 新建一个标签
            </div>
          )}
        </div>

        {/* Footer：Provider 状态 + Local/Cloud 徽标（§5.3）+ resize 手柄 */}
        <div
          data-no-drag
          className={cn(
            'flex items-center gap-2 px-3 h-7 shrink-0',
            'border-t border-slate-200 dark:border-slate-700',
            'bg-slate-50/60 dark:bg-slate-800/40',
            'text-[11px] text-slate-400',
          )}
        >
          <FooterStatus />
          <div className="flex-1" />
          {/* Resize 手柄触发区：右下角 */}
          {!maximized && (
            <span
              onPointerDown={onResizePointerDown('se')}
              className="cursor-nwse-resize text-slate-400 hover:text-brand select-none"
              title="拖动调整尺寸"
              aria-label="调整尺寸"
            >
              ⌟
            </span>
          )}
        </div>

        {/* 边缘 resize 手柄（隐形热区）：仅非最大化态可用 */}
        {!maximized && (
          <>
            {/* 右边缘 */}
            <div
              onPointerDown={onResizePointerDown('e')}
              className="absolute top-0 right-0 w-1.5 h-full cursor-ew-resize"
              style={{ touchAction: 'none' }}
              aria-hidden
            />
            {/* 下边缘 */}
            <div
              onPointerDown={onResizePointerDown('s')}
              className="absolute bottom-0 left-0 w-full h-1.5 cursor-ns-resize"
              style={{ touchAction: 'none' }}
              aria-hidden
            />
          </>
        )}
      </div>
    </>
  )

  return createPortal(panelEl, document.body)
}

// ─── Tab 内容路由 ─────────────────────────────────────

function TabContent({ type, tabId }: { type: AITabType; tabId: string }) {
  switch (type) {
    case 'chat':
      return <ChatTab tabId={tabId} />
    case 'organize':
      return <OrganizeTab />
    case 'labels':
      return <LabelsTab />
    case 'settings':
      return <SettingsTab />
  }
}

/**
 * Footer 状态行（V1.5 §5.3）
 *
 * 三种态：
 * - 未配置 AI：灰色提示 + 引导
 * - preferLocal=true 且 window.ai 可用：✓ Local 徽标（绿色）
 * - preferLocal=true 但 window.ai 不可用：⚠ Local 徽标 + tooltip 解释（橙色）
 * - 其他：☁ Cloud 徽标（默认远程）
 *
 * window.ai 检测异步进行；仅 mount 时拉一次（不监听 visibility 变化，
 * 模型可用性在用户会话期间几乎不变）。
 */
function FooterStatus() {
  const configured = useIsAIConfigured()
  // 只订阅 footer 真正用到的三块：provider 列表、chat 路由、preferLocal 偏好
  const { providers, chatRoute, preferLocal } = useAISettingsStore(
    useShallow((s) => ({
      providers: s.providers,
      chatRoute: s.routing.chat,
      preferLocal: s.preferLocal,
    })),
  )
  const [windowAIReady, setWindowAIReady] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    void WindowAIProvider.isAvailable().then((ok) => {
      if (!cancelled) setWindowAIReady(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!configured) {
    return <span>未配置 AI · 在「⚙ 设置」中添加 Provider</span>
  }

  // 取当前 chat 任务真实指向的 provider 名（含 prefer-local 影响）
  const chatProviderName = (() => {
    if (preferLocal && windowAIReady) {
      const local = providers.find((p) => p.type === 'window-ai')
      if (local) return local.name
    }
    const id = chatRoute ?? providers[0]?.id
    return providers.find((p) => p.id === id)?.name ?? '(未指定)'
  })()

  if (preferLocal) {
    if (windowAIReady === null) {
      // 检测中
      return (
        <>
          <Badge tone="muted">⌛ 检测本地</Badge>
          <span className="truncate" title={chatProviderName}>
            {chatProviderName}
          </span>
        </>
      )
    }
    if (windowAIReady) {
      return (
        <>
          <Badge tone="ok">✓ Local</Badge>
          <span className="truncate" title="对话任务优先走 Chrome 内置 Gemini Nano">
            {chatProviderName}
          </span>
        </>
      )
    }
    return (
      <>
        <Badge tone="warn">⚠ Local 不可用</Badge>
        <span
          className="truncate"
          title="已开启「优先本地」但 Chrome 内置 AI 不可用，已自动回落到云端 Provider"
        >
          {chatProviderName}
        </span>
      </>
    )
  }

  return (
    <>
      <Badge tone="cloud">☁ Cloud</Badge>
      <span className="truncate" title={chatProviderName}>
        {chatProviderName}
      </span>
    </>
  )
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: 'ok' | 'warn' | 'cloud' | 'muted'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 h-4 rounded text-[10px] font-medium leading-none shrink-0',
        tone === 'ok'
          ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
          : tone === 'warn'
            ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300'
            : tone === 'cloud'
              ? 'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300'
              : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400',
      )}
    >
      {children}
    </span>
  )
}

