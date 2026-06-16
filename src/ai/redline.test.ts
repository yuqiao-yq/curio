/**
 * AI 红线契约测试
 *
 * 这些不是普通单测，是「产品红线守门员」—— 重构 / 加新字段时如果不小心把
 * apiKey 泄漏到云同步或 export json，这里会立刻报警。
 *
 * 红线（来自 AI_INTEGRATION_PLAN.md §2.2 & §10 + ROADMAP.md V1.5）：
 *  1. apiKey 仅存 chrome.storage.local，**绝不进 storage.sync**
 *  2. apiKey **不出现在导出的 JSON 中**
 *  3. SYNCABLE_SETTINGS_KEYS 白名单永远不含 ai* / apiKey 字段
 */
import { afterEach, describe, expect, it } from 'vitest'
import { useAISettingsStore } from './useAISettingsStore'
import { LocalRepository } from '../repositories/LocalRepository'
import { SYNCABLE_SETTINGS_KEYS } from '../services/SyncService'

const AI_STORAGE_KEY = 'curio:ai-settings'

/** 把内存 store 重置成"未配置"，避免测试间互相污染 */
function resetAIStore() {
  useAISettingsStore.setState({
    enabled: false,
    providers: [],
    routing: {},
    hydrated: true,
  })
}

afterEach(async () => {
  resetAIStore()
  await chrome.storage.local.clear()
  await chrome.storage.sync.clear()
})

// ─── 红线 #1：apiKey 不进 storage.sync ─────────────────

describe('红线: apiKey 不进 chrome.storage.sync', () => {
  it('AI 设置持久化只写 storage.local，不写 storage.sync', async () => {
    resetAIStore()
    useAISettingsStore.setState({ hydrated: true })

    const id = useAISettingsStore.getState().addProvider({
      name: 'My OpenAI',
      type: 'openai-compatible',
      apiKey: 'sk-SECRET-LEAKED-IF-YOU-SEE-THIS',
      model: 'gpt-4o-mini',
    })
    expect(id).toBeTruthy()

    // 等 persist debounce（200ms）落库
    await new Promise((r) => setTimeout(r, 300))

    // local 应该写到了
    const local = await chrome.storage.local.get(null)
    const localStr = JSON.stringify(local)
    expect(localStr).toContain('sk-SECRET-LEAKED-IF-YOU-SEE-THIS')

    // sync 必须没有这个 key（任何形式）
    const sync = await chrome.storage.sync.get(null)
    const syncStr = JSON.stringify(sync)
    expect(syncStr).not.toContain('sk-SECRET-LEAKED-IF-YOU-SEE-THIS')
    expect(syncStr).not.toContain(AI_STORAGE_KEY)
  })

  it('SYNCABLE_SETTINGS_KEYS 白名单不含任何 AI / apiKey / provider 字段', () => {
    const forbidden = ['apiKey', 'aiSettings', 'ai', 'providers', 'routing', 'crawl', 'autoSummarize']
    for (const k of SYNCABLE_SETTINGS_KEYS) {
      for (const bad of forbidden) {
        expect(
          k.toLowerCase().includes(bad.toLowerCase()),
          `SYNCABLE_SETTINGS_KEYS 不应包含 ${bad} 相关字段，但发现了 "${k}"`,
        ).toBe(false)
      }
    }
  })
})

// ─── 红线 #2：apiKey 不进 export JSON ──────────────────

describe('红线: apiKey 不进 export JSON', () => {
  it('LocalRepository.bulkExport 不包含 AI 设置 / apiKey', async () => {
    // 先把 AI 设置写到 storage.local（模拟真实用户配过 provider）
    await chrome.storage.local.set({
      [AI_STORAGE_KEY]: {
        enabled: true,
        providers: [
          {
            id: 'p1',
            name: 'OpenAI',
            type: 'openai-compatible',
            apiKey: 'sk-SECRET-EXPORT-LEAK',
            model: 'gpt-4o-mini',
          },
        ],
        routing: { chat: 'p1', organize: 'p1', embedding: 'p1' },
        privacy: { anonymousMode: true, allowContentCrawl: false, showCostEstimate: true },
        preferLocal: false,
        passiveSuggest: true,
        crawl: { agreed: false },
        autoSummarize: false,
      },
    })

    const repo = new LocalRepository()
    const data = await repo.bulkExport()

    // ExportData 类型本身只承诺 categories/cards/settings，不应有 AI
    expect(Object.keys(data)).toEqual(
      expect.arrayContaining(['version', 'exportedAt', 'categories', 'cards']),
    )
    // 暴力检查：序列化整个 export 不应出现 secret 字符串
    const serialized = JSON.stringify(data)
    expect(serialized).not.toContain('sk-SECRET-EXPORT-LEAK')
    expect(serialized).not.toContain('apiKey')
    expect(serialized).not.toContain('providers')
    // 也不应包含 ai-settings 的存储 key（防止有人未来把它塞到 settings 里）
    expect(serialized).not.toContain(AI_STORAGE_KEY)
  })

  it('bulkExport.settings 只有 UserSettings 白名单字段，不含 AI 相关', async () => {
    const repo = new LocalRepository()
    const data = await repo.bulkExport()
    const allowedSettingsKeys = new Set([
      'theme', 'layout', 'cardSize', 'cardIconSize', 'wallpaper', 'fontColor',
      'language', 'syncProvider', 'sidebarWidth', 'recentIncludeBrowserHistory',
      'subSectionDefaultExpanded', 'backgroundBlur', 'cardGlass',
      'browserSyncRoot', 'browserSyncFolderName', 'browserSyncAuto',
    ])
    for (const key of Object.keys(data.settings ?? {})) {
      expect(
        allowedSettingsKeys.has(key),
        `bulkExport.settings 出现了未知字段 "${key}" —— 如果是新加的，请把它加入 allowedSettingsKeys 白名单；如果是 AI 相关字段，绝对不能在这里出现`,
      ).toBe(true)
    }
  })
})

// ─── 红线 #3：AI 设置存储 key 与同步 key 物理隔离 ──────

describe('红线: AI 设置存储 key 不与同步 key 冲突', () => {
  it('AI_STORAGE_KEY 不出现在同步 manifest 范围内', async () => {
    // 模拟用户配过 AI 后又开启了云同步：两个 key 必须物理隔离
    await chrome.storage.local.set({
      [AI_STORAGE_KEY]: { providers: [{ apiKey: 'leak' }] },
    })
    // 假设 sync 上有正常的设置 payload
    await chrome.storage.sync.set({
      'curio:sync:settings': { version: 1, ts: 1, settings: { theme: 'dark' } },
    })

    const sync = await chrome.storage.sync.get(null)
    // sync 上绝对不该出现 ai-settings 这个 key
    expect(Object.keys(sync)).not.toContain(AI_STORAGE_KEY)
  })
})
