import { useState } from 'react'
import { cn } from '../../../../utils/cn'
import { AutoTagSection } from './AutoTag/AutoTagSection'
import { ManageSection } from './Manage/ManageSection'

/**
 * 「标签」Tab —— V1.0 §4.4 自动打标签 + 标签管理
 *
 * 顶部双 section 切换：
 *   [✨ 批量打标签]  [🏷 标签管理]
 *
 * - 批量打标签：完整的 config → estimate → running → preview → applying → done 状态机
 *   （拆到 AutoTag/AutoTagSection + stages/*）
 * - 标签管理：列出全库所有标签 + 计数；提供改名 / 合并 / 删除
 *   （拆到 Manage/ManageSection）
 */
export function LabelsTab() {
  const [section, setSection] = useState<'auto' | 'manage'>('auto')

  return (
    <div className="flex flex-col h-full">
      {/* 顶部双 section 切换 */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 shrink-0">
        <SectionTab
          active={section === 'auto'}
          onClick={() => setSection('auto')}
          icon="✨"
          label="批量打标签"
        />
        <SectionTab
          active={section === 'manage'}
          onClick={() => setSection('manage')}
          icon="🏷"
          label="标签管理"
        />
      </div>

      <div className="flex-1 overflow-auto">
        {section === 'auto' ? <AutoTagSection /> : <ManageSection />}
      </div>
    </div>
  )
}

function SectionTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: string
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 h-7 inline-flex items-center justify-center gap-1 rounded text-xs',
        'transition-colors',
        active
          ? 'bg-brand/10 text-brand font-medium'
          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800',
      )}
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </button>
  )
}
