import { describe, expect, it, vi } from 'vitest'
import {
  applyStylePreset,
  buildPresetExport,
  mergeUserPresets,
  parsePresetImport,
  pickPresettable,
} from './stylePreset'
import {
  type StylePreset,
  type UserSettings,
} from '../types/bookmark'

const baseSettings: UserSettings = {
  theme: 'auto',
  layout: 'grid',
  cardSize: 'standard',
  cardIconSize: 'standard',
  language: 'zh-CN',
  syncProvider: 'local',
  wallpaper: 'linear-gradient(...)',
  fontColor: '#0f172a',
  sidebarWidth: 240, // 黑名单字段
  recentIncludeBrowserHistory: true, // 黑名单字段
}

function mkPreset(over: Partial<StylePreset> = {}): StylePreset {
  return {
    id: 'p1',
    name: 'X',
    kind: 'user',
    settings: {},
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

// ─── pickPresettable ──────────────────────────────────

describe('pickPresettable', () => {
  it('只挑白名单字段，跳过 syncProvider / sidebarWidth 等', () => {
    const picked = pickPresettable(baseSettings)
    expect(picked.theme).toBe('auto')
    expect(picked.wallpaper).toBe('linear-gradient(...)')
    expect(picked.fontColor).toBe('#0f172a')
    expect(picked.cardSize).toBe('standard')
    // 黑名单
    expect('syncProvider' in picked).toBe(false)
    expect('sidebarWidth' in picked).toBe(false)
    expect('recentIncludeBrowserHistory' in picked).toBe(false)
    expect('layout' in picked).toBe(false)
    expect('language' in picked).toBe(false)
  })

  it('undefined 字段不进入结果', () => {
    const picked = pickPresettable({
      ...baseSettings,
      wallpaper: undefined,
      fontColor: undefined,
    })
    expect('wallpaper' in picked).toBe(false)
    expect('fontColor' in picked).toBe(false)
  })
})

// ─── applyStylePreset ─────────────────────────────────

describe('applyStylePreset', () => {
  it('把预设 settings 整段 spread 给 updateSettings', async () => {
    const update = vi.fn(async () => {})
    const preset = mkPreset({
      settings: { theme: 'dark', cardSize: 'custom', cardCustomWidthMin: 200 },
    })
    await applyStylePreset(preset, update)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({
      theme: 'dark',
      cardSize: 'custom',
      cardCustomWidthMin: 200,
    })
  })
})

// ─── parsePresetImport ────────────────────────────────

describe('parsePresetImport', () => {
  it('合法 JSON：返回预设数组，全部强制 kind=user', () => {
    const json = JSON.stringify({
      version: 1,
      exportedAt: 1234,
      presets: [
        mkPreset({ id: 'a', name: 'A', settings: { theme: 'dark' } }),
        mkPreset({
          id: 'b',
          name: 'B',
          // 故意写 kind: 'builtin'，应该被强制改成 'user'
          kind: 'builtin',
          settings: { cardSize: 'compact' },
        }),
      ],
    })
    const list = parsePresetImport(json)!
    expect(list).toHaveLength(2)
    expect(list.every((p) => p.kind === 'user')).toBe(true)
    expect(list[0].settings.theme).toBe('dark')
    expect(list[1].settings.cardSize).toBe('compact')
  })

  it('坏 JSON → null', () => {
    expect(parsePresetImport('not json')).toBeNull()
    expect(parsePresetImport('null')).toBeNull()
    expect(parsePresetImport('[]')).toBeNull()
  })

  it('顶层缺 presets 字段 → null', () => {
    expect(parsePresetImport(JSON.stringify({ version: 1 }))).toBeNull()
  })

  it('单个坏预设跳过但其它项继续', () => {
    const json = JSON.stringify({
      version: 1,
      presets: [
        { id: 'a', name: 'A', settings: { theme: 'dark' }, createdAt: 0, updatedAt: 0 },
        { id: '', name: 'badId', settings: {} }, // 缺 id → 跳
        { id: 'c', name: 'C', settings: 'not-object' }, // 错类型 → 跳
        { id: 'd', name: 'D', settings: { cardSize: 'standard' } }, // 通
      ],
    })
    const list = parsePresetImport(json)!
    expect(list.map((p) => p.id)).toEqual(['a', 'd'])
  })

  it('settings 内非法字段类型被丢弃但条目仍保留', () => {
    const json = JSON.stringify({
      version: 1,
      presets: [
        {
          id: 'a',
          name: 'A',
          settings: {
            theme: 'dark',
            wallpaper: { evil: true }, // 错类型 → 丢
            cardSize: 'standard',
            unknownField: 'leaked', // 不在白名单 → 丢
          },
        },
      ],
    })
    const list = parsePresetImport(json)!
    expect(list).toHaveLength(1)
    expect(list[0].settings.theme).toBe('dark')
    expect(list[0].settings.cardSize).toBe('standard')
    expect('wallpaper' in list[0].settings).toBe(false)
    expect('unknownField' in list[0].settings).toBe(false)
  })
})

// ─── buildPresetExport ────────────────────────────────

describe('buildPresetExport', () => {
  it('只导出 user 预设；带版本号 + ts', () => {
    const out = buildPresetExport([
      mkPreset({ id: 'u1', kind: 'user' }),
      mkPreset({ id: 'b1', kind: 'builtin' }), // 应被过滤
      mkPreset({ id: 'u2', kind: 'user' }),
    ])
    const data = JSON.parse(out)
    expect(data.version).toBe(1)
    expect(typeof data.exportedAt).toBe('number')
    expect(data.presets).toHaveLength(2)
    expect(data.presets.map((p: StylePreset) => p.id)).toEqual(['u1', 'u2'])
  })
})

// ─── mergeUserPresets ─────────────────────────────────

describe('mergeUserPresets', () => {
  it('id 冲突时 updatedAt 大者胜', () => {
    const existing = [mkPreset({ id: 'a', name: '旧 A', updatedAt: 100 })]
    const incoming = [mkPreset({ id: 'a', name: '新 A', updatedAt: 200 })]
    const merged = mergeUserPresets(existing, incoming)
    expect(merged).toHaveLength(1)
    expect(merged[0].name).toBe('新 A')
  })

  it('旧版（updatedAt 较小）不覆盖新版', () => {
    const existing = [mkPreset({ id: 'a', name: '新版', updatedAt: 200 })]
    const incoming = [mkPreset({ id: 'a', name: '老版', updatedAt: 100 })]
    const merged = mergeUserPresets(existing, incoming)
    expect(merged[0].name).toBe('新版')
  })

  it('不同 id 全部保留，按 createdAt 排序', () => {
    const existing = [mkPreset({ id: 'a', createdAt: 100 })]
    const incoming = [
      mkPreset({ id: 'b', createdAt: 50 }),
      mkPreset({ id: 'c', createdAt: 200 }),
    ]
    const merged = mergeUserPresets(existing, incoming)
    expect(merged.map((p) => p.id)).toEqual(['b', 'a', 'c'])
  })

  it('忽略 builtin 项（防污染落地）', () => {
    const existing = [mkPreset({ id: 'a', kind: 'user' })]
    const incoming = [mkPreset({ id: 'fake-builtin', kind: 'builtin' })]
    const merged = mergeUserPresets(existing, incoming)
    expect(merged.map((p) => p.id)).toEqual(['a'])
  })
})
