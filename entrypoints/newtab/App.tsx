import { useEffect } from 'react'
import { useBookmarkStore } from '../../src/stores/useBookmarkStore'
import { CategorySidebar } from '../../src/components/CategorySidebar'
import { BookmarkGrid } from '../../src/components/BookmarkGrid'
import { Breadcrumb } from '../../src/components/Breadcrumb'
import { Topbar } from '../../src/components/Topbar'
import { ToastContainer } from '../../src/components/ToastContainer'
import { DialogHost } from '../../src/components/Dialog'
import { toast } from '../../src/stores/useToastStore'
import { AIFAB } from '../../src/components/ai/AIFAB'
import { AIPanel } from '../../src/components/ai/AIPanel'
import { SecondaryPanelsHost } from '../../src/components/ai/SecondaryPanelsHost'
import { useAIPanelStore } from '../../src/ai/panel/usePanelStore'
import { useSecondaryPanelsStore } from '../../src/ai/panel/useSecondaryPanelsStore'
import { useAISettingsStore } from '../../src/ai/useAISettingsStore'
import { usePassiveSuggest } from '../../src/ai/services/usePassiveSuggest'
import { useOrganizeStore } from '../../src/ai/services/useOrganizeStore'
import { usePageIndex } from '../../src/ai/services/usePageIndex'

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

  // 被动建议（§5.2）：FAB 红点 + 浮窗自动落到整理 Tab
  const { shouldShow: hasPassiveHint, dismiss: dismissPassive } =
    usePassiveSuggest()

  useEffect(() => {
    void init()
    void initPanel()
    void initAISettings()
    // §7.3 副浮窗状态恢复
    void initSecondaryPanels()
    // 启动时拉一次「已抓取的 bookmarkId」集合，给卡片角标用（§6.1）
    void refreshPageIndex()
  }, [init, initPanel, initAISettings, initSecondaryPanels, refreshPageIndex])

  // Cmd/Ctrl + J 全局快捷键唤起 / 隐藏浮窗（与 Notion AI 对齐）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes('mac')
      const cmd = isMac ? e.metaKey : e.ctrlKey
      if (cmd && (e.key === 'j' || e.key === 'J')) {
        // 输入框聚焦时不抢，避免影响搜索
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
        if (tag === 'input' || tag === 'textarea') return
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
  // 加 .tabit-cards-solid，由 global.css 的级联选择器把所有 .card 切到实色。
  // 单一 class 控制，所有用 .card 的派生节点（书签 / 文件夹 / 历史 / + 占位 / DragPreview）
  // 同步生效，不需要逐个组件传 prop。
  useEffect(() => {
    const off = cardGlass === false
    document.body.classList.toggle('tabit-cards-solid', off)
    return () => {
      // 组件卸载时清理，避免遗留 class
      document.body.classList.remove('tabit-cards-solid')
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
      <AIPanel />
      {/* §7.3 副浮窗：分离出来的 tab 各自渲染为独立浮窗 */}
      <SecondaryPanelsHost />
      <Topbar />
      <div className="flex-1 flex min-h-0">
        <CategorySidebar />
        <main className="flex-1 overflow-y-auto p-6">
          {!initialized ? (
            <div className="text-center py-20 text-slate-400">加载中...</div>
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
      <h2 className="text-2xl font-semibold">欢迎使用 Tab It</h2>
      <p className="text-slate-500">选择一种方式开始整理你的书签</p>
      <div className="flex flex-col gap-3">
        <button onClick={onImport} disabled={loading} className="btn-primary py-3">
          {loading ? '导入中...' : '从浏览器一键导入书签'}
        </button>
        <button onClick={onCreate} className="btn-ghost py-3 border border-slate-200 dark:border-slate-700">
          创建空白分类
        </button>
      </div>
    </div>
  )
}
