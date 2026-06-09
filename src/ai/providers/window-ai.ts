import type {
  AIProvider,
  AIProviderConfig,
  ChatChunk,
  ChatMessage,
  ChatOptions,
  ChatResponse,
} from '../types'

/**
 * Window.ai Provider（Chrome 内置 Gemini Nano）
 *
 * Chrome 的 Built-in AI Prompt API 命名空间在不同 Chrome 版本里位置不同：
 *   - Chrome 138+ stable：`globalThis.LanguageModel`              ← 当前主推
 *   - Chrome 中期 origin trial：`window.ai.languageModel`
 *   - Chrome 早期实验：`window.ai.assistant`                      ← 已废弃
 *
 * 本 adapter 自动探测三套 API，**任一可用即用**，调用方无感知。
 *
 * availability 状态：
 *   - 'unavailable' / 'no'           设备不支持（GPU 不足等）
 *   - 'downloadable'                  尚未下载，首次 create() 会触发下载（约 1-2GB）
 *   - 'downloading'                   正在下载（建议用户等待 / 切换到远程 Provider）
 *   - 'available' / 'readily'         立即可用
 *   - 'after-download'（旧 API）       等价于 'downloadable'
 *
 * 参考：https://developer.chrome.com/docs/ai/built-in
 */

// ─── 浏览器 API 类型（动态可选，避免 TS 报错） ─────────────

type Availability =
  | 'unavailable'
  | 'no'
  | 'downloadable'
  | 'after-download'
  | 'downloading'
  | 'available'
  | 'readily'

interface SessionLike {
  prompt: (input: string) => Promise<string>
  promptStreaming: (input: string) => AsyncIterable<string>
  destroy: () => void
}

/** 统一的 LM API（无论新旧 API 都要能给我这两件事） */
interface LMApi {
  /** 探测可用性 */
  check: () => Promise<Availability>
  /** 创建一个 session */
  create: (opts: { systemPrompt?: string }) => Promise<SessionLike>
  /** 给错误信息用，显示具体走的是哪套 API */
  source: string
}

/**
 * Chrome 138+ LanguageModel 新规范：
 *   - availability() / create() 都接受 expectedOutputs
 *   - 不传 → 浏览器在 console 打印 "No output language was specified" 警告
 *
 * 我们的本地推理用途（域名解析、英文短词、tab 分类等）只用英文输出；
 * 即便用户场景是中文，Gemini Nano 中文质量也偏弱，会自动回落到远程 Provider，
 * 所以统一声明 'en' 是当前最稳妥的方案。
 */
const LM_EXPECTED_OUTPUTS: Array<{ type: 'text'; languages: string[] }> = [
  { type: 'text', languages: ['en'] },
]

