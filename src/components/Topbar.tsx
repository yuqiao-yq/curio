import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { toast } from '../stores/useToastStore'
import { getRepository } from '../repositories'
import type { ExportData, UserSettings } from '../types/bookmark'
import type { BulkImportMode } from '../repositories/types'
import type {
  BrowserSyncRoot,
  ExportResult,
} from '../services/bookmarkExporter'
import { cn } from '../utils/cn'
import { WebSearchBox } from './WebSearchBox'
import { CardMenu } from './CardMenu'
import { HelpDialog } from './HelpDialog'
import { GradientEditor } from './GradientEditor'
// docs/USER_GUIDE.md 是用户文档的唯一来源，弹窗内容由它驱动
// （Vite 的 ?raw 后缀会把文件以纯字符串形式 import 进来）
import userGuideMd from '../../docs/USER_GUIDE.md?raw'
// 读 package.json 取版本号在「关于」弹窗里展示，避免硬编码导致信息漂移
import pkg from '../../package.json'

/**
 * UI 构建标识：每次 UI 大改时 +1，便于在「关于」里确认页面是否加载到最新代码。
 * 之前嵌在侧栏底部对普通用户是噪音，现在统一收到「关于」弹窗里。
 */
const UI_BUILD_TAG = 'v6-relative-paths'

