import { browser } from 'wxt/browser'
import { withStorageLock, LOCAL_CHANGE_KEY, LOCAL_WRITER_ID } from '../services/storageLock'
import { saveBackup } from './BackupsDB'
import {
  BOOKMARK_SYNC_STATE_KEY,
  getBookmarkSyncState,
  PendingBookmarkChangesError,
} from '../services/bookmarkSyncState'
import { INBOX_ID } from '../utils/collections'
import type {
  BookmarkCard,
  Category,
  ExportData,
  StylePreset,
  UserSettings,
} from '../types/bookmark'
import { BUILTIN_PRESETS, DEFAULT_SETTINGS } from '../types/bookmark'
import type {
  BookmarkRepository,
  BulkImportMode,
  BulkImportResult,
  ImportOptions,
  BookmarkSyncSnapshot,
} from './types'

const KEYS = {
  categories: 'curio:categories',
  cards: 'curio:cards',
  settings: 'curio:settings',
  /** 仅存 user 类样式预设；builtin 在内存里合并，避免每次升级 builtin 还要写盘 */
  presets: 'curio:presets',
} as const

/**
 * 基于 browser.storage.local 的本地实现。
 *
 * 适用场景：
 * - V1 MVP 全量数据
 * - V2 离线缓存
 *
 * 容量由浏览器决定（Chrome 114+ 默认 10MB）；备份单独存放在 IndexedDB。
 * 大体积数据（缩略图等）后续迁到 Dexie/IndexedDB。
 *
 * 注意：必须使用 wxt/browser 导出的 `browser`（在 Firefox 下指向原生
 * `globalThis.browser`，是 Promise-based；在 Chrome 下指向 `globalThis.chrome`）。
 * 直接使用 `chrome.*` 在 Firefox 下不会返回 Promise，会导致 await 拿到 undefined。
 */
class StorageRepository {
  constructor(private readonly fromSync = false) {}

  private async writeData(items: Record<string, unknown>): Promise<void> {
    const revision = crypto.randomUUID()
    const bookmarksChanged = KEYS.cards in items || KEYS.categories in items
    await browser.storage.local.set({
      ...items,
      ...(bookmarksChanged
        ? { [BOOKMARK_SYNC_STATE_KEY]: { revision, pending: !this.fromSync } }
        : {}),
      [LOCAL_CHANGE_KEY]: { writer: LOCAL_WRITER_ID, revision },
    })
  }
  // ---------- helpers ----------
  private async readArray<T>(key: string): Promise<T[]> {
    const result = await browser.storage.local.get(key)
    return (result[key] as T[]) ?? []
  }

  private async writeArray<T>(key: string, value: T[]): Promise<void> {
    await this.writeData({ [key]: value })
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
    await this.writeData({
      [KEYS.categories]: cats.filter((c) => !allDeleteIds.has(c.id)),
      [KEYS.cards]: cards.filter((c) => !allDeleteIds.has(c.categoryId)),
    })
  }

  // ---------- 卡片 ----------
  async getCards(categoryId?: string): Promise<BookmarkCard[]> {
    const list = await this.readArray<BookmarkCard>(KEYS.cards)
    const filtered = categoryId ? list.filter((c) => c.categoryId === categoryId) : list
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
    const categories = card.categoryId === INBOX_ID ? await this.getCategories() : undefined
    const inbox =
      categories && !categories.some((c) => c.id === INBOX_ID)
        ? {
            id: INBOX_ID,
            name: '收件箱',
            icon: '📥',
            order: -1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }
        : undefined
    await this.writeData({
      [KEYS.cards]: list,
      ...(inbox && categories ? { [KEYS.categories]: [...categories, inbox] } : {}),
    })
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
      list.filter((c) => c.id !== id),
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
    await this.writeData({ [KEYS.settings]: settings })
  }

  // ---------- 样式预设 ----------
  /**
   * 取全部预设：内置（来自 BUILTIN_PRESETS 常量）+ 用户预设（落地的）。
   * 内置始终排前面，保证 UI 列表稳定；同一进程多次调用结果一致。
   */
  async getPresets(): Promise<StylePreset[]> {
    const r = await browser.storage.local.get(KEYS.presets)
    const raw = r[KEYS.presets]
    const userPresets: StylePreset[] = Array.isArray(raw)
      ? (raw as StylePreset[]).filter((p) => p && p.kind === 'user')
      : []
    return [...BUILTIN_PRESETS, ...userPresets]
  }

