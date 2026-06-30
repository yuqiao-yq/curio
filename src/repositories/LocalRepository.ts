import { browser } from 'wxt/browser'
import type {
  BookmarkCard,
  Category,
  ExportData,
  UserSettings,
} from '../types/bookmark'
import { DEFAULT_SETTINGS } from '../types/bookmark'
import type {
  BookmarkRepository,
  BulkImportMode,
  BulkImportResult,
} from './types'

const KEYS = {
  categories: 'curio:categories',
  cards: 'curio:cards',
  settings: 'curio:settings',
} as const

/**
 * 基于 browser.storage.local 的本地实现。
 *
 * 适用场景：
 * - V1 MVP 全量数据
 * - V2 离线缓存
 *
 * 容量限制：5MB（够存数千个书签元数据）。
 * 大体积数据（缩略图等）后续迁到 Dexie/IndexedDB。
 *
 * 注意：必须使用 wxt/browser 导出的 `browser`（在 Firefox 下指向原生
 * `globalThis.browser`，是 Promise-based；在 Chrome 下指向 `globalThis.chrome`）。
 * 直接使用 `chrome.*` 在 Firefox 下不会返回 Promise，会导致 await 拿到 undefined。
 */
export class LocalRepository implements BookmarkRepository {
  // ---------- helpers ----------
  private async readArray<T>(key: string): Promise<T[]> {
    const result = await browser.storage.local.get(key)
    return (result[key] as T[]) ?? []
  }

  private async writeArray<T>(key: string, value: T[]): Promise<void> {
    await browser.storage.local.set({ [key]: value })
  }

  // ---------- 分类 ----------
  async getCategories(): Promise<Category[]> {
    const list = await this.readArray<Category>(KEYS.categories)
    return list.sort((a, b) => a.order - b.order)
  }

  async saveCategory(cat: Category): Promise<void> {
    const list = await this.readArray<Category>(KEYS.categories)
    const idx = list.findIndex((c) => c.id === cat.id)
    if (idx >= 0) {
      list[idx] = { ...cat, updatedAt: Date.now() }
    } else {
      list.push({ ...cat, updatedAt: Date.now() })
    }
    await this.writeArray(KEYS.categories, list)
  }

  async saveCategories(cats: Category[]): Promise<void> {
    if (cats.length === 0) return
    const list = await this.readArray<Category>(KEYS.categories)
    const map = new Map(list.map((c) => [c.id, c]))
    const now = Date.now()
    for (const c of cats) {
      map.set(c.id, { ...c, updatedAt: now })
    }
    await this.writeArray(KEYS.categories, Array.from(map.values()))
  }

  async deleteCategory(id: string): Promise<void> {
    await this.deleteCategories([id])
  }

  async deleteCategories(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const [cats, cards] = await Promise.all([
      this.readArray<Category>(KEYS.categories),
      this.readArray<BookmarkCard>(KEYS.cards),
    ])
    // 级联找到所有后代分类（BFS）
    const allDeleteIds = collectDescendants(ids, cats)
    await Promise.all([
      this.writeArray(
        KEYS.categories,
        cats.filter((c) => !allDeleteIds.has(c.id))
      ),
      this.writeArray(
        KEYS.cards,
        cards.filter((c) => !allDeleteIds.has(c.categoryId))
      ),
    ])
  }

  // ---------- 卡片 ----------
  async getCards(categoryId?: string): Promise<BookmarkCard[]> {
    const list = await this.readArray<BookmarkCard>(KEYS.cards)
    const filtered = categoryId
      ? list.filter((c) => c.categoryId === categoryId)
      : list
    return filtered.sort((a, b) => a.order - b.order)
  }

  async saveCard(card: BookmarkCard): Promise<void> {
    const list = await this.readArray<BookmarkCard>(KEYS.cards)
    const idx = list.findIndex((c) => c.id === card.id)
    if (idx >= 0) {
      list[idx] = { ...card, updatedAt: Date.now() }
    } else {
      list.push({ ...card, updatedAt: Date.now() })
    }
    await this.writeArray(KEYS.cards, list)
  }

  async saveCards(cards: BookmarkCard[]): Promise<void> {
    const list = await this.readArray<BookmarkCard>(KEYS.cards)
    const map = new Map(list.map((c) => [c.id, c]))
    const now = Date.now()
    for (const c of cards) {
      map.set(c.id, { ...c, updatedAt: now })
    }
    await this.writeArray(KEYS.cards, Array.from(map.values()))
  }

  async deleteCard(id: string): Promise<void> {
    const list = await this.readArray<BookmarkCard>(KEYS.cards)
    await this.writeArray(
      KEYS.cards,
      list.filter((c) => c.id !== id)
    )
  }

