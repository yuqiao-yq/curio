/**
 * LocalRepository 测试
 *
 * 守住数据层最关键的两类行为：
 *  1. bulkImport (merge / replace) —— 用户最容易丢数据的地方
 *  2. bulkExport ↔ bulkImport 圆环 —— 备份恢复必须无损
 *  3. 级联删除：删父分类要带走全部后代分类 + 其下卡片
 */
import { afterEach, describe, expect, it } from 'vitest'
import { LocalRepository } from './LocalRepository'
import type {
  BookmarkCard,
  Category,
  ExportData,
  UserSettings,
} from '../types/bookmark'
import { DEFAULT_SETTINGS } from '../types/bookmark'

// ─── helpers ──────────────────────────────────────────

function mkCat(over: Partial<Category> = {}): Category {
  return {
    id: 'cat1',
    name: 'Default',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function mkCard(over: Partial<BookmarkCard> = {}): BookmarkCard {
  return {
    id: 'card1',
    categoryId: 'cat1',
    title: 'Example',
    url: 'https://example.com/',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function mkExport(over: Partial<ExportData> = {}): ExportData {
  return {
    version: '1.0',
    exportedAt: 0,
    categories: [],
    cards: [],
    ...over,
  }
}

afterEach(async () => {
  // setup.ts 在 beforeEach 已 reset storage；这里再清一次 clear() 调过的产物，幂等
  const repo = new LocalRepository()
  await repo.clear()
})

// ─── 基础 CRUD ────────────────────────────────────────

describe('LocalRepository: 基础读写', () => {
  it('saveCard 后能读回，且按 order 排序', async () => {
    const repo = new LocalRepository()
    await repo.saveCard(mkCard({ id: 'b', order: 2 }))
    await repo.saveCard(mkCard({ id: 'a', order: 1 }))
    const list = await repo.getCards()
    expect(list.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('saveCategories 写入时刷新 updatedAt', async () => {
    const repo = new LocalRepository()
    const before = Date.now()
    await repo.saveCategories([mkCat({ id: 'x', updatedAt: 1 })])
    const [got] = await repo.getCategories()
    expect(got.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('getSettings 返回 DEFAULT 与已写入的合并值', async () => {
    const repo = new LocalRepository()
    const got = await repo.getSettings()
    // 未写过 → 全部 DEFAULT
    expect(got).toEqual(DEFAULT_SETTINGS)

    await repo.saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' })
    const got2 = await repo.getSettings()
    expect(got2.theme).toBe('dark')
    expect(got2.layout).toBe(DEFAULT_SETTINGS.layout)
  })

  it("getSettings 把老 cardSize 'sm'/'md'/'lg' 迁移到新枚举", async () => {
    const repo = new LocalRepository()
    // 直接绕过 saveSettings 写入"老格式"值
    await chrome.storage.local.set({
      'curio:settings': { ...DEFAULT_SETTINGS, cardSize: 'sm' },
    })
    const s1 = await repo.getSettings()
    expect(s1.cardSize).toBe('standard')

    await chrome.storage.local.set({
      'curio:settings': { ...DEFAULT_SETTINGS, cardSize: 'md' },
    })
    const s2 = await repo.getSettings()
    expect(s2.cardSize).toBe('large')

    await chrome.storage.local.set({
      'curio:settings': { ...DEFAULT_SETTINGS, cardSize: 'lg' },
    })
    const s3 = await repo.getSettings()
    expect(s3.cardSize).toBe('large')
  })
})

// ─── 级联删除 ──────────────────────────────────────────

describe('LocalRepository: 级联删除', () => {
  it('deleteCategory 同时清掉该分类下的所有卡片', async () => {
    const repo = new LocalRepository()
    await repo.saveCategories([mkCat({ id: 'cat1' }), mkCat({ id: 'cat2' })])
    await repo.saveCards([
      mkCard({ id: 'c1', categoryId: 'cat1' }),
      mkCard({ id: 'c2', categoryId: 'cat1' }),
      mkCard({ id: 'c3', categoryId: 'cat2' }),
    ])
    await repo.deleteCategory('cat1')
    expect((await repo.getCategories()).map((c) => c.id)).toEqual(['cat2'])
    expect((await repo.getCards()).map((c) => c.id)).toEqual(['c3'])
  })

  it('deleteCategory 会递归带走所有后代分类（BFS）', async () => {
    const repo = new LocalRepository()
    // root → child → grandchild
    await repo.saveCategories([
      mkCat({ id: 'root' }),
      mkCat({ id: 'child', parentId: 'root' }),
      mkCat({ id: 'grandchild', parentId: 'child' }),
      mkCat({ id: 'sibling' }), // 同辈，不应被删
    ])
    await repo.saveCards([
      mkCard({ id: 'card-in-grandchild', categoryId: 'grandchild' }),
      mkCard({ id: 'card-in-sibling', categoryId: 'sibling' }),
    ])
    await repo.deleteCategory('root')
    expect((await repo.getCategories()).map((c) => c.id)).toEqual(['sibling'])
    expect((await repo.getCards()).map((c) => c.id)).toEqual(['card-in-sibling'])
  })
})

// ─── bulkImport: replace 模式 ─────────────────────────

describe('LocalRepository.bulkImport: replace', () => {
  it('完全覆盖本地数据（含 settings）', async () => {
    const repo = new LocalRepository()
    // 先放一些本地数据
    await repo.saveCategories([mkCat({ id: 'old' })])
    await repo.saveCards([mkCard({ id: 'old-card', categoryId: 'old' })])
    await repo.saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' })

    const data: ExportData = mkExport({
      categories: [mkCat({ id: 'new' })],
      cards: [mkCard({ id: 'new-card', categoryId: 'new' })],
      settings: { ...DEFAULT_SETTINGS, theme: 'light' } as UserSettings,
    })
    const result = await repo.bulkImport(data, 'replace')

    expect(result.mode).toBe('replace')
    expect(result.categoriesAdded).toBe(1)
    expect(result.cardsAdded).toBe(1)
    expect((await repo.getCategories()).map((c) => c.id)).toEqual(['new'])
    expect((await repo.getCards()).map((c) => c.id)).toEqual(['new-card'])
    expect((await repo.getSettings()).theme).toBe('light')
  })

  it('replace 模式接收空数组 → 清空本地', async () => {
    const repo = new LocalRepository()
    await repo.saveCategories([mkCat({ id: 'old' })])
    await repo.bulkImport(mkExport(), 'replace')
    expect(await repo.getCategories()).toEqual([])
    expect(await repo.getCards()).toEqual([])
  })
})

// ─── bulkImport: merge 模式（默认） ───────────────────

describe('LocalRepository.bulkImport: merge（默认）', () => {
  it('新增 id 追加到末尾，分配新 order', async () => {
    const repo = new LocalRepository()
    await repo.saveCategories([mkCat({ id: 'a', order: 0 }), mkCat({ id: 'b', order: 1 })])
    const data = mkExport({
      categories: [mkCat({ id: 'c', order: 0 })], // 注意：incoming order 应被本地 maxOrder+1 覆盖
    })
    const result = await repo.bulkImport(data, 'merge')
    expect(result.categoriesAdded).toBe(1)
    expect(result.categoriesUpdated).toBe(0)
    const cats = await repo.getCategories()
    expect(cats.map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(cats[2].order).toBe(2) // 追加到末尾
  })

  it('同 id 且 incoming.updatedAt 更新 → 覆盖（保留本地 order）', async () => {
    const repo = new LocalRepository()
    // 直接写 storage 绕过 saveCategories（它会用 Date.now() 覆盖 updatedAt）
    await chrome.storage.local.set({
      'curio:categories': [mkCat({ id: 'a', name: 'old', order: 5, updatedAt: 100 })],
    })
    const data = mkExport({
      categories: [mkCat({ id: 'a', name: 'new', order: 999, updatedAt: 200 })],
    })
    const result = await repo.bulkImport(data, 'merge')
    expect(result.categoriesUpdated).toBe(1)
    expect(result.categoriesAdded).toBe(0)
    const cats = await repo.getCategories()
    expect(cats[0].name).toBe('new')
    expect(cats[0].order).toBe(5) // 本地 order 必须保留，避免抖动
  })

  it('同 id 且 incoming.updatedAt 较旧 → 保留本地（不变）', async () => {
    const repo = new LocalRepository()
    await chrome.storage.local.set({
      'curio:categories': [mkCat({ id: 'a', name: 'local', updatedAt: 200 })],
    })
    const data = mkExport({
      categories: [mkCat({ id: 'a', name: 'stale', updatedAt: 100 })],
    })
    const result = await repo.bulkImport(data, 'merge')
    expect(result.categoriesUpdated).toBe(0)
    const [got] = await repo.getCategories()
    expect(got.name).toBe('local')
  })

  it('merge 不覆盖本地 settings（即使 data.settings 存在）', async () => {
    const repo = new LocalRepository()
    await repo.saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' })
    await repo.bulkImport(
      mkExport({ settings: { ...DEFAULT_SETTINGS, theme: 'light' } as UserSettings }),
      'merge',
    )
    expect((await repo.getSettings()).theme).toBe('dark')
  })

  it('卡片 merge：同 categoryId 内追加 order；保留本地 order', async () => {
    const repo = new LocalRepository()
    await chrome.storage.local.set({
      'curio:categories': [mkCat({ id: 'cat1' })],
      'curio:cards': [
        mkCard({ id: 'a', categoryId: 'cat1', order: 0, updatedAt: 50 }),
        mkCard({ id: 'b', categoryId: 'cat1', order: 1, updatedAt: 100 }),
      ],
    })
    const data = mkExport({
      cards: [
        mkCard({ id: 'b', categoryId: 'cat1', order: 999, title: 'updated', updatedAt: 200 }),
        mkCard({ id: 'c', categoryId: 'cat1', order: 0 }),
      ],
    })
    const result = await repo.bulkImport(data, 'merge')
    expect(result.cardsAdded).toBe(1)
    expect(result.cardsUpdated).toBe(1)
    const cards = await repo.getCards()
    const ids = cards.map((c) => c.id)
    expect(ids).toEqual(['a', 'b', 'c'])
    expect(cards[1].title).toBe('updated')
    expect(cards[1].order).toBe(1) // 保留本地 order
    expect(cards[2].order).toBe(2) // 新卡追加到末尾
  })
})

// ─── export ↔ import 圆环 ──────────────────────────────

describe('LocalRepository: export ↔ import 圆环', () => {
  it('bulkExport 输出 v1.0 格式 + 当前时间', async () => {
    const repo = new LocalRepository()
    await repo.saveCategories([mkCat()])
    const before = Date.now()
    const data = await repo.bulkExport()
    expect(data.version).toBe('1.0')
    expect(data.exportedAt).toBeGreaterThanOrEqual(before)
    expect(data.categories).toHaveLength(1)
    expect(data.cards).toEqual([])
    expect(data.settings).toBeDefined()
  })

  it('export → clear → import(replace) 完整恢复', async () => {
    const repo = new LocalRepository()
    await repo.saveCategories([mkCat({ id: 'a', name: 'A' }), mkCat({ id: 'b', name: 'B' })])
    await repo.saveCards([
      mkCard({ id: 'c1', categoryId: 'a' }),
      mkCard({ id: 'c2', categoryId: 'b' }),
    ])
    await repo.saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' })

    const snapshot = await repo.bulkExport()
    await repo.clear()
    expect(await repo.getCategories()).toEqual([])

    await repo.bulkImport(snapshot, 'replace')

    expect((await repo.getCategories()).map((c) => c.id).sort()).toEqual(['a', 'b'])
    expect((await repo.getCards()).map((c) => c.id).sort()).toEqual(['c1', 'c2'])
    expect((await repo.getSettings()).theme).toBe('dark')
  })

  it('JSON.stringify ↔ JSON.parse 不丢失数据（备份场景）', async () => {
    const repo = new LocalRepository()
    await repo.saveCategories([mkCat({ id: 'a', description: '含中文 / "引号" / \\反斜杠' })])
    await repo.saveCards([
      mkCard({ id: 'c1', tags: ['#日常', '🎯 目标', ''] }),
    ])
    const data = await repo.bulkExport()
    const restored = JSON.parse(JSON.stringify(data)) as ExportData

    await repo.clear()
    await repo.bulkImport(restored, 'replace')

    const cats = await repo.getCategories()
    expect(cats[0].description).toBe('含中文 / "引号" / \\反斜杠')
    const cards = await repo.getCards()
    expect(cards[0].tags).toEqual(['#日常', '🎯 目标', ''])
  })
})
