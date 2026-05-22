/**
 * AI 模块公共类型
 *
 * 这一层只放跨子模块（panel / providers / services）共用的类型，
 * 子模块自己的内部类型放到对应文件里。
 */

// ─── Provider 抽象 ───────────────────────────────────────

/**
 * Provider 类型。
 * - openai-compatible: OpenAI / DeepSeek / Azure / 智谱 / Moonshot / Ollama / vLLM / Together
 *                      / Groq / OpenRouter / SiliconFlow 等都走这个 adapter
 * - window-ai:        Chrome 138+ 内置 Gemini Nano（完全本地，零成本零隐私）
 * - ollama:           预留；当前用 openai-compatible 也能覆盖
 */
export type ProviderType = 'openai-compatible' | 'window-ai' | 'ollama'

/**
 * 用户配置的一个 Provider。
 * apiKey 仅存 chrome.storage.local，永不出包（不进 sync 也不进 export json）
 */
export interface AIProviderConfig {
  id: string
  name: string
  type: ProviderType
  baseURL?: string
  apiKey?: string
  model: string
  embeddingModel?: string
}

/** 任务 → Provider id 的路由配置 */
export interface AIRouting {
  chat: string
  organize: string
  embedding: string
}

export interface AIPrivacy {
  anonymousMode: boolean
  allowContentCrawl: boolean
  showCostEstimate: boolean
}

/**
 * 整体 AI 设置。
 * - enabled=false 时所有 AI UI 入口都不工作
 * - providers 至少 1 个且 routing 指向有效 id 时，才算"已配置"
 */
export interface AISettings {
  enabled: boolean
  providers: AIProviderConfig[]
  routing: Partial<AIRouting>
  privacy: AIPrivacy
  preferLocal: boolean
  /**
   * 被动整理建议（V1.5 §5.2）：
   * - 当用户累计新增 ≥ 10 条 + 距上次提示 ≥ 7 天，FAB 红点 + 浮窗整理 Tab 顶部横幅
   * - 默认开启；用户可在「⚙ 设置」一键关闭
   */
  passiveSuggest: boolean
  /**
   * 网页内容抓取同意状态（V2.0 §6.1）：
   * - agreed=false：默认；首次「内容抓取」操作时弹隐私说明 + 用户必须勾同意
   * - agreed=true + agreedAt：已同意；操作不再弹窗，仅显示常规确认
   * - 用户可在「⚙ 设置」撤回同意（撤回后下次再用还会弹）
   *
   * 这是 manifest host_permissions: <all_urls> 的"应用层使用许可"，
   * 即"浏览器允许扩展能访问"≠"用户允许这次行为"
   */
  crawl: {
    agreed: boolean
    agreedAt?: number
  }
  /**
   * AI 自动备注（V2.0 §6.3）：
   * - true：crawler 抓完一批正文后，自动接力调 summarizer 为「未写备注」的卡生成 1 句话摘要
   * - false（默认）：用户需手动在 ⚙ 设置 → AI 自动备注 点「批量生成」
   * - 关闭也不影响"手动批量"按钮，只是不会自动联动
   */
  autoSummarize: boolean
}

// ─── Chat 接口 ───────────────────────────────────────────

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ChatOptions {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  responseFormat?: 'text' | 'json'
  signal?: AbortSignal
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
}

export interface ChatResponse {
  text: string
  usage?: ChatUsage
  model?: string
}

export interface ChatChunk {
  delta: string
  done?: boolean
  usage?: ChatUsage
}

// ─── Provider 接口 ──────────────────────────────────────

export interface AIProvider {
  id: string
  type: ProviderType

  chat(opts: ChatOptions): Promise<ChatResponse>
  chatStream?(opts: ChatOptions): AsyncIterable<ChatChunk>
  embedding?(input: string[]): Promise<number[][]>

  testConnection(): Promise<{ ok: boolean; message?: string; latencyMs?: number }>
}

// ─── 默认值 + 工具 ──────────────────────────────────────

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  providers: [],
  routing: {},
  privacy: {
    anonymousMode: true,
    allowContentCrawl: false,
    showCostEstimate: true,
  },
  preferLocal: false,
  passiveSuggest: true,
  crawl: {
    agreed: false,
  },
  autoSummarize: false,
}

/**
 * 「是否已配置可用 AI」判定：
 * 至少有一个 provider，且 chat routing 指向了一个真实存在的 provider。
 */
export function isAIConfigured(s: AISettings): boolean {
  if (!s.enabled) return false
  if (s.providers.length === 0) return false
  const chatId = s.routing.chat
  if (!chatId) return false
  return s.providers.some((p) => p.id === chatId)
}

