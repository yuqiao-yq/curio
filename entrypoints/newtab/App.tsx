import { Suspense, lazy, useEffect } from 'react'
import { browser } from 'wxt/browser'
import { useBookmarkStore } from '../../src/stores/useBookmarkStore'
import {
  bootstrapSync,
  handleSettingsRemoteChange,
  handleBookmarksRemoteChange,
  KEY_SETTINGS_PAYLOAD,
  KEY_BM_MANIFEST,
  type SettingsPayload,
  type BookmarksManifest,
} from '../../src/services/SyncService'
import { CategorySidebar } from '../../src/components/CategorySidebar'
import { BookmarkGrid } from '../../src/components/BookmarkGrid'
import { Breadcrumb } from '../../src/components/Breadcrumb'
import { Topbar } from '../../src/components/Topbar'
import { ToastContainer } from '../../src/components/ToastContainer'
import { DialogHost } from '../../src/components/Dialog'
import { toast } from '../../src/stores/useToastStore'
import { AIFAB } from '../../src/components/ai/AIFAB'
import { useAIPanelStore } from '../../src/ai/panel/usePanelStore'
import { useSecondaryPanelsStore } from '../../src/ai/panel/useSecondaryPanelsStore'
import { useAISettingsStore } from '../../src/ai/useAISettingsStore'
import { usePassiveSuggest } from '../../src/ai/services/usePassiveSuggest'
import { useOrganizeStore } from '../../src/ai/services/useOrganizeStore'
import { usePageIndex } from '../../src/ai/services/usePageIndex'
import { Onboarding, useOnboardingStore } from '../../src/components/Onboarding'
import { useExternalLinkDrop } from '../../src/components/useExternalLinkDrop'
import { runLegacyMigrationOnce } from '../../src/services/legacyMigration'

/**
 * v0.21.x：AI 浮窗与副浮窗按需加载。
 * - 大头是 AIPanel 内部的 Chat/Settings/Labels/Organize 等 tab（合计 ~5k LOC）+
 *   embedder/crawler/tagger/quality 等 service；这些首屏完全用不上
 * - AIFAB 还是 eager，作为唯一入口必须立刻可见
 * - 副浮窗只有用户曾把 tab 拽出主面板才显示，更适合 lazy
 * - usePanelStore 仍 eager：Cmd+J 全局快捷键与 FAB 的 open/toggle 都从这里来
 */
const AIPanel = lazy(() =>
  import('../../src/components/ai/AIPanel').then((m) => ({ default: m.AIPanel })),
)
const SecondaryPanelsHost = lazy(() =>
  import('../../src/components/ai/SecondaryPanelsHost').then((m) => ({
    default: m.SecondaryPanelsHost,
  })),
)