interface PendingImport {
  data: ExportData
  catCount: number
  cardCount: number
  fileName: string
}

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
      let data: any
      try {
        data = JSON.parse(text)
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
        'flex items-center gap-4 px-5 py-2.5 ' +
        'min-h-[66px] shrink-0 ' +
        'border-b border-slate-200/70 dark:border-slate-700/70'
      }
    >
      <h1 className="text-lg font-bold text-brand shrink-0 leading-none tracking-tight">Tab It</h1>
      {/* 中央：网页搜索框（替代被覆盖的浏览器地址栏，支持切换搜索引擎） */}
      <WebSearchBox />
      <div className="flex items-center gap-2 shrink-0">
        {/* 帮助文档 → 弹出使用文档弹窗（位于齿轮左侧，与齿轮同尺寸 9×9） */}
        <button
          type="button"
          onClick={() => setHelpDialogOpen(true)}
          className={cn(
            'w-9 h-9 flex items-center justify-center rounded-md',
            'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100',
            'hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors',
            helpDialogOpen && 'text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800',
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
              key: 'about',
              label: '关于 Tab It',
              icon: <InfoIcon />,
              onSelect: () => setAboutDialogOpen(true),
            },
          ]}
          trigger={(toggle, isOpen) => (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                toggle()
              }}
              className={cn(
                'w-9 h-9 flex items-center justify-center rounded-md text-base',
                'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100',
                'hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors',
                isOpen && 'text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800',
              )}
              title="设置"
              aria-label="设置"
            >
              ⚙
            </button>
          )}
        />
      </div>

      {/* 数据管理弹窗：4 个数据操作项 */}
      {dataDialogOpen &&
        createPortal(
          <DataDialog
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

// ─── 通用居中 Dialog 外壳 ──────────────────────────
function DialogShell({
  title,
  width = 460,
  onClose,
  children,
  footer,
}: {
  title: React.ReactNode
  width?: number
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width }}
        className={cn(
          // v0.21.16：max-h 用 vh 自适应屏幕；flex 让 head/footer 固定、body 滚动
          'max-w-[92vw] max-h-[calc(100vh-2rem)] flex flex-col rounded-lg shadow-2xl',
          'bg-white dark:bg-slate-800',
          'border border-slate-200 dark:border-slate-700',
        )}
      >
        {/* 头（高度固定） */}
        <div className="px-5 py-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-700 shrink-0">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'w-7 h-7 flex items-center justify-center rounded text-sm',
              'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
              'hover:bg-slate-100 dark:hover:bg-slate-700/60',
            )}
            title="关闭"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
        {/* 体（撑满剩余 + 内部滚动；min-h-0 是 flex 子节点正确滚动的必要条件） */}
        <div className="px-5 py-4 flex-1 min-h-0 overflow-y-auto">
          {children}
        </div>
        {/* 底（高度固定） */}
        <div className="px-5 py-3 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-700 shrink-0">
          {footer ?? (
            <button
              type="button"
              onClick={onClose}
              className={cn(
                'px-3 py-1.5 text-sm rounded transition-colors',
                'text-slate-600 dark:text-slate-300',
                'hover:bg-slate-100 dark:hover:bg-slate-700/60',
              )}
            >
              关闭
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── 关于弹层 ──────────────────────────────────────
function AboutDialog({ onClose }: { onClose: () => void }) {
  const repoUrl = 'https://github.com/yuqiao-yq/tab-it'
  return (
    <DialogShell
      title={
        <span className="flex items-center gap-2">
          <span className="text-base">ℹ️</span>
          <span>关于 Tab It</span>
        </span>
      }
      width={440}
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold text-brand">Tab It</span>
          <span className="text-sm text-slate-500 dark:text-slate-400 tabular-nums">
            v{pkg.version}
          </span>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          替代浏览器新标签页的书签整理工具。所有数据本地存储，开源免费。
        </p>

        <div className="rounded-md bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 px-3 py-2 space-y-1">
          <InfoRow label="版本" value={`v${pkg.version}`} />
          <InfoRow label="UI build" value={UI_BUILD_TAG} />
          <InfoRow
            label="项目主页"
            value={
              <a
                href={repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline break-all"
              >
                {repoUrl.replace('https://', '')}
              </a>
            }
          />
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          反馈与建议欢迎到 GitHub 提 issue。
        </p>
      </div>
    </DialogShell>
  )
}

function InfoRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-slate-500 dark:text-slate-400 shrink-0">
        {label}
      </span>
      <span className="text-slate-700 dark:text-slate-200 text-right truncate">
        {value}
      </span>
    </div>
  )
}

// ─── 数据管理弹层 ──────────────────────────────────
function DataDialog({
  onClose,
  onImportFromBrowser,
  onExportToBrowser,
  onImportJson,
  onExportJson,
}: {
  onClose: () => void
  onImportFromBrowser: () => void
  onExportToBrowser: () => void
  onImportJson: () => void
  onExportJson: () => void
}) {
  return (
    <DialogShell
      title={
        <span className="flex items-center gap-2">
          <span className="text-base">🗂️</span>
          <span>数据管理</span>
        </span>
      }
      onClose={onClose}
    >
      <div className="space-y-2">
        <ActionItem
          icon="🌐"
          title="从浏览器导入书签"
          desc="一键合并当前浏览器现有书签，按文件夹层级保留分类。"
          onClick={onImportFromBrowser}
        />
        <ActionItem
          icon="🔄"
          title="同步到浏览器书签"
          desc="把当前所有分类与书签镜像到浏览器原生书签的指定文件夹中。"
          onClick={onExportToBrowser}
        />
        <ActionItem
          icon="📥"
          title="导入配置文件"
          desc="选择 JSON 配置文件，支持「合并」或「替换」两种模式。"
          onClick={onImportJson}
        />
        <ActionItem
          icon="📤"
          title="导出配置文件"
          desc="将当前所有分类、书签、设置打包为 JSON 下载到本地。"
          onClick={onExportJson}
        />
      </div>
    </DialogShell>
  )
}

// ─── 同步到浏览器：参数确认弹层 ───────────────────
/**
 * 同步前的参数确认弹窗：
 * - root         ：写到「书签栏」还是「其他书签」
 * - folderName   ：根文件夹名（默认 Tab It），避免污染用户已有书签
 * - 含一条强提醒：镜像模式 = 该文件夹内的多余项会被自动清理
 */
function ExportToBrowserDialog({
  defaultRoot,
  defaultFolderName,
  exporting,
  onCancel,
  onConfirm,
}: {
  defaultRoot: BrowserSyncRoot
  defaultFolderName: string
  exporting: boolean
  onCancel: () => void
  onConfirm: (params: {
    root: BrowserSyncRoot
    folderName: string
  }) => void
}) {
  const [root, setRoot] = useState<BrowserSyncRoot>(defaultRoot)
  const [folderName, setFolderName] = useState(defaultFolderName)
  const trimmed = folderName.trim()
  const invalid = trimmed.length === 0 || trimmed.length > 60

  return (
    <DialogShell
      title={
        <span className="flex items-center gap-2">
          <span className="text-base">🔄</span>
          <span>同步到浏览器书签</span>
        </span>
      }
      width={520}
      onClose={onCancel}
      footer={
        <>
          <button
            type="button"
            disabled={exporting}
            onClick={onCancel}
            className={cn(
              'px-3 py-1.5 text-sm rounded transition-colors',
              'text-slate-600 dark:text-slate-300',
              'hover:bg-slate-100 dark:hover:bg-slate-700/60',
              exporting && 'opacity-50 cursor-not-allowed',
            )}
          >
            取消
          </button>
          <button
            type="button"
            disabled={exporting || invalid}
            onClick={() => onConfirm({ root, folderName: trimmed })}
            className={cn(
              'px-3 py-1.5 text-sm rounded font-medium transition-colors',
              'bg-brand text-white hover:bg-brand-600',
              (exporting || invalid) && 'opacity-50 cursor-not-allowed',
            )}
          >
            {exporting ? '同步中…' : '开始同步'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* 目标根：书签栏 / 其他书签 */}
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            写入位置
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                {
                  key: 'bookmarks_bar',
                  label: '书签栏',
                  desc: '顶部工具栏可见',
                  icon: '📌',
                },
                {
                  key: 'other',
                  label: '其他书签',
                  desc: '收纳在书签管理器',
                  icon: '📁',
                },
              ] as const
            ).map((opt) => {
              const active = root === opt.key
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setRoot(opt.key)}
                  className={cn(
                    'flex items-start gap-2 px-3 py-2.5 rounded-md border text-left transition-all',
                    active
                      ? 'border-brand bg-brand/5 dark:bg-brand/10'
                      : 'border-slate-200 dark:border-slate-700 hover:border-brand/40 hover:bg-slate-50 dark:hover:bg-slate-700/40',
                  )}
                >
                  <span className="text-lg leading-none mt-0.5 shrink-0">
                    {opt.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div
                      className={cn(
                        'text-sm',
                        active
                          ? 'text-brand font-medium'
                          : 'text-slate-700 dark:text-slate-200',
                      )}
                    >
                      {opt.label}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {opt.desc}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        {/* 根文件夹名 */}
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            根文件夹名
          </h4>
          <input
            type="text"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            placeholder="Tab It"
            spellCheck={false}
            disabled={exporting}
            className={cn(
              'w-full px-3 py-1.5 text-sm rounded-md',
              'border border-slate-200 dark:border-slate-700',
              'bg-white dark:bg-slate-900',
              'outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all',
              'placeholder:text-slate-400',
              invalid && 'border-red-300 dark:border-red-500/60',
              exporting && 'opacity-50 cursor-not-allowed',
            )}
          />
          <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
            会在选定位置下复用 / 创建该文件夹，所有 Tab It 数据都收纳在其中，
            避免污染你原有的书签结构。
          </p>
        </section>

        {/* 行为说明（强提醒） */}
        <section
          className={cn(
            'rounded-md px-3 py-2.5 text-[12px] leading-relaxed',
            'bg-amber-50 dark:bg-amber-500/10',
            'border border-amber-200 dark:border-amber-500/30',
            'text-amber-700 dark:text-amber-200',
          )}
        >
          <div className="font-medium mb-1">⚠ 镜像同步说明</div>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>同步方向为单向：Tab It → 浏览器（不读取浏览器侧的改动）</li>
            <li>
              会保持「<span className="font-mono">{trimmed || 'Tab It'}</span>
              」文件夹与 Tab It 数据完全一致：
              <span className="font-medium">该文件夹下的多余项会被自动清理</span>
            </li>
            <li>不影响该文件夹之外的任何浏览器原有书签</li>
          </ul>
        </section>
      </div>
    </DialogShell>
  )
}

function ActionItem({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: string
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2.5 rounded-md border transition-all',
        'flex items-start gap-3',
        'border-slate-200 dark:border-slate-700',
        'hover:border-brand/50 hover:bg-brand/5 dark:hover:bg-brand/10',
      )}
    >
      <span className="text-lg leading-none mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {title}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
          {desc}
        </div>
      </div>
      <span className="text-slate-300 dark:text-slate-600 text-sm leading-none mt-1 shrink-0">
        ›
      </span>
    </button>
  )
}