/** 探测出 Chrome 当前提供的 API；都不存在返回 null */
function detectLMApi(): LMApi | null {
  const g = globalThis as unknown as {
    LanguageModel?: {
      /** Chrome 138+：availability 也支持 expectedOutputs/Inputs 评估特定语言可用性 */
      availability?: (opts?: {
        expectedOutputs?: Array<{ type: 'text'; languages: string[] }>
      }) => Promise<Availability>
      create?: (opts?: {
        initialPrompts?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
        /** Chrome 138+ 新规范，必传以避免 "No output language" 警告 */
        expectedOutputs?: Array<{ type: 'text'; languages: string[] }>
        /** 部分中间版本的兼容字段 */
        outputLanguage?: string
      }) => Promise<SessionLike>
    }
    ai?: {
      languageModel?: {
        capabilities?: () => Promise<{ available: Availability }>
        create?: (opts?: { systemPrompt?: string }) => Promise<SessionLike>
      }
      assistant?: {
        capabilities?: () => Promise<{ available: Availability }>
        create?: (opts?: { systemPrompt?: string }) => Promise<SessionLike>
      }
    }
  }

  // 1. 新 API（Chrome 138+ stable）：globalThis.LanguageModel
  if (g.LanguageModel?.availability && g.LanguageModel?.create) {
    return {
      source: 'LanguageModel (Chrome 138+)',
      // availability 也要带上 expectedOutputs；否则 newtab 一加载就会在
      // chrome://newtab/ 控制台出现 "No output language was specified" 警告。
      // 老版本 Chrome 的 availability() 不认这个参数，但会 silently 忽略未知字段，
      // 兼容性安全。
      check: () =>
        g.LanguageModel!.availability!({ expectedOutputs: LM_EXPECTED_OUTPUTS }),
      create: async ({ systemPrompt }) => {
        // Chrome 内置 LanguageModel 当前仅支持 en / es / ja 输出，
        // 不显式指定会触发 "No output language was specified" 警告。
        return g.LanguageModel!.create!({
          initialPrompts: systemPrompt
            ? [{ role: 'system', content: systemPrompt }]
            : undefined,
          // 新规范字段（Chrome 138+）
          expectedOutputs: LM_EXPECTED_OUTPUTS,
          // 兼容部分中间版本的旧字段
          outputLanguage: 'en',
        })
      },
    }
  }

  // 2. 中期 origin trial：window.ai.languageModel
  if (g.ai?.languageModel?.capabilities && g.ai?.languageModel?.create) {
    return {
      source: 'window.ai.languageModel',
      check: async () => (await g.ai!.languageModel!.capabilities!()).available,
      create: ({ systemPrompt }) => g.ai!.languageModel!.create!({ systemPrompt }),
    }
  }

  // 3. 早期实验：window.ai.assistant（已废弃；兼容用）
  if (g.ai?.assistant?.capabilities && g.ai?.assistant?.create) {
    return {
      source: 'window.ai.assistant (旧)',
      check: async () => (await g.ai!.assistant!.capabilities!()).available,
      create: ({ systemPrompt }) => g.ai!.assistant!.create!({ systemPrompt }),
    }
  }

  return null
}

// ─── Provider 实现 ───────────────────────────────────────

export class WindowAIProvider implements AIProvider {
  readonly id: string
  readonly type = 'window-ai' as const

  constructor(config: AIProviderConfig) {
    this.id = config.id
  }

  /** 仅判定"可立即推理"，不区分中间态；调用方需要详细信息时用 detectStatus */
  static async isAvailable(): Promise<boolean> {
    const api = detectLMApi()
    if (!api) return false
    try {
      const a = await api.check()
      return a === 'available' || a === 'readily'
    } catch {
      return false
    }
  }

  /** 给 testConnection 用的详细诊断 */
  static async detectStatus(): Promise<{
    api: LMApi | null
    availability: Availability | null
    explain: string
  }> {
    const api = detectLMApi()
    if (!api) {
      return {
        api: null,
        availability: null,
        explain:
          'Chrome 内置 AI API 完全不存在。\n' +
          '需要：\n' +
          '1. Chrome 138+（chrome://version 查看版本）\n' +
          '2. 启用 chrome://flags/#prompt-api-for-gemini-nano = Enabled\n' +
          '3. 启用 chrome://flags/#optimization-guide-on-device-model = Enabled BypassPerfRequirement\n' +
          '4. 重启 Chrome',
      }
    }
    try {
      const availability = await api.check()
      let explain = ''
      switch (availability) {
        case 'available':
        case 'readily':
          explain = `本地模型已就绪（${api.source}）`
          break
        case 'downloadable':
        case 'after-download':
          explain =
            `API 已就绪，但 Gemini Nano 模型未下载（${api.source}）。\n` +
            '请前往 chrome://components 找到 "Optimization Guide On Device Model"，' +
            '点击「检查更新」触发下载（约 1-2 GB，仅需一次）。下载完成后再回来测试。'
          break
        case 'downloading':
          explain =
            `Gemini Nano 模型正在下载中（${api.source}）。\n` +
            '请等待下载完成（chrome://components 可查看进度）。'
          break
        case 'unavailable':
        case 'no':
        default:
          explain =
            `当前设备硬件不满足要求（${api.source}）。\n` +
            'Chrome 内置 AI 需要：\n' +
            '• 至少 22 GB 可用磁盘空间\n' +
            '• 至少 4 GB 显存（独立显卡或集成显卡 vRAM）\n' +
            '• Windows 10/11 / macOS 13+ / 桌面版 Linux（移动端暂不支持）\n' +
            '建议改用远程 Provider（DeepSeek / OpenAI 等）。'
          break
      }
      return { api, availability, explain }
    } catch (err) {
      return {
        api,
        availability: null,
        explain:
          `探测可用性时报错（${api.source}）：` +
          (err instanceof Error ? err.message : String(err)),
      }
    }
  }

