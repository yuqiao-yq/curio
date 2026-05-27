import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { browser } from 'wxt/browser'
import {
  DEFAULT_AI_SETTINGS,
  type AIProviderConfig,
  type AISettings,
  type ProviderType,
} from './types'

/**
 * AI 设置 store
 *
 * 设计：
 * - 与 useBookmarkStore 解耦（AI 是独立子系统，互不依赖）
 * - 持久化到 chrome.storage.local（**永不**进 sync 也不进 export json，
 *   因为里面包含 apiKey）
 * - 增删改 Provider 都自动写库（debounce 200ms）
 * - 「是否已配置」由 isAIConfigured(settings) 计算（types.ts 中导出）
 */

const STORAGE_KEY = 'curio:ai-settings'

interface AISettingsStore extends AISettings {
  hydrated: boolean

  init: () => Promise<void>

  // 整体开关
  setEnabled: (v: boolean) => void
  setPreferLocal: (v: boolean) => void
  /** 被动整理建议（§5.2）总开关 */
  setPassiveSuggest: (v: boolean) => void

  // 隐私
  patchPrivacy: (patch: Partial<AISettings['privacy']>) => void

  /** 网页内容抓取同意（§6.1）；revoke=true 撤回同意 */
  setCrawlAgreed: (agreed: boolean) => void
  /** AI 自动备注开关（§6.3） */
  setAutoSummarize: (v: boolean) => void

  // Provider CRUD
  addProvider: (input: Omit<AIProviderConfig, 'id'>) => string
  updateProvider: (id: string, patch: Partial<AIProviderConfig>) => void
  removeProvider: (id: string) => void

  // Routing
  setRoute: (task: 'chat' | 'organize' | 'embedding', providerId: string) => void
}

export const useAISettingsStore = create<AISettingsStore>((set, get) => ({
  ...DEFAULT_AI_SETTINGS,
  hydrated: false,

  async init() {
    try {
      const result = await browser.storage.local.get(STORAGE_KEY)
      const raw = result[STORAGE_KEY] as AISettings | undefined
      if (raw) {
        // 防御：缺失字段用默认值兜底
        const safe: AISettings = {
          enabled: !!raw.enabled,
          providers: Array.isArray(raw.providers) ? raw.providers : [],
          routing: raw.routing ?? {},
          privacy: { ...DEFAULT_AI_SETTINGS.privacy, ...(raw.privacy ?? {}) },
          preferLocal: !!raw.preferLocal,
          // 老版本数据可能没有这个字段；缺省时用默认值（开启）
          passiveSuggest:
            typeof raw.passiveSuggest === 'boolean'
              ? raw.passiveSuggest
              : DEFAULT_AI_SETTINGS.passiveSuggest,
          // 老版本无此字段 → 视为未同意（默认安全态）
          crawl: {
            agreed: !!raw.crawl?.agreed,
            agreedAt:
              typeof raw.crawl?.agreedAt === 'number'
                ? raw.crawl.agreedAt
                : undefined,
          },
          autoSummarize:
            typeof raw.autoSummarize === 'boolean'
              ? raw.autoSummarize
              : DEFAULT_AI_SETTINGS.autoSummarize,
        }
        set({ ...safe, hydrated: true })
      } else {
        set({ hydrated: true })
      }
    } catch {
      set({ hydrated: true })
    }
  },

  setEnabled(v) {
    set({ enabled: v })
    persist(get())
  },

  setPreferLocal(v) {
    set({ preferLocal: v })
    persist(get())
  },

  setPassiveSuggest(v) {
    set({ passiveSuggest: v })
    persist(get())
  },

  setCrawlAgreed(agreed) {
    set({
      crawl: agreed
        ? { agreed: true, agreedAt: Date.now() }
        : { agreed: false },
    })
    persist(get())
  },

  setAutoSummarize(v) {
    set({ autoSummarize: v })
    persist(get())
  },

  patchPrivacy(patch) {
    set((s) => ({ privacy: { ...s.privacy, ...patch } }))
    persist(get())
  },

  addProvider(input) {
    const id = uuid()
    const newProvider: AIProviderConfig = { id, ...input }
    set((s) => {
      const providers = [...s.providers, newProvider]
      // 第一个 provider 自动用作所有 task 的默认路由 + 自动启用 AI
      const isFirst = s.providers.length === 0
      return {
        providers,
        enabled: s.enabled || isFirst,
        routing: isFirst
          ? { chat: id, organize: id, embedding: id }
          : s.routing,
      }
    })
    persist(get())
    return id
  },

  updateProvider(id, patch) {
    set((s) => ({
      providers: s.providers.map((p) =>
        p.id === id ? { ...p, ...patch, id: p.id } : p,
      ),
    }))
    persist(get())
  },

  removeProvider(id) {
    set((s) => {
      const providers = s.providers.filter((p) => p.id !== id)
      // 如果路由指向了被删的 provider，重置到第一个剩余的（或清空）
      const fix = (curr?: string) =>
        curr === id ? providers[0]?.id : curr
      return {
        providers,
        routing: {
          chat: fix(s.routing.chat),
          organize: fix(s.routing.organize),
          embedding: fix(s.routing.embedding),
        },
        // 全删光时关闭 AI（防止"启用但无 provider"的尴尬态）
        enabled: providers.length > 0 ? s.enabled : false,
      }
    })
    persist(get())
  },

  setRoute(task, providerId) {
    set((s) => ({ routing: { ...s.routing, [task]: providerId } }))
    persist(get())
  },
}))