  // ---------- 设置 ----------
  async getSettings(): Promise<UserSettings> {
    const result = await browser.storage.local.get(KEYS.settings)
    const merged = { ...DEFAULT_SETTINGS, ...(result[KEYS.settings] ?? {}) } as UserSettings & {
      cardSize?: string
      cardCustomWidthMin?: number
      cardCustomWidthMax?: number
      cardCustomHeightMin?: number
      cardCustomHeightMax?: number
    }
    // ─── cardSize 迁移：两波历史 ──────────────────────────
    // 第一波 v0.21.19：sm/md/lg → standard/large
    //   sm(老h-24=小) → standard、md(老h-32=中) → large、lg(老h-36=大，已废弃) → large
    // 第二波 v0.22.x（本次）：large → custom，并落一组与原 large(h-32, p-3.5) 视觉等价的 W/H，
    //   让老用户切到「自定义」档时看到与之前接近的尺寸。
    const legacyV1: Record<string, string> = { sm: 'standard', md: 'large', lg: 'large' }
    // 用 unknown 中转，避开 cardSize 联合（'compact'|'standard'|'custom'）跟 'large'
    // 等历史字面量的类型不兼容；这里就是迁移层，本来就在处理"不在联合里的旧值"。
    const rawSize = merged.cardSize as unknown as string | undefined
    if (rawSize && legacyV1[rawSize]) {
      ;(merged as { cardSize?: string }).cardSize = legacyV1[rawSize]
    }
    if ((merged as { cardSize?: string }).cardSize === 'large') {
      ;(merged as { cardSize?: string }).cardSize = 'custom'
      // 仅当老用户没有手填过 customXxx 时才注入默认；否则尊重已存在的值（避免覆盖手动配置）
      merged.cardCustomWidthMin ??= 192
      merged.cardCustomWidthMax ??= 192
      merged.cardCustomHeightMin ??= 128
      merged.cardCustomHeightMax ??= 128
    }
    return merged as UserSettings
  }

  async saveSettings(settings: UserSettings): Promise<void> {
    await browser.storage.local.set({ [KEYS.settings]: settings })
  }

  // ---------- 批量 ----------
  async bulkImport(
    data: ExportData,
    mode: BulkImportMode = 'merge',
  ): Promise<BulkImportResult> {
    const incomingCats = data.categories ?? []
    const incomingCards = data.cards ?? []

    if (mode === 'replace') {
      // 完全替换：等价于旧行为，但显式声明，避免误用
      await Promise.all([
        this.writeArray(KEYS.categories, incomingCats),
        this.writeArray(KEYS.cards, incomingCards),
        data.settings ? this.saveSettings(data.settings) : Promise.resolve(),
      ])
      return {
        mode,
        categoriesAdded: incomingCats.length,
        categoriesUpdated: 0,
        cardsAdded: incomingCards.length,
        cardsUpdated: 0,
      }
    }

    // ─── merge 模式（默认）：保留本地，按 id 合并 ───
    const [existCats, existCards] = await Promise.all([
      this.readArray<Category>(KEYS.categories),
      this.readArray<BookmarkCard>(KEYS.cards),
    ])

    // 1) 合并 categories
    const catMap = new Map(existCats.map((c) => [c.id, c]))
    // 维护各 parent 下 order 上限，新加入项追加到末尾
    const maxOrderByParent = new Map<string, number>()
    for (const c of existCats) {
      const key = c.parentId ?? ''
      maxOrderByParent.set(
        key,
        Math.max(maxOrderByParent.get(key) ?? -1, c.order),
      )
    }
    let categoriesAdded = 0
    let categoriesUpdated = 0
    for (const incoming of incomingCats) {
      const existing = catMap.get(incoming.id)
      if (existing) {
        // 同 ID：取 updatedAt 较新者
        if ((incoming.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
          // 保留现有 order，避免位置抖动
          catMap.set(incoming.id, { ...incoming, order: existing.order })
          categoriesUpdated++
        }
      } else {
        const key = incoming.parentId ?? ''
        const next = (maxOrderByParent.get(key) ?? -1) + 1
        maxOrderByParent.set(key, next)
        catMap.set(incoming.id, { ...incoming, order: next })
        categoriesAdded++
      }
    }

    // 2) 合并 cards
    const cardMap = new Map(existCards.map((c) => [c.id, c]))
    const maxOrderByCat = new Map<string, number>()
    for (const c of existCards) {
      maxOrderByCat.set(
        c.categoryId,
        Math.max(maxOrderByCat.get(c.categoryId) ?? -1, c.order),
      )
    }
    let cardsAdded = 0
    let cardsUpdated = 0
    for (const incoming of incomingCards) {
      const existing = cardMap.get(incoming.id)
      if (existing) {
        if ((incoming.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
          cardMap.set(incoming.id, { ...incoming, order: existing.order })
          cardsUpdated++
        }
      } else {
        const next = (maxOrderByCat.get(incoming.categoryId) ?? -1) + 1
        maxOrderByCat.set(incoming.categoryId, next)
        cardMap.set(incoming.id, { ...incoming, order: next })
        cardsAdded++
      }
    }

    await Promise.all([
      this.writeArray(KEYS.categories, Array.from(catMap.values())),
      this.writeArray(KEYS.cards, Array.from(cardMap.values())),
      // settings 在合并模式下故意不覆盖（避免破坏当前主题/布局/壁纸偏好）
    ])

    return {
      mode,
      categoriesAdded,
      categoriesUpdated,
      cardsAdded,
      cardsUpdated,
    }
  }

  async bulkExport(): Promise<ExportData> {
    const [categories, cards, settings] = await Promise.all([
      this.getCategories(),
      this.getCards(),
      this.getSettings(),
    ])
    return {
      version: '1.0',
      exportedAt: Date.now(),
      categories,
      cards,
      settings,
    }
  }

  async clear(): Promise<void> {
    await browser.storage.local.remove([
      KEYS.categories,
      KEYS.cards,
      KEYS.settings,
    ])
  }
}

/** 单例 */
export const localRepo = new LocalRepository()

/**
 * BFS 收集所有需删除的分类 ID（含后代）。
 * 删除"工作"时会自动收集"项目A"、"设计"等子孙分类。
 */
function collectDescendants(ids: string[], allCats: Category[]): Set<string> {
  const result = new Set(ids)
  const queue = [...ids]
  while (queue.length > 0) {
    const parentId = queue.shift()!
    for (const c of allCats) {
      if (c.parentId === parentId && !result.has(c.id)) {
        result.add(c.id)
        queue.push(c.id)
      }
    }
  }
  return result
}