// ─── AI 整理（Organize） ───────────────────────────────

/** 整理范围 */
export type OrganizeRange =
  | { type: 'all' }
  | { type: 'category'; id: string }
  | { type: 'uncategorized' } // 顶层散落项

/** 整理风格倾向，会作为 prompt 的一部分 */
export type OrganizeStyle = 'work' | 'study' | 'life' | 'free'

export const ORGANIZE_STYLE_LABEL: Record<OrganizeStyle, string> = {
  work: '工作主题为主（前端开发 / 设计资源 / 文档…）',
  study: '学习主题为主（语言 / 算法 / 公开课…）',
  life: '生活主题为主（购物 / 影视 / 美食…）',
  free: '不指定，让 AI 自由发挥',
}

/**
 * 整理 Plan：AI 输出的"整理建议"完整描述。
 * 应用前用户可对单条 ✓/✗ 接受 / 拒绝。
 */
export interface OrganizePlan {
  id: string
  createdAt: number
  range: OrganizeRange
  style: OrganizeStyle
  /** 即将新建的分类 */
  newCategories: NewCategoryProposal[]
  /** 书签的归属变化 */
  assignments: BookmarkAssignment[]
  /** 建议删除的空分类 id（应用前会再校验：仍为空才删） */
  deletions: string[]
  /** AI 调用的元数据 */
  meta: {
    provider: string
    model: string
    promptTokens: number
    completionTokens: number
    /** 估算成本（人民币元；模型表 hardcoded） */
    estimatedCostCny?: number
  }
}

export interface NewCategoryProposal {
  /** AI 给的临时 id（tmp_xxx）；应用时会替换为真实 uuid */
  tempId: string
  name: string
  icon?: string
  /** 创建该分类的理由（用于在 diff UI 上显示） */
  rationale?: string
}

export interface BookmarkAssignment {
  bookmarkId: string
  /** 当前所属分类 id（未分类时是 null） */
  fromCategoryId: string | null
  /** 目标：要么 newCategories[].tempId，要么现有 categoryId */
  targetTempId?: string
  targetCategoryId?: string
}

/** 用户在 diff 阶段对单条建议的接受 / 拒绝状态 */
export interface PlanReview {
  /** 接受新建的分类 tempId 集合（拒绝的 tempId 不在内） */
  acceptedNewCategoryTempIds: Set<string>
  /** 接受的 assignments index */
  acceptedAssignments: Set<number>
  /** 接受的 deletions categoryId */
  acceptedDeletions: Set<string>
}

/**
 * 整理执行的阶段。组件用此切换 UI。
 */
export type OrganizeStage =
  | 'config'    // 用户配置 range / style / 隐私
  | 'estimate'  // 显示成本估算，等待用户确认
  | 'running'   // AI 处理中（可取消）
  | 'preview'   // 已得到 plan，diff 视图供用户挑选
  | 'applying'  // 正在应用到 store / repository
  | 'done'      // 应用完成，60s 撤销窗口
  | 'error'     // 任意阶段出错的统一结束态

/** 范围对应的待处理书签数（在 config 阶段实时计算给用户看） */
export interface RangeStat {
  bookmarkCount: number
  categoryCount: number
}

// ─── AI 自动打标签（Tagger） ──────────────────────────

/** 打标签的范围 */
export type TagRange =
  /** 全库未打过标签的书签（默认；最常见诉求） */
  | { type: 'untagged' }
  /** 全库所有书签（包含已有 tags 的，会被覆盖） */
  | { type: 'all' }
  /** 某个分类（含后代）下的书签 */
  | { type: 'category'; id: string }

export const TAG_RANGE_LABEL: Record<TagRange['type'], string> = {
  untagged: '仅未打标签的书签',
  all: '全部书签（覆盖已有标签）',
  category: '指定分类',
}

/**
 * 单条 AI 打标签建议
 * - oldTags: 卡片当前已有的 tags（用于 diff 视图对比）
 * - newTags: AI 建议的 tags（标准化后；空数组表示 AI 觉得无合适标签）
 */
export interface TagSuggestion {
  bookmarkId: string
  /** 原标签（可能为 undefined / [] ） */
  oldTags?: string[]
  /** AI 建议的新标签集合（已标准化） */
  newTags: string[]
}

/**
 * 打标签 Plan：AI 输出的"打标签建议"完整描述。
 * 应用前用户可对单条 ✓/✗ 接受/拒绝；也可在 UI 中编辑 newTags 后再应用。
 */