/* ──────────────────────────────────────────────────────────────────────
 * 派生 selector：只订阅与「AI 是否可用」相关的最少字段。
 *
 * 直接 `useAISettingsStore()` 整体订阅会让任何字段变更都触发整组消费者
 * re-render（13 处）。如果消费者只想知道 boolean 配置态，用本 hook：
 * 只有 enabled / providers / routing.chat 变动时才重渲。
 * ────────────────────────────────────────────────────────────────────── */
export function useIsAIConfigured(): boolean {
  return useAISettingsStore((s) => {
    if (!s.enabled) return false
    if (s.providers.length === 0) return false
    const chatId = s.routing.chat
    if (!chatId) return false
    return s.providers.some((p) => p.id === chatId)
  })
}

// ─── 持久化（debounce 200ms） ────────────────────────

let persistTimer: ReturnType<typeof setTimeout> | null = null

function persist(state: AISettingsStore) {
  if (!state.hydrated) return
  const data: AISettings = {
    enabled: state.enabled,
    providers: state.providers,
    routing: state.routing,
    privacy: state.privacy,
    preferLocal: state.preferLocal,
    passiveSuggest: state.passiveSuggest,
    crawl: state.crawl,
    autoSummarize: state.autoSummarize,
  }
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    void browser.storage.local.set({ [STORAGE_KEY]: data }).catch(() => {
      /* storage 异常不影响内存 */
    })
    persistTimer = null
  }, 200)
}

// ─── 推荐预设（让用户快速起步） ──────────────────────

/**
 * 预设分组：UI 用 `<optgroup>` 渲染，让下拉不至于一长串。
 */
export type ProviderGroup = 'cn' | 'global' | 'aggregator' | 'local' | 'experimental'

export const PROVIDER_GROUP_LABEL: Record<ProviderGroup, string> = {
  cn: '🇨🇳 国内（中文友好）',
  global: '🌎 国外',
  aggregator: '🔄 聚合 / 中转',
  local: '💻 本地部署',
  experimental: '🧪 实验性',
}

export interface ProviderPreset {
  type: ProviderType
  group: ProviderGroup
  name: string
  baseURL: string
  defaultModel: string
  defaultEmbeddingModel?: string
  description: string
}

