import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useBookmarkStore } from '../../stores/useBookmarkStore'
import { toast } from '../../stores/useToastStore'
import { getRepository } from '../../repositories'
import type { ExportData } from '../../types/bookmark'
import type { BulkImportMode } from '../../repositories/types'
import type {
  BrowserSyncRoot,
  ExportResult,
} from '../../services/bookmarkExporter'
import { cn } from '../../utils/cn'
import { WebSearchBox } from '../WebSearchBox'
import { CardMenu } from '../CardMenu'
import { HelpDialog } from '../HelpDialog'
import { confirmDialog } from '../Dialog'
// docs/USER_GUIDE.md 是用户文档的唯一来源，弹窗内容由它驱动
// （Vite 的 ?raw 后缀会把文件以纯字符串形式 import 进来）
import userGuideMd from '../../../docs/USER_GUIDE.md?raw'

import { DatabaseIcon, PaletteIcon, InfoIcon, HelpIcon, GearIcon, CompassIcon } from './icons'
import { useOnboardingStore } from '../Onboarding'
import { AboutDialog } from './AboutDialog'
import { DataDialog } from './DataDialog'
import { ExportToBrowserDialog } from './ExportToBrowserDialog'
import { StyleDialog } from './StyleDialog'
import { ImportDialog, type PendingImport } from './ImportDialog'

/**
 * Topbar 主 shell（v0.21.x 由原 1591 行单文件拆分）
 *
 * - icons.tsx                  4 个内置 svg icon
 * - DialogShell.tsx            共用居中弹层外壳（ESC / 遮罩关闭）
 * - AboutDialog.tsx            关于
 * - DataDialog.tsx             数据管理 4 项 + ActionItem
 * - ExportToBrowserDialog.tsx  同步到浏览器参数确认
 * - StyleDialog.tsx            主题 / 背景 / 文字色 / 内容布局（最大）
 * - ImportDialog.tsx           导入二次确认 + ModeOption
 *
 * 本 shell 只负责：搜索框 / 帮助按钮 / 齿轮气泡菜单 + 5 个弹窗的 portal 装配。
 */