// ─── 样式管理弹层（主题 + 自定义背景） ─────────────
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

function StyleDialog({
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

// ─── 导入确认弹层 ─────────────────────────────────
function ImportDialog({
  pending,
  mode,
  importing,
  onChangeMode,
  onCancel,
  onConfirm,
}: {
  pending: PendingImport
  mode: BulkImportMode
  importing: boolean
  onChangeMode: (m: BulkImportMode) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          // v0.21.16：max-h 自适应屏幕 + 内部滚动
          'w-[420px] max-w-[90vw] max-h-[calc(100vh-2rem)] flex flex-col rounded-lg shadow-2xl',
          'bg-white dark:bg-slate-800',
          'border border-slate-200 dark:border-slate-700',
        )}
      >
        {/* 头（固定） */}
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            导入书签数据
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            来源：{pending.fileName}
          </p>
        </div>

        {/* 体（可滚动） */}
        <div className="px-5 py-4 space-y-3 flex-1 min-h-0 overflow-y-auto">
          <div className="text-sm text-slate-600 dark:text-slate-300">
            检测到{' '}
            <span className="font-medium text-brand">{pending.catCount}</span>{' '}
            个分类、
            <span className="font-medium text-brand">
              {' '}
              {pending.cardCount}
            </span>{' '}
            个书签。
          </div>

          {/* 模式选择 */}
          <div className="space-y-2">
            <ModeOption
              checked={mode === 'merge'}
              onSelect={() => onChangeMode('merge')}
              title="合并到现有数据"
              badge="推荐"
              desc="保留本地分类与书签，按 ID 合并。同 ID 取较新者，新数据追加到末尾。"
            />
            <ModeOption
              checked={mode === 'replace'}
              onSelect={() => onChangeMode('replace')}
              title="替换全部数据"
              badge="慎用"
              badgeDanger
              desc="清空本地所有分类与书签，并使用文件中的设置覆盖当前主题/布局。"
            />
          </div>
        </div>

        {/* 底（固定） */}
        <div className="px-5 py-3 flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-700 shrink-0">
          <button
            type="button"
            disabled={importing}
            onClick={onCancel}
            className={cn(
              'px-3 py-1.5 text-sm rounded transition-colors',
              'text-slate-600 dark:text-slate-300',
              'hover:bg-slate-100 dark:hover:bg-slate-700/60',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            取消
          </button>
          <button
            type="button"
            disabled={importing}
            onClick={onConfirm}
            className={cn(
              'px-3.5 py-1.5 text-sm rounded font-medium transition-colors',
              mode === 'replace'
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'bg-brand text-white hover:bg-brand-600',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {importing
              ? '导入中…'
              : mode === 'replace'
                ? '确认替换'
                : '确认合并'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModeOption({
  checked,
  onSelect,
  title,
  desc,
  badge,
  badgeDanger,
}: {
  checked: boolean
  onSelect: () => void
  title: string
  desc: string
  badge?: string
  badgeDanger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full text-left px-3 py-2.5 rounded-md border transition-all',
        'flex items-start gap-2.5',
        checked
          ? 'border-brand bg-brand/5 dark:bg-brand/10'
          : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/40',
      )}
    >
      {/* 单选圆 */}
      <span
        className={cn(
          'mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center',
          checked
            ? 'border-brand'
            : 'border-slate-300 dark:border-slate-600',
        )}
      >
        {checked && <span className="w-2 h-2 rounded-full bg-brand" />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {title}
          </span>
          {badge && (
            <span
              className={cn(
                'text-[10px] leading-none px-1.5 py-0.5 rounded-sm',
                badgeDanger
                  ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-300'
                  : 'bg-brand/10 text-brand',
              )}
            >
              {badge}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
          {desc}
        </div>
      </div>
    </button>
  )
}

// ─── 菜单内置 icon（14x14，与 CardMenu.MenuIcons 风格统一） ──
function DatabaseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
      <path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6" />
    </svg>
  )
}

function PaletteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  )
}

/** 圆 + i 字符；用于齿轮菜单里「关于」项 */
function InfoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="12" y1="7.5" x2="12" y2="7.51" />
    </svg>
  )
}

/** 帮助 icon：圆 + 问号；尺寸与齿轮按钮内的视觉权重对齐（16×16） */
function HelpIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4" />
      <line x1="12" y1="17" x2="12" y2="17.01" />
    </svg>
  )
}