  /**
   * 保存用户预设。入参可以包含 builtin（UI 简单起见传完整列表），
   * 这里会过滤掉，只把 kind === 'user' 的写盘。
   */
  async savePresets(list: StylePreset[]): Promise<void> {
    const userOnly = list.filter((p) => p && p.kind === 'user')
    await this.writeData({ [KEYS.presets]: userOnly })
  }

  /** 清空所有用户预设（不动 builtin） */
  async clearPresets(): Promise<void> {
    await this.writeData({ [KEYS.presets]: [] })
  }

  // ---------- 批量 ----------
  async bulkImport(data: ExportData, mode: BulkImportMode = 'merge'): Promise<BulkImportResult> {
    const incomingCats = data.categories ?? []
    const incomingCards = data.cards ?? []

    if (mode === 'replace') {
      // 完全替换：等价于旧行为，但显式声明，避免误用
      await this.writeData({
        [KEYS.categories]: incomingCats,
        [KEYS.cards]: incomingCards,
        ...(data.settings ? { [KEYS.settings]: data.settings } : {}),
      })
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
      maxOrderByParent.set(key, Math.max(maxOrderByParent.get(key) ?? -1, c.order))
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
      maxOrderByCat.set(c.categoryId, Math.max(maxOrderByCat.get(c.categoryId) ?? -1, c.order))
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

    await this.writeData({
      [KEYS.categories]: Array.from(catMap.values()),
      [KEYS.cards]: Array.from(cardMap.values()),
    })

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
    await this.writeData({
      [KEYS.categories]: [],
      [KEYS.cards]: [],
      [KEYS.settings]: DEFAULT_SETTINGS,
      [KEYS.presets]: [],
    })
  }
}

/** 所有读改写共享跨页面锁；备份与修改处于同一临界区。 */
export class LocalRepository extends StorageRepository implements BookmarkRepository {
  private mutate<T>(
    action: (repo: StorageRepository) => Promise<T>,
    reason?: string,
    options?: ImportOptions,
  ): Promise<T> {
    return withStorageLock('local-write', async () => {
      if (options?.fromSync && !options.discardPending && (await getBookmarkSyncState())?.pending) {
        throw new PendingBookmarkChangesError()
      }
      if (reason) await saveBackup(await super.bulkExport(), reason)
      return action(new StorageRepository(options?.fromSync))
    })
  }

  saveCategory(cat: Category) {
    return this.mutate((repo) => repo.saveCategory(cat))
  }
  saveCategories(cats: Category[]) {
    return this.mutate((repo) => repo.saveCategories(cats))
  }
  deleteCategories(ids: string[]) {
    return this.mutate((repo) => repo.deleteCategories(ids), '删除分类')
  }
  saveCard(card: BookmarkCard) {
    return this.mutate((repo) => repo.saveCard(card))
  }
  saveCards(cards: BookmarkCard[]) {
    return this.mutate((repo) => repo.saveCards(cards))
  }
  deleteCard(id: string) {
    return this.mutate((repo) => repo.deleteCard(id), '删除书签')
  }
  saveSettings(settings: UserSettings) {
    return this.mutate((repo) => repo.saveSettings(settings))
  }
  savePresets(list: StylePreset[]) {
    return this.mutate((repo) => repo.savePresets(list))
  }
  clearPresets() {
    return this.mutate((repo) => repo.clearPresets())
  }
  bulkImport(data: ExportData, mode: BulkImportMode = 'merge', options?: ImportOptions) {
    return this.mutate(
      (repo) => repo.bulkImport(data, mode),
      mode === 'replace' ? '覆盖 / 恢复前' : '合并导入前',
      options,
    )
  }
  bulkExport() {
    return withStorageLock('local-write', () => super.bulkExport())
  }
  getSyncSnapshot(): Promise<BookmarkSyncSnapshot> {
    return withStorageLock('local-write', async () => ({
      data: await super.bulkExport(),
      state: await getBookmarkSyncState(),
    }))
  }
  clear() {
    return this.mutate((repo) => repo.clear(), '清空数据前')
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