  // ─── chat ─────────────────────────────────────────────

  async chat(opts: ChatOptions): Promise<ChatResponse> {
    const session = await this.createSession(opts)
    try {
      const merged = mergeMessagesToPrompt(opts.messages)
      const text = await session.prompt(merged)
      return { text, model: 'gemini-nano (window.ai)' }
    } finally {
      session.destroy()
    }
  }

  // ─── chatStream ───────────────────────────────────────

  async *chatStream(opts: ChatOptions): AsyncGenerator<ChatChunk, void, void> {
    const session = await this.createSession(opts)
    try {
      const merged = mergeMessagesToPrompt(opts.messages)
      const stream = session.promptStreaming(merged)
      let prev = ''
      for await (const chunk of stream) {
        // window.ai 流式输出是「累积」的全文，我们要换算成 delta
        const delta = chunk.slice(prev.length)
        prev = chunk
        if (delta) yield { delta }
      }
      yield { delta: '', done: true }
    } finally {
      session.destroy()
    }
  }

  // ─── testConnection ───────────────────────────────────

  async testConnection(): Promise<{ ok: boolean; message?: string; latencyMs?: number }> {
    const status = await WindowAIProvider.detectStatus()
    if (!status.api) {
      return { ok: false, message: status.explain }
    }
    if (status.availability !== 'available' && status.availability !== 'readily') {
      return { ok: false, message: status.explain }
    }
    // 真实跑一次
    const start = Date.now()
    try {
      const r = await this.chat({
        messages: [{ role: 'user', content: 'Say "ok"' }],
        maxTokens: 5,
      })
      const latencyMs = Date.now() - start
      return r.text
        ? {
            ok: true,
            latencyMs,
            message: `本地 AI 可用（${status.api.source}，${latencyMs}ms）`,
          }
        : { ok: false, message: '本地 AI 返回空响应' }
    } catch (err) {
      return {
        ok: false,
        message:
          `调用失败（${status.api.source}）：` +
          (err instanceof Error ? err.message : String(err)),
      }
    }
  }

  // ─── 内部工具 ─────────────────────────────────────────

  private async createSession(opts: ChatOptions): Promise<SessionLike> {
    const api = detectLMApi()
    if (!api) {
      throw new Error('Chrome 内置 AI API 不存在；请检查浏览器版本与 chrome://flags 配置')
    }
    // 把 system message 提取出来作为 initialPrompts / systemPrompt
    const systemPrompt = opts.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    return api.create({ systemPrompt: systemPrompt || undefined })
  }
}

/** 把多轮 messages 合并成单字符串 prompt（window.ai 不支持多轮 message 数组） */
function mergeMessagesToPrompt(messages: ChatMessage[]): string {
  const lines: string[] = []
  for (const m of messages) {
    if (m.role === 'system') continue // system 已通过 systemPrompt / initialPrompts 传入
    const prefix = m.role === 'user' ? 'User' : 'Assistant'
    lines.push(`${prefix}: ${m.content}`)
  }
  lines.push('Assistant:')
  return lines.join('\n')
}
