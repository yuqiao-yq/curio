import { useState } from 'react'
import { useAISettingsStore } from '../../../../ai/useAISettingsStore'
import { isAIConfigured } from '../../../../ai/types'
import { cn } from '../../../../utils/cn'
import { ToggleRow } from './shared'
import { ProviderRow, AddProviderForm, RouteRow } from './ProviderSection'
import { EmbeddingSection } from './EmbeddingSection'
import { CrawlSection } from './CrawlSection'
import { SummarySection } from './SummarySection'
import { QualitySection } from './QualitySection'

/**
 * AI 设置 Tab（主 shell）
 *
 * v0.21.x 把原 2377 行的单文件按职责拆为 7 个文件：
 * - shared.tsx            原子组件（ToggleRow / Field / RangeChip / StatRow / ActionBtn）
 * - ProviderSection.tsx   Provider 列表 / 新增表单 / 任务路由
 * - EmbeddingSection.tsx  §5.1 语义搜索索引
 * - CrawlSection.tsx      §6.1 网页正文抓取（含隐私弹窗）
 * - SummarySection.tsx    §6.3 AI 自动备注
 * - QualitySection.tsx    §6.4 重复 / 失效检测
 *
 * 主 shell 只负责：状态横幅 + 通用开关组 + Provider/Route 段落 + 各 section 装配。
 * 业务逻辑全部下放到子文件，便于按需阅读 / 后续单测 / 进一步 lazy split。
 *
 * 三段式布局：
 * 1. 顶部：总开关 + 隐私 / 本地优先选项
 * 2. 中间：Provider 列表（每条可改名 / 改路由 / 删除 / 测试连接）
 * 3. 底部：「+ 添加 Provider」展开预设选择 + 自定义表单
 */
export function SettingsTab() {
  const settings = useAISettingsStore()
  const configured = isAIConfigured(settings)

  const [adding, setAdding] = useState(false)

  return (
    <div className="p-3 space-y-4 text-sm">
      {/* ─── 状态总览 ─── */}
      <div
        className={cn(
          'rounded-md px-3 py-2 text-xs',
          configured
            ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/40'
            : 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/40',
        )}
      >
        {configured ? (
          <>✓ AI 已就绪，可以开始使用整理 / 标签 / 对话等功能</>
        ) : (
          <>⚠ 还未配置可用的 AI Provider，下方添加一个即可开始</>
        )}
      </div>

      {/* ─── 总开关与隐私 ─── */}
      <section>
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
          通用
        </h4>
        <div className="space-y-1.5">
          <ToggleRow
            label="启用 AI 功能"
            description="关闭时所有 AI 入口（FAB / 浮窗 / popup ✨）都不工作"
            checked={settings.enabled}
            onChange={settings.setEnabled}
          />
          <ToggleRow
            label="匿名模式"
            description="发送给 AI 时只发域名，不发完整 URL"
            checked={settings.privacy.anonymousMode}
            onChange={(v) => settings.patchPrivacy({ anonymousMode: v })}
          />
          <ToggleRow
            label="操作前显示成本估算"
            description="每次 AI 操作前先确认本次大约消耗多少 tokens"
            checked={settings.privacy.showCostEstimate}
            onChange={(v) => settings.patchPrivacy({ showCostEstimate: v })}
          />
          <ToggleRow
            label="优先使用浏览器内置 AI"
            description="可用时优先走 Chrome 内置 Gemini Nano（仅 Chrome 138+）"
            checked={settings.preferLocal}
            onChange={settings.setPreferLocal}
          />
          <ToggleRow
            label="被动整理建议"
            description="新增书签累计 ≥ 10 条 + 距上次提示 ≥ 7 天 时，FAB 红点 + 浮窗顶部横幅"
            checked={settings.passiveSuggest}
            onChange={settings.setPassiveSuggest}
          />
        </div>
      </section>

      {/* ─── Provider 列表 ─── */}
      <section>
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
          AI Provider
        </h4>
        {settings.providers.length === 0 ? (
          <div className="text-xs text-slate-400 px-2 py-3 text-center">
            还没有 Provider，点下方「+ 添加」开始
          </div>
        ) : (
          <div className="space-y-2">
            {settings.providers.map((p) => (
              <ProviderRow key={p.id} config={p} />
            ))}
          </div>
        )}

        {!adding ? (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className={cn(
              'mt-2 w-full py-1.5 rounded-md text-xs font-medium',
              'border border-dashed border-slate-300 dark:border-slate-600',
              'text-slate-500 dark:text-slate-400',
              'hover:border-brand hover:text-brand transition-colors',
            )}
          >
            + 添加 Provider
          </button>
        ) : (
          <AddProviderForm
            onClose={() => setAdding(false)}
            onAdded={() => setAdding(false)}
          />
        )}
      </section>

      {/* ─── 路由（任务 → Provider） ─── */}
      {settings.providers.length >= 2 && (
        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
            任务路由
          </h4>
          <p className="text-[11px] text-slate-400 mb-2">
            可以为不同任务指定不同 Provider，例如对话用强模型，整理 / 标签用便宜模型
          </p>
          <div className="space-y-1.5">
            <RouteRow task="chat" label="对话 / 总结" />
            <RouteRow task="organize" label="整理 / 分类" />
            <RouteRow task="embedding" label="Embedding" />
          </div>
        </section>
      )}

      {/* ─── Embedding 管理（V1.5 §5.1 语义搜索） ─── */}
      {configured && <EmbeddingSection />}

      {/* ─── 内容抓取（V2.0 §6.1 网页正文索引） ─── */}
      <CrawlSection />

      {/* ─── AI 自动备注（V2.0 §6.3） ─── */}
      {configured && <SummarySection />}

      {/* ─── 整理质检（V2.0 §6.4 重复 / 失效检测） ─── */}
      <QualitySection />

      <p className="text-[11px] text-slate-400 leading-relaxed">
        🔒 你的 API Key 仅保存在本机 chrome.storage.local，永不上传，
        也不会出现在导出的 JSON 数据里。
      </p>
    </div>
  )
}
