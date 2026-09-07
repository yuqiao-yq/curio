import { requireSiteAccess } from '../../services/sitePermissions'
import type { AIProvider, AIProviderConfig, ChatChunk, ChatOptions, ChatResponse } from '../types'

/**
 * OpenAI Compatible Provider
 *
 * 一套 adapter 适配几乎所有主流 LLM 服务（请求体格式都对齐 OpenAI Chat Completions API）：
 *   - OpenAI 官方
 *   - Azure OpenAI
 *   - DeepSeek      (https://api.deepseek.com/v1)
 *   - 智谱 GLM      (https://open.bigmodel.cn/api/paas/v4)
 *   - Moonshot      (https://api.moonshot.cn/v1)
 *   - Together.ai   (https://api.together.xyz/v1)
 *   - Groq          (https://api.groq.com/openai/v1)
 *   - OpenRouter    (https://openrouter.ai/api/v1)
 *   - SiliconFlow   (https://api.siliconflow.cn/v1)
 *   - 自部署 Ollama  (http://localhost:11434/v1)
 *   - 自部署 vLLM    (http://your-host/v1)
 *
 * 注意：
 * - 用 fetch 原生实现，不引第三方 SDK，控包体积
 * - 支持流式（SSE 解析）
 * - apiKey 通过 Bearer 头发送；某些服务（如 Ollama）不需要 key 时留空即可
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly id: string
  readonly type = 'openai-compatible' as const

  private baseURL: string
  private apiKey: string
  private model: string
  private embeddingModel?: string

  constructor(config: AIProviderConfig) {
    this.id = config.id
    this.baseURL = (config.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '')
    this.apiKey = config.apiKey || ''
    this.model = config.model
    this.embeddingModel = config.embeddingModel
  }

  // ─── chat ─────────────────────────────────────────────

  async chat(opts: ChatOptions): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.3,
      stream: false,
    }
    if (opts.maxTokens) body.max_tokens = opts.maxTokens
    if (opts.responseFormat === 'json') {
      // OpenAI 4o+ / DeepSeek 等支持 json_object；不支持的服务会忽略此字段，不会报错
      body.response_format = { type: 'json_object' }
    }

    const res = await this.fetch('/chat/completions', body, opts.signal)
    if (!res.ok) {
      throw await this.toError(res)
    }
    const data = await res.json()
    const choice = data.choices?.[0]
    return {
      text: choice?.message?.content ?? '',
      model: data.model,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens ?? 0,
            completionTokens: data.usage.completion_tokens ?? 0,
          }
        : undefined,
    }
  }

  // ─── chatStream ───────────────────────────────────────

  async *chatStream(opts: ChatOptions): AsyncGenerator<ChatChunk, void, void> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.3,
      stream: true,
    }
    if (opts.maxTokens) body.max_tokens = opts.maxTokens

    const res = await this.fetch('/chat/completions', body, opts.signal)
    if (!res.ok) {
      throw await this.toError(res)
    }
    if (!res.body) {
      throw new Error('streaming response missing body')
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // SSE: 每条事件以 "\n\n" 分隔；每行以 "data: " 开头
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const evt of events) {
          const line = evt.split('\n').find((l) => l.startsWith('data:'))
          if (!line) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') {
            yield { delta: '', done: true }
            return
          }
          try {
            const json = JSON.parse(payload)
            const delta = json.choices?.[0]?.delta?.content ?? ''
            const usage = json.usage
              ? {
                  promptTokens: json.usage.prompt_tokens ?? 0,
                  completionTokens: json.usage.completion_tokens ?? 0,
                }
              : undefined
            if (delta || usage) {
              yield { delta, usage }
            }
          } catch {
            // 忽略半包 / 非 JSON 行
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  // ─── embedding ────────────────────────────────────────

  async embedding(input: string[]): Promise<number[][]> {
    const model = this.embeddingModel ?? 'text-embedding-3-small'
    const res = await this.fetch('/embeddings', {
      model,
      input,
    })
    if (!res.ok) throw await this.toError(res)
    const data = await res.json()
    return (data.data ?? []).map((d: { embedding: number[] }) => d.embedding)
  }

  // ─── testConnection ───────────────────────────────────

  async testConnection(): Promise<{ ok: boolean; message?: string; latencyMs?: number }> {
    const start = Date.now()
    try {
      const res = await this.chat({
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 5,
        temperature: 0,
      })
      const latencyMs = Date.now() - start
      if (res.text) {
        return { ok: true, latencyMs, message: `连接正常 (${latencyMs}ms)` }
      }
      return { ok: false, message: '返回空响应，请检查模型名称' }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // ─── 内部工具 ─────────────────────────────────────────

  private async fetch(path: string, body: object, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }
    await requireSiteAccess(this.baseURL)
    return fetch(`${this.baseURL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })
  }

  private async toError(res: Response): Promise<Error> {
    let detail = ''
    try {
      const data = await res.json()
      detail = data?.error?.message ?? data?.message ?? JSON.stringify(data).slice(0, 200)
    } catch {
      try {
        detail = await res.text()
      } catch {
        /* ignore */
      }
    }
    return new Error(`HTTP ${res.status}: ${detail || res.statusText}`)
  }
}