export default function App() {
  const init = useBookmarkStore((s) => s.init)
  const initialized = useBookmarkStore((s) => s.initialized)
  const loading = useBookmarkStore((s) => s.loading)
  const categories = useBookmarkStore((s) => s.categories)
  const activeCategoryId = useBookmarkStore((s) => s.activeCategoryId)
  const importFromBrowser = useBookmarkStore((s) => s.importFromBrowser)
  const addCategory = useBookmarkStore((s) => s.addCategory)
  const theme = useBookmarkStore((s) => s.settings.theme)
  const wallpaper = useBookmarkStore((s) => s.settings.wallpaper)
  const fontColor = useBookmarkStore((s) => s.settings.fontColor)
  const backgroundBlur = useBookmarkStore((s) => s.settings.backgroundBlur)
  const cardGlass = useBookmarkStore((s) => s.settings.cardGlass)

  // ─── AI 浮窗：启动时恢复持久化状态、注册全局快捷键、监听视口变化 ─
  const initPanel = useAIPanelStore((s) => s.init)
  const togglePanel = useAIPanelStore((s) => s.toggle)
  const openPanel = useAIPanelStore((s) => s.open)
  const clampPanelToViewport = useAIPanelStore((s) => s.clampToViewport)
  const initAISettings = useAISettingsStore((s) => s.init)
  const initSecondaryPanels = useSecondaryPanelsStore((s) => s.init)
  const setOrganizeRange = useOrganizeStore((s) => s.setRange)
  const refreshPageIndex = usePageIndex((s) => s.refresh)
  // 用 visible/secondaryCount 作为 lazy 加载的门，只有用户真正打开过浮窗
  // 才去拉 AIPanel chunk；上次会话留下的 visible=true 也能恢复显示
  const panelVisible = useAIPanelStore((s) => s.visible)
  const secondaryCount = useSecondaryPanelsStore((s) => s.panels.length)

  // 被动建议（§5.2）：FAB 红点 + 浮窗自动落到整理 Tab
  const { shouldShow: hasPassiveHint, dismiss: dismissPassive } =
    usePassiveSuggest()

  // ─── 首次进入引导（v0.22.x）─────────────────────────
  // - init() 从 chrome.storage.local 恢复已完成的引导标记
  // - hydrated + 未引导过 → startMainTour() 自动启动 L1 5 步 Spotlight
  // - L1.5 渐进式提示由 <Onboarding /> 自己监听数据触发
  const initOnboarding = useOnboardingStore((s) => s.init)
  const onboardingHydrated = useOnboardingStore((s) => s.hydrated)
  const mainTourDone = useOnboardingStore((s) => s.mainTourDone)
  const startMainTour = useOnboardingStore((s) => s.startMainTour)

  useEffect(() => {
    // 一次性数据迁移（tabit → curio 命名空间）必须在任何 store init 之前完成，
    // 否则 init 会读到空数据并触发"老用户首次进入"的引导，造成误导。
    // background.ts 也会在 service worker 启动时调一次；这里做防御性兜底。
    void (async () => {
      try {
        await runLegacyMigrationOnce()
      } catch {
        // 迁移失败不阻塞 UI 启动；下次进入会再次尝试
      }
      void init()
      void initPanel()
      void initAISettings()
      // §7.3 副浮窗状态恢复
      void initSecondaryPanels()
      // 启动时拉一次「已抓取的 bookmarkId」集合，给卡片角标用（§6.1）
      void refreshPageIndex()
      // v0.22.x 首次引导：先 init 恢复标记，下面的 useEffect 据此决定要不要启动
      void initOnboarding()
    })()
  }, [
    init,
    initPanel,
    initAISettings,
    initSecondaryPanels,
    refreshPageIndex,
    initOnboarding,
  ])

  // 引导启动决策：等三件事都到位
  //   1. onboardingHydrated：持久化标记已恢复（避免覆盖老用户的"已引导"状态）
  //   2. initialized：书签 store 已加载完，UI 锚点（Topbar / Sidebar）就绪
  //   3. !mainTourDone：用户还没走过 / 没跳过引导
  useEffect(() => {
    if (!onboardingHydrated || !initialized || mainTourDone) return
    // 延迟 400ms 让首屏过渡动画走完，避免 spotlight 高亮还在抖
    const t = setTimeout(() => startMainTour(), 400)
    return () => clearTimeout(t)
  }, [onboardingHydrated, initialized, mainTourDone, startMainTour])

  // Cmd/Ctrl + J 全局快捷键唤起 / 隐藏浮窗（与 Notion AI 对齐）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes('mac')
      const cmd = isMac ? e.metaKey : e.ctrlKey
      if (cmd && (e.key === 'j' || e.key === 'J')) {
        // 输入框聚焦时不抢，避免影响搜索
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea') return
        // 首次引导进行中：拦截 ⌘J 防止唤起浮窗导致 AIFAB 锚点丢失
        // （AIFAB 在 visible=true 时返回 null，Tour 第 5 步会找不到锚点）
        if (useOnboardingStore.getState().tourActive) return
        e.preventDefault()
        togglePanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePanel])

  // 视口变化时把浮窗吸附回来，避免"看不到"
  useEffect(() => {
    const onResize = () => clampPanelToViewport()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [clampPanelToViewport])

  // ─── V1.5：跨设备同步（chrome.storage.sync） ──────
  // - 初始化完成后跑一次 bootstrap：两条管线（settings + bookmarks）独立拉齐
  // - 同时挂 storage.onChanged 监听，远端变更时实时应用到本机
  //   （各自带自回声防抖；本机刚推的 ts <= lastPushTs 会被忽略）
  useEffect(() => {
    if (!initialized) return
    const storageApi = browser?.storage as {
      sync?: unknown
      onChanged?: { addListener: (cb: (...args: unknown[]) => void) => void; removeListener: (cb: (...args: unknown[]) => void) => void }
    } | undefined
    let cancelled = false
    // 1) bootstrap：把远端 / 本机的差异在启动时拉齐（settings + bookmarks）
    void (async () => {
      const s = useBookmarkStore.getState()
      const r = await bootstrapSync(s.settings, s.categories, s.cards)
      if (cancelled) return
      if (r.appliedSettings && Object.keys(r.appliedSettings).length > 0) {
        await useBookmarkStore.getState().applyRemoteSettings(r.appliedSettings)
      }
      if (r.appliedBookmarks) {
        await useBookmarkStore.getState().applyRemoteBookmarks(r.appliedBookmarks)
      }
      // 引导期错误不阻断启动；用日志暴露给开发者，UI 会从 meta.lastError 拿到
      if (r.warnings && r.warnings.length > 0) {
        console.warn('[sync] bootstrap warnings:', r.warnings)
      }
    })()

    // 2) onChanged 监听：两条远端键都要看
    if (!storageApi?.onChanged) return
    const listener = (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, areaName: string) => {
      if (areaName !== 'sync') return
      // settings payload 变更
      const chSettings = changes[KEY_SETTINGS_PAYLOAD]
      if (chSettings) {
        void (async () => {
          const payload = (chSettings.newValue ?? null) as SettingsPayload | null
          const { applied } = await handleSettingsRemoteChange(payload)
          if (applied && Object.keys(applied).length > 0) {
            await useBookmarkStore.getState().applyRemoteSettings(applied)
          }
        })()
      }
      // bookmarks manifest 变更 → 触发整包重拉
      // 只看 manifest 即可：所有 chunk + manifest 是同 set 写入的原子提交
      const chManifest = changes[KEY_BM_MANIFEST]
      if (chManifest) {
        void (async () => {
          const manifest = (chManifest.newValue ?? null) as BookmarksManifest | null
          const { payload } = await handleBookmarksRemoteChange(manifest)
          if (payload) {
            await useBookmarkStore.getState().applyRemoteBookmarks(payload)
          }
        })()
      }
    }
    storageApi.onChanged.addListener(listener as never)
    return () => {
      cancelled = true
      storageApi.onChanged?.removeListener(listener as never)
    }
  }, [initialized])

  // ─── 主题（明亮 / 黑暗 / 跟随系统） ────────────────
  // Tailwind darkMode='class' → 通过 html.dark 控制
  useEffect(() => {
    const root = document.documentElement
    const apply = (isDark: boolean) => root.classList.toggle('dark', isDark)
    if (theme === 'dark') {
      apply(true)
      return
    }
    if (theme === 'light') {
      apply(false)
      return
    }
    // auto：监听系统配色
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    apply(mq.matches)
    const onChange = (e: MediaQueryListEvent) => apply(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  // ─── 自定义背景 ────────────────────────────────
  // 约定 wallpaper 字段语义：
  //   - 空 / undefined        → 清除自定义背景，回退到 global.css 的渐变
  //   - linear/radial/conic-  → 渐变，写 background-image
  //   - "#rrggbb" / "#rgb"    → 纯色，写 background-color（注意：
  //                              不能写 url("#xxx")，浏览器会忽略，这是历史 bug）
  //   - 其他（http/https/data:）→ 当图片 URL，写 background-image: url(...)
  useEffect(() => {
    const body = document.body
    // 每次切换都先 reset 上一轮可能残留的属性，避免「图片 → 纯色」时图片仍在
    body.style.backgroundImage = ''
    body.style.backgroundSize = ''
    body.style.backgroundPosition = ''
    body.style.backgroundAttachment = ''
    body.style.backgroundColor = ''
    if (!wallpaper) return

    const isGradient = /^(linear|radial|conic)-gradient\(/.test(wallpaper)
    const isHex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(wallpaper.trim())

    if (isGradient) {
      body.style.backgroundImage = wallpaper
      body.style.backgroundSize = 'cover'
      body.style.backgroundPosition = 'center'
      body.style.backgroundAttachment = 'fixed'
    } else if (isHex) {
      body.style.backgroundColor = wallpaper
    } else {
      body.style.backgroundImage = `url("${wallpaper}")`
      body.style.backgroundSize = 'cover'
      body.style.backgroundPosition = 'center'
      body.style.backgroundAttachment = 'fixed'
    }
  }, [wallpaper])

  // ─── 自定义文字颜色 ─────────────────────────────
  // 约定 fontColor 字段语义：
  //   - 空 / undefined → 清除自定义颜色，回退到 global.css 的默认
  //                      （亮色：text-slate-900；暗色：text-slate-100）
  //   - 任意有效 CSS 颜色（建议 hex）→ 写到 body 的 inline style
  // 注意：只影响"未显式设置颜色"的文字（如卡片标题）；
  // 显式带 text-slate-400 等类的辅助文字、按钮品牌色等不会被波及，这是预期行为。
  useEffect(() => {
    document.body.style.color = fontColor || ''
  }, [fontColor])

  // ─── 书签卡片毛玻璃开关 ───────────────────────────
  // 默认（cardGlass === undefined / true）保留毛玻璃；显式关闭时给 body
  // 加 .curio-cards-solid，由 global.css 的级联选择器把所有 .card 切到实色。
  // 单一 class 控制，所有用 .card 的派生节点（书签 / 文件夹 / 历史 / + 占位 / DragPreview）
  // 同步生效，不需要逐个组件传 prop。
  useEffect(() => {
    const off = cardGlass === false
    document.body.classList.toggle('curio-cards-solid', off)
    return () => {
      // 组件卸载时清理，避免遗留 class
      document.body.classList.remove('curio-cards-solid')
    }
  }, [cardGlass])

  // 顶层分类数量（侧栏只显示顶层）
  const topLevelCount = categories.filter((c) => !c.parentId).length

  // 背景毛玻璃：仅在 backgroundBlur > 0 时渲染覆盖层。
  // - fixed 全屏 + pointer-events-none 不挡交互
  // - 渲染在主内容 DOM 之前（同层），主内容默认 paint 在它之上，
  //   覆盖层的 backdrop-filter 作用对象是它"背后"的 body 背景层
  const blurPx =
    typeof backgroundBlur === 'number' && backgroundBlur > 0
      ? Math.min(64, Math.max(0, backgroundBlur))
      : 0

  // ─── 外部链接拖入快速添加（v0.22.x）─────────────
  // 监听挂在主区 <main> 上；与 dnd-kit 内部拖拽通过 DataTransfer.types 区分
  const {
    hoveredCategoryId: dropHoverCatId,
    onDragOver: onLinkDragOver,
    onDragLeave: onLinkDragLeave,
    onDrop: onLinkDrop,
  } = useExternalLinkDrop()
  const dropHoverCat = dropHoverCatId
    ? categories.find((c) => c.id === dropHoverCatId)
    : null

  return (
    <div className="h-full w-full flex flex-col">
      {blurPx > 0 && (
        <div
          aria-hidden
          className="fixed inset-0 pointer-events-none"
          style={{
            backdropFilter: `blur(${blurPx}px)`,
            WebkitBackdropFilter: `blur(${blurPx}px)`,
            // 用 -1 把覆盖层挤到内容下面、body 背景之上
            zIndex: -1,
          }}
        />
      )}
      <ToastContainer />
      {/* 全局 confirm/prompt 替代浏览器原生弹窗（v0.20.1+） */}
      <DialogHost />
      {/* v0.22.x 首次进入引导：L1 主 Tour + L1.5 渐进式提示。
          内部自己读 onboardingStore 决定是否渲染，无需外层条件 */}
      <Onboarding />
      {/* AI 浮窗与 FAB 两者互斥：浮窗显示时 FAB 隐藏（在 AIFAB 内部判断） */}
      <AIFAB
        hasNew={hasPassiveHint}
        onSuggestClick={() => {
          // 被动建议：预填整理范围为「未分类项」，自动打开整理 Tab
          setOrganizeRange({ type: 'uncategorized' })
          openPanel('organize')
          // 进入即视为"提示已被看到"，重置 baseline 进入下一轮冷静期
          void dismissPassive()
        }}
      />
      {/* v0.21.x：只有真正打开过浮窗才挂载（懒加载 chunk）。
          AIPanel 内部 visible=false 时本来就 return null，
          这里再用 panelVisible 做闸门，避免 Suspense 提前拉 chunk。 */}
      {panelVisible && (
        <Suspense fallback={null}>
          <AIPanel />
        </Suspense>
      )}
      {/* §7.3 副浮窗：仅在用户曾把 tab 拽出主面板时才有内容；
          同样 lazy，避免没人用副浮窗的 100% 用户付出 bundle 成本 */}
      {secondaryCount > 0 && (
        <Suspense fallback={null}>
          <SecondaryPanelsHost />
        </Suspense>
      )}
      <Topbar />
      <div className="flex-1 flex min-h-0">
        <CategorySidebar />
        <main
          className="relative flex-1 overflow-y-auto p-6"
          onDragOver={onLinkDragOver}
          onDragLeave={onLinkDragLeave}
          onDrop={onLinkDrop}
        >
          {/* 外部链接拖入的视觉提示层：仅在 hover 有效目标时显示
              - pointer-events-none 让用户的鼠标继续穿透到下层 onDragOver
              - 高 z-index 但低于 toast / dialog，确保引导期间不打架 */}
          {dropHoverCat && (
            <div
              aria-hidden
              className="absolute inset-3 pointer-events-none z-[9000] rounded-2xl flex items-center justify-center"
              style={{
                boxShadow: 'inset 0 0 0 2px rgba(99, 102, 241, 0.55)',
                background: 'rgba(99, 102, 241, 0.06)',
              }}
            >
              <div className="px-4 py-2.5 rounded-full bg-white/95 dark:bg-slate-800/95 shadow-xl shadow-brand/20 text-sm font-medium text-brand backdrop-blur">
                松开添加到「{dropHoverCat.name}」
              </div>
            </div>
          )}
          {!initialized ? (
            <div className="text-center py-20 text-slate-400">加载中…</div>
          ) : topLevelCount === 0 ? (
            <EmptyState
              loading={loading}
              onImport={async () => {
                // 复用 Topbar 同款 toast 反馈，避免空状态首次导入静悄悄
                try {
                  const r = await importFromBrowser()
                  const total = r.categoriesAdded + r.cardsAdded + r.cardsSkipped
                  if (total === 0) {
                    toast.info('未发现书签', '当前浏览器中没有可以导入的书签')
                  } else if (r.categoriesAdded === 0 && r.cardsAdded === 0) {
                    toast.info(
                      '没有新增内容',
                      `检测到 ${r.cardsSkipped} 个书签均已存在`,
                    )
                  } else {
                    const dedup =
                      r.cardsSkipped > 0
                        ? `\n（已跳过重复 ${r.cardsSkipped} 个）`
                        : ''
                    toast.success(
                      '已从浏览器导入',
                      `新增 ${r.categoriesAdded} 分类、${r.cardsAdded} 书签${dedup}`,
                    )
                  }
                } catch (err) {
                  console.error(err)
                  toast.error(
                    '从浏览器导入失败',
                    err instanceof Error
                      ? err.message
                      : '未知错误（请确认已授权 bookmarks 权限）',
                  )
                }
              }}
              onCreate={() => addCategory('我的收藏', '⭐')}
            />
          ) : !activeCategoryId ? (
            <div className="text-center py-20 text-slate-400">
              ← 从左侧选择一个分类
            </div>
          ) : (
            <>
              <Breadcrumb />
              <BookmarkGrid />
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function EmptyState({
  loading,
  onImport,
  onCreate,
}: {
  loading: boolean
  onImport: () => void | Promise<void>
  onCreate: () => void
}) {
  return (
    <div className="max-w-md mx-auto mt-20 text-center space-y-6">
      <div className="text-6xl">🗂️</div>
      <h2 className="text-2xl font-semibold">欢迎使用 Curio</h2>
      <p className="text-slate-500">选择一种方式开始整理你的书签</p>
      <div className="flex flex-col gap-3">
        <button onClick={onImport} disabled={loading} className="btn-primary py-3">
          {loading ? '导入中…' : '从浏览器一键导入书签'}
        </button>
        <button onClick={onCreate} className="btn-ghost py-3 border border-slate-200 dark:border-slate-700">
          创建空白分类
        </button>
      </div>
    </div>
  )
}