export function Topbar() {
  const importFromBrowser = useBookmarkStore((s) => s.importFromBrowser)
  const exportToBrowser = useBookmarkStore((s) => s.exportToBrowser)
  const init = useBookmarkStore((s) => s.init)
  const settings = useBookmarkStore((s) => s.settings)
  const updateSettings = useBookmarkStore((s) => s.updateSettings)

  // 待确认的导入数据（弹层用）
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [mode, setMode] = useState<BulkImportMode>('merge')
  const [importing, setImporting] = useState(false)

  // 三类设置弹窗（互斥；从齿轮气泡菜单触发）
  const [dataDialogOpen, setDataDialogOpen] = useState(false)
  const [styleDialogOpen, setStyleDialogOpen] = useState(false)
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false)
  // 帮助文档弹窗（齿轮左侧的「?」按钮触发）
  const [helpDialogOpen, setHelpDialogOpen] = useState(false)
  // 同步到浏览器：确认弹窗 + 进度态
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  // v0.22.x：「重新引导」入口 —— 走完 / 跳过引导后想再看一次的兜底
  const resetOnboarding = useOnboardingStore((s) => s.resetAll)
  const startMainTour = useOnboardingStore((s) => s.startMainTour)
  const handleRestartTour = async () => {
    // 先 confirm 防误点：菜单这种轻量入口很容易手抖
    const ok = await confirmDialog({
      title: '重新走一遍引导？',
      message: '会重新弹出 5 步 Spotlight 教学，可随时跳过。',
      confirmText: '开始',
    })
    if (!ok) return
    // resetAll 把 mainTourDone 等持久化标记清掉，startMainTour 立刻拉起 L1 Tour
    // L1.5 hint 也跟着重置；但由于其 0→1 触发条件，已有数据的用户重置后
    // 不会再被 L1.5 打扰（这是符合预期的行为：只回放主 Tour）
    await resetOnboarding()
    startMainTour()
  }

  const handleExport = async () => {
    try {
      const data = await getRepository().bulkExport()
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tab-it-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      const cnt = (data.categories?.length ?? 0) + (data.cards?.length ?? 0)
      toast.success(
        '已导出',
        `文件已开始下载（${data.categories?.length ?? 0} 分类 · ${data.cards?.length ?? 0} 书签，共 ${cnt} 项）`,
      )
    } catch (err) {
      console.error(err)
      toast.error('导出失败', err instanceof Error ? err.message : '未知错误')
    }
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      let data: ExportData
      try {
        data = JSON.parse(text) as ExportData
      } catch {
        toast.error('导入失败', '文件格式错误，请确认是合法的 JSON')
        return
      }
      const cats = Array.isArray(data?.categories) ? data.categories : []
      const cards = Array.isArray(data?.cards) ? data.cards : []
      if (cats.length === 0 && cards.length === 0) {
        toast.error('导入失败', '未识别到分类或书签数据')
        return
      }
      setMode('merge') // 每次都默认安全的合并
      setPending({
        data,
        catCount: cats.length,
        cardCount: cards.length,
        fileName: file.name,
      })
    }
    input.click()
  }

  const handleConfirmImport = async () => {
    if (!pending) return
    setImporting(true)
    try {
      const result = await getRepository().bulkImport(pending.data, mode)
      await init()
      setPending(null)
      if (result.mode === 'replace') {
        toast.success(
          '已替换全部数据',
          `${result.categoriesAdded} 分类 · ${result.cardsAdded} 书签`,
        )
      } else {
        toast.success(
          '合并完成',
          `分类 +${result.categoriesAdded} / 更新 ${result.categoriesUpdated}\n` +
            `书签 +${result.cardsAdded} / 更新 ${result.cardsUpdated}`,
        )
      }
    } catch (err) {
      console.error(err)
      toast.error(
        '导入失败',
        err instanceof Error ? err.message : '未知错误',
      )
    } finally {
      setImporting(false)
    }
  }

  /**
   * 浏览器导入：包一层 toast 反馈。
   * - 成功：显示新增 / 跳过统计
   * - 失败：显示错误消息
   */
  const handleImportFromBrowser = async () => {
    try {
      const result = await importFromBrowser()
      const total =
        result.categoriesAdded + result.cardsAdded + result.cardsSkipped
      if (total === 0) {
        toast.info(
          '未发现新书签',
          '当前浏览器书签都已存在于 Tab It 中，无新增',
        )
        return
      }
      if (result.categoriesAdded === 0 && result.cardsAdded === 0) {
        toast.info(
          '没有新增内容',
          `检测到 ${result.cardsSkipped} 个书签均已存在（按分类 + URL 去重）`,
        )
        return
      }
      const dedupHint =
        result.cardsSkipped > 0
          ? `\n（已跳过重复 ${result.cardsSkipped} 个）`
          : ''
      toast.success(
        '已从浏览器导入',
        `新增 ${result.categoriesAdded} 分类、${result.cardsAdded} 书签${dedupHint}`,
      )
    } catch (err) {
      console.error(err)
      toast.error(
        '从浏览器导入失败',
        err instanceof Error ? err.message : '未知错误（请确认已授权 bookmarks 权限）',
      )
    }
  }

  /**
   * 「同步到浏览器书签」执行入口：用户在子弹窗确认参数后调用。
   * - 镜像模式：在选定根目录下的 folderName 文件夹内重建 Tab It 结构
   * - 完成后给出新增 / 更新 / 清理 三段式 toast 反馈
   */
  const handleExportToBrowser = async (params: {
    root: BrowserSyncRoot
    folderName: string
  }) => {
    setExporting(true)
    try {
      const result: ExportResult = await exportToBrowser(params)
      const created = result.foldersCreated + result.bookmarksCreated
      const summaryParts = [
        `新增 ${result.foldersCreated} 文件夹 / ${result.bookmarksCreated} 书签`,
        `更新 ${result.nodesUpdated} 项`,
        `清理 ${result.nodesRemoved} 项`,
      ]
      const detail = summaryParts.join(' · ')
      if (result.errors.length > 0) {
        // 有失败但整体跑完 → warn 风格（这里 toast 没有 warn，用 info 并标注）
        console.warn('[exportToBrowser] errors:', result.errors)
        toast.info(
          '同步完成（含错误）',
          `${detail}\n${result.errors.length} 项失败，详情见 Console`,
        )
      } else if (created === 0 && result.nodesUpdated === 0 && result.nodesRemoved === 0) {
        toast.info(
          '浏览器书签已是最新',
          `镜像目录「${params.folderName}」与 Tab It 一致，无需变更`,
        )
      } else {
        toast.success('已同步到浏览器书签', detail)
      }
      setExportDialogOpen(false)
    } catch (err) {
      console.error(err)
      toast.error(
        '同步失败',
        err instanceof Error
          ? err.message
          : '未知错误（请确认已授权 bookmarks 权限）',
      )
    } finally {
      setExporting(false)
    }
  }

  // 包装一层：执行后自动关闭数据管理面板，避免再点一次
  const runAndCloseData = (fn: () => void | Promise<void>) => async () => {
    setDataDialogOpen(false)
    await fn()
  }

  return (
    <header
      className={
        'grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-5 py-2.5 ' +
        'min-h-[66px] shrink-0 ' +
        'border-b border-slate-200/70 dark:border-slate-700/70'
      }
    >
      <h1 className="text-sm font-semibold text-brand/70 hover:text-brand transition-colors leading-none tracking-tight">Tab It</h1>
      {/* 中央：网页搜索框（替代被覆盖的浏览器地址栏，支持切换搜索引擎） */}
      <div className="justify-self-center w-full max-w-[540px]">
        <WebSearchBox />
      </div>
      <div className="flex items-center gap-2 justify-self-end opacity-70 hover:opacity-100 transition-opacity">
        {/* 帮助文档 → 弹出使用文档弹窗（位于齿轮左侧，与齿轮同尺寸 9×9） */}
        <button
          type="button"
          data-tour="topbar-help"
          onClick={() => setHelpDialogOpen(true)}
          className={cn(
            'w-9 h-9 flex items-center justify-center rounded-md',
            'text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-100',
            'hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors',
            helpDialogOpen && 'text-slate-700 dark:text-slate-100 bg-slate-100 dark:bg-slate-800',
          )}
          title="帮助文档"
          aria-label="帮助文档"
        >
          <HelpIcon />
        </button>
        {/* 齿轮 → 弹出小气泡菜单（复用 CardMenu，与卡片右键菜单同款样式） */}
        <CardMenu
          align="right"
          menuWidth={150}
          ariaLabel="设置"
          items={[
            {
              key: 'data',
              label: '数据管理',
              icon: <DatabaseIcon />,
              onSelect: () => setDataDialogOpen(true),
            },
            {
              key: 'style',
              label: '样式管理',
              icon: <PaletteIcon />,
              onSelect: () => setStyleDialogOpen(true),
            },
            {
              key: 'restart-tour',
              label: '重新引导',
              icon: <CompassIcon />,
              onSelect: () => void handleRestartTour(),
            },
            {
              key: 'about',
              label: '关于 Tab It',
              icon: <InfoIcon />,
              onSelect: () => setAboutDialogOpen(true),
            },
          ]}
          trigger={(toggle, isOpen) => (
            <button
              type="button"
              data-tour="topbar-settings"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                toggle()
              }}
              className={cn(
                'w-9 h-9 flex items-center justify-center rounded-md',
                'text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-100',
                'hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors',
                isOpen && 'text-slate-700 dark:text-slate-100 bg-slate-100 dark:bg-slate-800',
              )}
              title="设置"
              aria-label="设置"
            >
              <GearIcon />
            </button>
          )}
        />
      </div>

      {/* 数据管理弹窗：4 个数据操作项 */}
      {dataDialogOpen &&
        createPortal(
          <DataDialog
            settings={settings}
            onClose={() => setDataDialogOpen(false)}
            onImportFromBrowser={runAndCloseData(handleImportFromBrowser)}
            onExportToBrowser={runAndCloseData(() => {
              setExportDialogOpen(true)
            })}
            onImportJson={runAndCloseData(handleImport)}
            onExportJson={runAndCloseData(handleExport)}
          />,
          document.body,
        )}

      {/* 同步到浏览器书签：参数确认弹窗 */}
      {exportDialogOpen &&
        createPortal(
          <ExportToBrowserDialog
            defaultRoot={settings.browserSyncRoot ?? 'bookmarks_bar'}
            defaultFolderName={settings.browserSyncFolderName ?? 'Tab It'}
            exporting={exporting}
            onCancel={() => !exporting && setExportDialogOpen(false)}
            onConfirm={handleExportToBrowser}
          />,
          document.body,
        )}

      {/* 样式管理弹窗：主题切换 + 自定义背景 */}
      {styleDialogOpen &&
        createPortal(
          <StyleDialog
            settings={settings}
            onClose={() => setStyleDialogOpen(false)}
            onUpdate={updateSettings}
          />,
          document.body,
        )}

      {/* 关于弹窗：版本号 / build 标识 / 开源链接 */}
      {aboutDialogOpen &&
        createPortal(
          <AboutDialog onClose={() => setAboutDialogOpen(false)} />,
          document.body,
        )}

      {/* 导入数据二次确认弹层 */}
      {pending &&
        createPortal(
          <ImportDialog
            pending={pending}
            mode={mode}
            importing={importing}
            onChangeMode={setMode}
            onCancel={() => !importing && setPending(null)}
            onConfirm={handleConfirmImport}
          />,
          document.body,
        )}

      {/* 帮助文档弹窗：渲染 docs/USER_GUIDE.md 的内容 */}
      {helpDialogOpen &&
        createPortal(
          <HelpDialog
            source={userGuideMd}
            onClose={() => setHelpDialogOpen(false)}
          />,
          document.body,
        )}
    </header>
  )
}
