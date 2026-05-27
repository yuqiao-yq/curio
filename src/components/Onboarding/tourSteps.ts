/**
 * 主 Tour 步骤定义（L1）
 *
 * 顺序：基础认识 → 工具栏 → 杀手锏
 *   1. 侧栏        ← 产品定位
 *   2. 搜索框
 *   3. 设置（⚙）   ← 跟帮助物理紧邻，相邻跳动最小
 *   4. 帮助（?）
 *   5. ✨ AI FAB   ← 差异化收尾，自然衔接「Cmd+J」记忆
 *
 * 第 1 步「侧栏」根据 categoriesCount 做二态适配：
 *   - 无分类：高亮工具栏（+ 按钮所在的那一排），文案引导「创建第一个」
 *   - 有分类：高亮第一个分类条目，文案讲「拖拽 / 嵌套 / 批量选中」
 *   （「双击改名」这种操作型知识下沉到 L1.5-b，等真有分类再教）
 */

export type Placement =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'left'
  | 'right'

export interface TourStepResolved {
  /** data-tour 锚点名 */
  anchor: string
  title: string
  body: string
  placement: Placement
  /** 找不到锚点时是否静默跳到下一步（默认 false：等待） */
  optional?: boolean
}

export interface TourContext {
  categoriesCount: number
}

/** Step 定义：静态字段 + 可选 resolve() 动态生成 */
export interface TourStep {
  id: string
  /** 给静态 step 用 */
  static?: TourStepResolved
  /** 给动态 step 用（基于运行时 ctx 决定锚点 / 文案） */
  resolve?: (ctx: TourContext) => TourStepResolved
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'sidebar',
    resolve: (ctx) =>
      ctx.categoriesCount > 0
        ? {
            anchor: 'sidebar-category-row',
            title: '📂 分类管理',
            // 保留原文案，末尾用括号补一行轻提示「双击可改名」
            body: '左侧管理书签分类，支持拖拽排序、嵌套、批量选中（双击可改名）',
            placement: 'right',
          }
        : {
            anchor: 'sidebar-toolbar',
            title: '📂 分类管理',
            body: '点 + 创建第一个分类，或从右上「设置 → 数据管理」一键导入',
            placement: 'right',
          },
  },
  {
    id: 'search-box',
    static: {
      anchor: 'search-box',
      title: '🔍 智能搜索',
      body: '试试 @ai 语义搜索、#标签 筛选，也可以直接粘贴网址跳转',
      placement: 'bottom',
    },
  },
  {
    id: 'topbar-settings',
    static: {
      anchor: 'topbar-settings',
      title: '⚙ 设置中心',
      body: '样式、数据管理、跨设备同步都在这里',
      placement: 'bottom-end',
    },
  },
  {
    id: 'topbar-help',
    static: {
      anchor: 'topbar-help',
      title: '❓ 完整文档',
      body: '任何时候忘了功能，点这查看完整使用说明',
      placement: 'bottom-end',
    },
  },
  {
    id: 'ai-fab',
    static: {
      anchor: 'ai-fab',
      title: '✨ AI 助手',
      body: '整理、问答、找回书签的能手，按 ⌘J / Ctrl+J 也能随时唤起',
      placement: 'left',
    },
  },
]

export function resolveStep(step: TourStep, ctx: TourContext): TourStepResolved {
  if (step.resolve) return step.resolve(ctx)
  if (step.static) return step.static
  throw new Error(`Tour step "${step.id}" has neither resolve() nor static`)
}