/**
 * 添加新预设的指引：
 * - group 决定下拉里出现在哪个分组
 * - defaultEmbeddingModel 仅在该 Provider 真的支持 embedding 时填，否则留空
 *   （V1.5 §5.1 语义搜索才用得到；此前完全不影响功能）
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  // ─── 🇨🇳 国内（中文友好） ───────────────────────────
  {
    type: 'openai-compatible',
    group: 'cn',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    description: '高性价比；deepseek-chat 通用 / deepseek-reasoner 推理（不支持 embedding）',
  },
  {
    type: 'openai-compatible',
    group: 'cn',
    name: 'Moonshot Kimi',
    baseURL: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    description: '长上下文友好；8k / 32k / 128k 三档',
  },
  {
    type: 'openai-compatible',
    group: 'cn',
    name: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    defaultEmbeddingModel: 'embedding-3',
    description: 'glm-4-flash 完全免费 / glm-4-plus 付费；支持 embedding',
  },
  {
    type: 'openai-compatible',
    group: 'cn',
    name: '阿里通义千问',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    defaultEmbeddingModel: 'text-embedding-v3',
    description: 'qwen-turbo 便宜 / qwen-plus 平衡 / qwen-max 最强；支持 embedding',
  },
  {
    type: 'openai-compatible',
    group: 'cn',
    name: '字节豆包',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-1-5-pro-32k-250115',
    defaultEmbeddingModel: 'doubao-embedding-text-240715',
    description: '火山引擎；超便宜 ¥0.3-¥9/1M；模型名需用 endpoint id（在火山控制台查）',
  },
  {
    type: 'openai-compatible',
    group: 'cn',
    name: '零一万物 Yi',
    baseURL: 'https://api.lingyiwanwu.com/v1',
    defaultModel: 'yi-large',
    description: 'yi-large 强 / yi-medium 平衡',
  },
  {
    type: 'openai-compatible',
    group: 'cn',
    name: 'MiniMax',
    baseURL: 'https://api.minimax.chat/v1',
    defaultModel: 'abab6.5s-chat',
    description: '中等价位，对话能力不错',
  },
  {
    type: 'openai-compatible',
    group: 'cn',
    name: '百川智能',
    baseURL: 'https://api.baichuan-ai.com/v1',
    defaultModel: 'Baichuan4',
    description: 'Baichuan4 / Baichuan3 系列',
  },

  // ─── 🌎 国外 ─────────────────────────────────────
  {
    type: 'openai-compatible',
    group: 'global',
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    defaultEmbeddingModel: 'text-embedding-3-small',
    description: '官方；gpt-4o-mini 便宜 / gpt-4o 强 / o1 推理（国内需代理）',
  },
  {
    type: 'openai-compatible',
    group: 'global',
    name: 'Azure OpenAI',
    baseURL: 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT',
    defaultModel: 'gpt-4o-mini',
    defaultEmbeddingModel: 'text-embedding-3-small',
    description: '企业首选；baseURL 需替换成你的 resource + deployment 名',
  },
  {
    type: 'openai-compatible',
    group: 'global',
    name: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    description: '⚡ 超快推理 500+ tokens/s；有免费额度；仅 OSS 模型',
  },
  {
    type: 'openai-compatible',
    group: 'global',
    name: 'Cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    defaultModel: 'llama-3.3-70b',
    description: '⚡ 超快推理；llama / qwen 系列',
  },
  {
    type: 'openai-compatible',
    group: 'global',
    name: 'Together AI',
    baseURL: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    defaultEmbeddingModel: 'BAAI/bge-large-en-v1.5',
    description: '海外聚合；几十种 OSS 模型；支持 embedding',
  },

  // ─── 🔄 聚合 / 中转 ──────────────────────────────
  {
    type: 'openai-compatible',
    group: 'aggregator',
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    description: '聚合；可访问 Claude / Gemini / GPT / Llama 等几十种模型（一个 key 通吃）',
  },
  {
    type: 'openai-compatible',
    group: 'aggregator',
    name: 'SiliconFlow 硅基流动',
    baseURL: 'https://api.siliconflow.cn/v1',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
    defaultEmbeddingModel: 'BAAI/bge-m3',
    description: '国内聚合，几十种模型；有免费额度；支持 embedding（BGE-m3 强）',
  },

  // ─── 💻 本地部署 ──────────────────────────────────
  {
    type: 'openai-compatible',
    group: 'local',
    name: 'Ollama',
    baseURL: 'http://localhost:11434/v1',
    defaultModel: 'llama3.2',
    defaultEmbeddingModel: 'nomic-embed-text',
    description: '本地部署，最易上手；apiKey 留空；先 ollama pull <model>',
  },
  {
    type: 'openai-compatible',
    group: 'local',
    name: 'LM Studio',
    baseURL: 'http://localhost:1234/v1',
    defaultModel: 'local-model',
    description: 'GUI 友好的本地服务；apiKey 留空；先在 LM Studio 启动 server',
  },
  {
    type: 'openai-compatible',
    group: 'local',
    name: 'vLLM (自部署)',
    baseURL: 'http://YOUR_HOST:8000/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    description: '高性能服务级部署；baseURL 改成你的 host',
  },

  // ─── 🧪 实验性 ────────────────────────────────────
  {
    type: 'window-ai',
    group: 'experimental',
    name: 'Chrome 内置 AI',
    baseURL: '',
    defaultModel: 'gemini-nano',
    description:
      'Chrome 138+ 本地 Gemini Nano，零成本零隐私。⚠️ 当前仅支持 en/es/ja，中文场景不推荐',
  },
]