export interface TagPlan {
  id: string
  createdAt: number
  range: TagRange
  /** 每条卡片一个建议（仅含 AI 真的给了 tag 的，oldTags 仅作对比） */
  suggestions: TagSuggestion[]
  /** AI 调用元数据 */
  meta: {
    provider: string
    model: string
    promptTokens: number
    completionTokens: number
    estimatedCostCny?: number
  }
}

/** 用户对 TagPlan 的接受/拒绝 + 编辑后的 tags */
export interface TagPlanReview {
  /** 接受的 bookmarkId 集合（拒绝的不在内） */
  accepted: Set<string>
  /** 用户编辑后的 tags：bookmarkId → tags；未编辑的项不在 map 中（沿用 newTags） */
  edits: Map<string, string[]>
}

/** Tagger 任务状态（与 OrganizeStage 对称） */
export type TagStage =
  | 'config'
  | 'estimate'
  | 'running'
  | 'preview'
  | 'applying'
  | 'done'
  | 'error'

// ─── 浮窗 Tab 类型 ──────────────────────────────────────

/**
 * Tab 的种类。
 * - chat:     RAG 对话（V2 才接通；V1 阶段做占位）
 * - organize: AI 整理书签
 * - labels:   自动打标签 + 标签管理
 * - settings: AI Provider 与隐私设置
 *
 * 一个浮窗内可以同时挂多个相同 type 的 tab（例如多对话），
 * 每个 tab 有自己的 id 与独立 state。
 */
export type AITabType = 'chat' | 'organize' | 'labels' | 'settings'

export interface AIPanelTab {
  /** 全局唯一 id（uuid） */
  id: string
  type: AITabType
  /** Tab 标题，对话 tab 自动从首条提问生成 */
  title: string
  /**
   * Tab 自有 state（任意 JSON 可序列化结构）；
   * 关闭浮窗 / 切换 tab 时不丢失，会随 panel 一并持久化到 storage。
   * 各 tab 组件自行解释结构。
   */
  state?: Record<string, unknown>
  createdAt: number
}

export interface PanelPosition {
  x: number
  y: number
}

export interface PanelSize {
  width: number
  height: number
}

/**
 * 副浮窗（V3.0 §7.3 多浮窗支持）：用户从主浮窗 tab 上点「⤴ 分离」后，
 * 把该 tab 拆出来变成独立可拖动 / 缩放 / 最小化的浮窗。
 *
 * 关键设计取舍：
 * - 副浮窗"绑定"主 store 中的某个 tab.id —— 不复制 tab 数据；
 *   tab 内容（messages / state）继续读写主 store，避免双源同步问题。
 * - 副浮窗一个浮窗只承载一个 tab；不再有 tab bar / + 新建。
 *   想再开 → 再用主浮窗 + 分离即可。
 * - 主 store closeTab(tabId) 时，副 store 必须同步移除对应 SecondaryPanel
 *   （否则副浮窗会变成"空壳"找不到内容）。
 */
export interface SecondaryPanel {
  /** 浮窗自身 uuid */
  id: string
  /** 该浮窗渲染的 tab id（在主 useAIPanelStore.tabs 中） */
  tabId: string
  position?: PanelPosition
  size?: PanelSize
  minimized: boolean
  /** 焦点切换时 bump；越大越靠上 */
  zIndex: number
  createdAt: number
}

// ─── 浮窗常量 ──────────────────────────────────────────

export const PANEL_DEFAULT_SIZE: PanelSize = { width: 380, height: 520 }
export const PANEL_MIN_SIZE: PanelSize = { width: 280, height: 360 }
/** 最大宽度按视口百分比；最大高度 80vh，运行时计算 */
export const PANEL_MAX_WIDTH = 720
export const PANEL_MAX_HEIGHT_RATIO = 0.8

/** 边界保护：拖动后浮窗至少有这么多像素留在视口里，防止"找不回来" */
export const PANEL_VIEWPORT_PAD = 100

/** FAB 物理参数 */
export const FAB_SIZE = 52
export const FAB_OFFSET = { right: 24, bottom: 24 }

/** 默认浮窗位置：避开 FAB（FAB 在右下，浮窗在 FAB 上方一点） */
export function defaultPanelPosition(viewport: { width: number; height: number }): PanelPosition {
  // 距右 24，距底 96（让出 FAB 和呼吸空间）
  return {
    x: viewport.width - PANEL_DEFAULT_SIZE.width - 24,
    y: viewport.height - PANEL_DEFAULT_SIZE.height - 96,
  }
}
