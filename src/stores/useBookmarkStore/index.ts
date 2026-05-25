import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import type { BookmarkCard, Category, UserSettings } from '../../types/bookmark'
import { DEFAULT_SETTINGS } from '../../types/bookmark'
import type { BrowserHistoryItem, RecentEntry } from '../../types/recent'
import { DEFAULT_RECENT_LIMIT, MAX_RECENT_BUFFER } from '../../types/recent'
import {
  getBrowserHistoryRepository,
  getRecentRepository,
  getRepository,
} from '../../repositories'
import { importFromBrowserBookmarks } from '../../services/bookmarkImporter'
import {
  exportToBrowserBookmarks,
  type ExportOptions,
  type ExportResult,
} from '../../services/bookmarkExporter'
import {
  getMeta as getSyncMeta,
  pushSettings as syncPushSettings,
  pushBookmarks as syncPushBookmarks,
  syncableChanged,
} from '../../services/SyncService'

import { collectDescendantIds, groupBy, normalizeTags } from './helpers'

/* ──────────────────────────────────────────────────────────────────────
 * 主书签状态：分类 / 卡片 / 最近使用 / 浏览器历史 / 用户设置。
 *
 * v0.21.x 把原 963 行单文件按职责拆为子模块：
 *   - helpers.ts                          纯函数（normalizeTags / collectDescendantIds / groupBy）
 *   - ../../types/recent.ts               公共类型与常量
 *   - ../../repositories/LocalRecentRepository  最近使用本地存储 IO
 *   - ../../repositories/BrowserHistoryAdapter  browser.history.* 适配（best-effort）
 *
 * 本文件只保留 Zustand store 定义本身 + settings 写盘 debounce。
 * 所有外部导入路径保持不变（依赖 folder-with-index 解析）。
 * ────────────────────────────────────────────────────────────────────── */

// 公共类型 / 常量重导出，保持原 useBookmarkStore.ts 的对外 API 不变
export type { BrowserHistoryItem, RecentEntry }
export { DEFAULT_RECENT_LIMIT }

interface BookmarkState {
  categories: Category[]
  cards: BookmarkCard[]
  activeCategoryId: string | null
  searchKeyword: string
  loading: boolean
  initialized: boolean

  /** 「最近使用」记录：按 openedAt 倒序（最新在前） */
  recentEntries: RecentEntry[]
  /** 「最近使用」展示的最大条目数（缓冲区可能多于此值） */
  recentLimit: number
  /**
   * 从浏览器历史拉取的条目（按 lastVisit 倒序）。
   * 仅当 settings.recentIncludeBrowserHistory 为 true 时才会被填充；
   * 关闭后会立即被清空，避免内存中残留隐私数据。
   */
  browserHistoryItems: BrowserHistoryItem[]
  /** 用户设置（主题 / 背景 等） */
  settings: UserSettings

  // ----- actions -----
  init: () => Promise<void>
  /**
   * 从浏览器原生书签批量导入（合并模式）。
   * - 返回新增统计供调用方做 toast 反馈
   * - 失败时抛出原始 Error，由调用方捕获并提示
   */
  importFromBrowser: () => Promise<{
    categoriesAdded: number
    cardsAdded: number
    cardsSkipped: number
  }>
  /**
   * 把当前所有 categories + cards 同步到浏览器原生书签（镜像模式）。
   * - 在 options.root（书签栏 / 其他书签）下的 options.folderName 子文件夹内镜像
   * - 会把新生成的 bookmarkId 回写到对应 Category / BookmarkCard 并持久化
   * - 失败时抛原始 Error 由调用方 toast
   */
  exportToBrowser: (options: ExportOptions) => Promise<ExportResult>
  setActiveCategory: (id: string | null) => void
  setSearchKeyword: (kw: string) => void

  addCategory: (name: string, icon?: string, parentId?: string) => Promise<Category>
  renameCategory: (id: string, name: string) => Promise<void>
  /** 通用更新：可改 icon / color / 任意字段（不能改 id/parentId 结构） */
  updateCategory: (id: string, patch: Partial<Category>) => Promise<void>
  removeCategory: (id: string) => Promise<void>
  removeCategories: (ids: string[]) => Promise<void>
  reorderCategories: (orderedIds: string[]) => Promise<void>
  /** 仅在同一父级（parentId 相同）的兄弟节点中重排，不影响其他分类 */
  reorderSiblings: (
    parentId: string | undefined,
    orderedIds: string[],
  ) => Promise<void>
  /**
   * 通用移动：把分类 activeId 移到 targetParentId 下的 targetIndex 位置。
   * - 自动重排新父级与旧父级（如不同）的所有兄弟 order
   * - 校验循环引用：禁止把节点移到自己的后代下
   * - targetParentId 为 undefined 表示移到顶层
   */
  moveCategory: (
    activeId: string,
    targetParentId: string | undefined,
    targetIndex: number,
  ) => Promise<void>

  addCard: (input: {
    categoryId: string
    title: string
    url: string
    /** 可选：备注（AI 建议 / popup 表单都用得到） */
    description?: string
    /** 可选：初始 tags（AI 建议时一次性写入） */
    tags?: string[]
    /** 可选：自定义图标（emoji / image url），缺省走 favicon */
    icon?: string
  }) => Promise<BookmarkCard>
  updateCard: (id: string, patch: Partial<BookmarkCard>) => Promise<void>
  removeCard: (id: string) => Promise<void>
  moveCard: (cardId: string, targetCategoryId: string, targetIndex: number) => Promise<void>
  reorderCardsInCategory: (categoryId: string, orderedIds: string[]) => Promise<void>

  // ─── Tag CRUD ────────────────────────────────────
  /** 设置某张卡片的 tags（覆盖式；空数组 = 清空） */
  setCardTags: (cardId: string, tags: string[]) => Promise<void>
  /** 批量设置 tags：{ cardId: tags }；用于 AI 一次性写入多条 */
  setCardTagsBatch: (entries: Array<{ cardId: string; tags: string[] }>) => Promise<void>
  /** 全库改名：把所有卡片中的 oldTag 替换为 newTag（去重） */
  renameTag: (oldTag: string, newTag: string) => Promise<void>
  /** 全库合并：把多个 tag 合并到一个目标 tag */
  mergeTags: (tagsToMerge: string[], target: string) => Promise<void>
  /** 全库删除：从所有卡片中移除该 tag */
  removeTag: (tag: string) => Promise<void>

  /** 记录一次"打开书签"，用于"最近使用"模块；自动去重并截断到 buffer 上限 */
  recordRecentOpen: (cardId: string) => Promise<void>
  /** 修改最近使用展示数量（持久化） */
  setRecentLimit: (n: number) => Promise<void>
  /** 清空所有最近使用记录 */
  clearRecent: () => Promise<void>

  /**
   * 拉取浏览器历史（chrome.history.search）并写入 browserHistoryItems。
   * - 仅在 settings.recentIncludeBrowserHistory 为 true 时调用才有意义
   * - 失败（无权限 / 用户拒绝）时静默吞掉，仅返回空列表，不污染状态
   */
  loadBrowserHistory: (maxResults?: number) => Promise<void>
  /** 从历史中删除一条 url（同步清理 browserHistoryItems） */
  deleteHistoryUrl: (url: string) => Promise<void>
  /**
   * 把一条历史项加入当前 activeCategory 作为书签卡片。
   * - 已经存在 (categoryId, url) 相同的卡片时跳过（与 importFromBrowser 的去重一致）
   * - 返回新建（或命中复用）的卡片；如果当前没有 activeCategory 则返回 null
   */
  addCardFromHistory: (input: {
    url: string
    title: string
  }) => Promise<BookmarkCard | null>

  /** 局部更新用户设置（自动持久化） */
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>
  /**
   * 把来自云端的可同步字段应用到本机。
   * 与 updateSettings 的差别：不会再触发 sync push（避免回声），
   * 也不会重复落 chrome.storage.local（应用本地持久化由 scheduleSettingsSave 兜底）。
   */
  applyRemoteSettings: (patch: Partial<UserSettings>) => Promise<void>
  /**
   * 把来自云端的整套书签 payload 应用到本机（整包 LWW）。
   * - 不会回推（避免回声）
   * - 用 repo.bulkImport(mode='replace') 同时落盘，保证重启后看到的就是云端版本
   * - settings 不受影响（settings 走另一条管线）
   */
  applyRemoteBookmarks: (payload: {
    categories: Category[]
    cards: BookmarkCard[]
  }) => Promise<void>
}

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
  categories: [],
  cards: [],
  activeCategoryId: null,
  searchKeyword: '',
  loading: false,
  initialized: false,
  recentEntries: [],
  recentLimit: DEFAULT_RECENT_LIMIT,
  browserHistoryItems: [],
  settings: DEFAULT_SETTINGS,

  async init() {
    set({ loading: true })
    const repo = getRepository()
    const recentRepo = getRecentRepository()
    const [categories, cards, recentEntries, recentLimit, settings] = await Promise.all([
      repo.getCategories(),
      repo.getCards(),
      recentRepo.loadEntries(),
      recentRepo.loadLimit(),
      repo.getSettings(),
    ])
    // 默认激活：排序第一的【顶层】分类（与用户在侧栏看到的"第一项"对齐）
    // categories 已按 order 排序，但可能子级与顶层混杂，需显式取顶层
    const firstTop = categories.find((c) => !c.parentId)
    // 清理脏数据：卡片可能已被删除
    const cardIdSet = new Set(cards.map((c) => c.id))
    const cleanedEntries = recentEntries.filter((e) => cardIdSet.has(e.cardId))
    set({
      categories,
      cards,
      activeCategoryId: firstTop?.id ?? categories[0]?.id ?? null,
      recentEntries: cleanedEntries,
      recentLimit,
      settings,
      loading: false,
      initialized: true,
    })
    // 用户上次开启了「合并浏览器历史」→ 启动时自动拉取一次
    // 不阻塞 init 完成，让首屏先把书签渲染出来，history 异步追上去即可
    if (settings.recentIncludeBrowserHistory) {
      void get().loadBrowserHistory()
    }
  },

  async importFromBrowser() {
    set({ loading: true })
    try {
      const { categories: imported, cards: importedCards } =
        await importFromBrowserBookmarks()
      const repo = getRepository()
      const existingCats = await repo.getCategories()
      const existingCards = await repo.getCards()

      // ─── 分类合并：按「同父级 + 同名」匹配 ───────────────────────
      // 早期版本只按 name 匹配会出两个问题：
      // 1) 同名异级（"杂项"在不同父级下）会被错误合并
      // 2) 新建分类的 parentId 若指向"已被命中复用的旧分类"，
      //    没做 remap → 新分类成了孤儿（parentId 指向不存在的 uuid）
      //    → 表现为「删了某文件夹后再导入，看不到这个文件夹」
      //
      // 这里改用 BFS 按层级处理：父级先确定 finalId，子级再据此匹配。
      const importedByParent = groupBy(imported, (c) => c.parentId ?? '')
      const existingByParent = groupBy(existingCats, (c) => c.parentId ?? '')

      const newIdToFinalId = new Map<string, string>()
      const catsToCreate: Category[] = []

      const queue: (string | undefined)[] = [undefined] // 顶层
      while (queue.length > 0) {
        const importedParent = queue.shift()
        // 该 importedParent 在最终数据中对应的 parentId
        // - 顶层（importedParent 为 undefined）→ undefined
        // - 否则查 newIdToFinalId
        const finalParent = importedParent
          ? newIdToFinalId.get(importedParent)
          : undefined

        const siblings = importedByParent.get(importedParent ?? '') ?? []
        const existingSiblings =
          existingByParent.get(finalParent ?? '') ?? []
        const existingByName = new Map(
          existingSiblings.map((c) => [c.name, c]),
        )

        for (const newCat of siblings) {
          const hit = existingByName.get(newCat.name)
          if (hit) {
            // 已存在同父同名分类 → 复用旧 id，不重复创建
            newIdToFinalId.set(newCat.id, hit.id)
          } else {
            // 新分类：保留新 uuid，但 parentId 必须指向最终 id
            newIdToFinalId.set(newCat.id, newCat.id)
            catsToCreate.push({ ...newCat, parentId: finalParent })
          }
          // 当前节点入队，处理其子层
          queue.push(newCat.id)
        }
      }

      // ─── 卡片合并：按 (categoryId, url) 去重 ──────────────────────
      // 早期版本按 card.id upsert，但 importer 每次都生成新 uuid，
      // 导致已经导过的书签每次都会作为新记录追加 → 重复。
      const remappedCards = importedCards.map((card) => ({
        ...card,
        categoryId:
          newIdToFinalId.get(card.categoryId) ?? card.categoryId,
      }))
      const existingKey = new Set(
        existingCards.map((c) => `${c.categoryId}::${c.url}`),
      )
      const cardsToAdd = remappedCards.filter(
        (c) => !existingKey.has(`${c.categoryId}::${c.url}`),
      )

      // ─── 写入 ────────────────────────────────────────────────
      if (catsToCreate.length > 0) await repo.saveCategories(catsToCreate)
      if (cardsToAdd.length > 0) await repo.saveCards(cardsToAdd)

      await get().init()
      if (catsToCreate.length > 0 || cardsToAdd.length > 0) {
        scheduleBookmarksSyncPush()
      }
      return {
        categoriesAdded: catsToCreate.length,
        cardsAdded: cardsToAdd.length,
        cardsSkipped: importedCards.length - cardsToAdd.length,
      }
    } finally {
      set({ loading: false })
    }
  },

  async exportToBrowser(options) {
    const categories = get().categories
    const cards = get().cards
    const result = await exportToBrowserBookmarks(categories, cards, options)

    // ─── bookmarkId 回写：仅对真正发生变化的实体批量持久化 ───
    // 同步逻辑里 categoryIdToBookmarkId / cardIdToBookmarkId 是"最终态"映射，
    // 这里和现有内存数据比较，过滤出真正需要持久化的差异，避免无谓写盘。
    const now = Date.now()
    const repo = getRepository()

    const catsToSave: Category[] = []
    const nextCats = categories.map((c) => {
      const newId = result.categoryIdToBookmarkId.get(c.id)
      if (!newId || newId === c.bookmarkId) return c
      const updated = { ...c, bookmarkId: newId, updatedAt: now }
      catsToSave.push(updated)
      return updated
    })

    const cardsToSave: BookmarkCard[] = []
    const nextCards = cards.map((c) => {
      const newId = result.cardIdToBookmarkId.get(c.id)
      if (!newId || newId === c.bookmarkId) return c
      const updated = { ...c, bookmarkId: newId, updatedAt: now }
      cardsToSave.push(updated)
      return updated
    })

    if (catsToSave.length > 0) await repo.saveCategories(catsToSave)
    if (cardsToSave.length > 0) await repo.saveCards(cardsToSave)
    if (catsToSave.length > 0 || cardsToSave.length > 0) {
      set({ categories: nextCats, cards: nextCards })
      scheduleBookmarksSyncPush()
    }

    // 记忆用户偏好（下次默认沿用），不阻塞同步结果返回
    const prev = get().settings
    if (
      prev.browserSyncRoot !== options.root ||
      (prev.browserSyncFolderName ?? '') !== options.folderName
    ) {
      void get().updateSettings({
        browserSyncRoot: options.root,
        browserSyncFolderName: options.folderName,
      })
    }

    return result
  },

  setActiveCategory(id) {
    set({ activeCategoryId: id })
  },

  setSearchKeyword(kw) {
    set({ searchKeyword: kw })
  },

  async addCategory(name, icon, parentId) {
    const now = Date.now()
    // order 取同一父级（顶层 = parentId 为空）下的现有数量，避免新分类排到陌生位置
    const siblingCount = get().categories.filter(
      (c) => (c.parentId ?? '') === (parentId ?? '')
    ).length
    const cat: Category = {
      id: uuid(),
      name,
      icon,
      parentId,
      order: siblingCount,
      createdAt: now,
      updatedAt: now,
    }
    await getRepository().saveCategory(cat)
    set({
      categories: [...get().categories, cat],
      activeCategoryId: get().activeCategoryId ?? cat.id,
    })
    scheduleBookmarksSyncPush()
    return cat
  },

  async renameCategory(id, name) {
    await get().updateCategory(id, { name })
  },

  async updateCategory(id, patch) {
    const cat = get().categories.find((c) => c.id === id)
    if (!cat) return
    // 不允许通过此入口改 id（结构性字段交给专门的 reorder/remove）
    const { id: _ignored, ...safePatch } = patch
    const updated = { ...cat, ...safePatch, updatedAt: Date.now() }
    await getRepository().saveCategory(updated)
    set({
      categories: get().categories.map((c) => (c.id === id ? updated : c)),
    })
    scheduleBookmarksSyncPush()
  },

  async removeCategory(id) {
    await get().removeCategories([id])
  },

  async removeCategories(ids) {
    if (ids.length === 0) return
    // 本地同样要收集所有后代，保证内存状态与持久化一致
    const allCats = get().categories
    const allCards = get().cards
    const allDeleteIds = collectDescendantIds(ids, allCats)
    await getRepository().deleteCategories(ids)   // repo 内部会级联
    const remaining = allCats.filter((c) => !allDeleteIds.has(c.id))
    const remainingCards = allCards.filter(
      (c) => !allDeleteIds.has(c.categoryId),
    )
    // 同步清理"最近使用"中已被级联删除的卡片
    const removedCardIds = new Set(
      allCards
        .filter((c) => allDeleteIds.has(c.categoryId))
        .map((c) => c.id),
    )
    const nextRecent = get().recentEntries.filter(
      (e) => !removedCardIds.has(e.cardId),
    )
    if (nextRecent.length !== get().recentEntries.length) {
      void getRecentRepository().saveEntries(nextRecent)
    }
    set({
      categories: remaining,
      cards: remainingCards,
      recentEntries: nextRecent,
      activeCategoryId: allDeleteIds.has(get().activeCategoryId ?? '')
        ? remaining[0]?.id ?? null
        : get().activeCategoryId,
    })
    scheduleBookmarksSyncPush()
  },

  async reorderCategories(orderedIds) {
    const map = new Map(get().categories.map((c) => [c.id, c]))
    const now = Date.now()
    const reordered: Category[] = orderedIds
      .map((id, idx) => {
        const c = map.get(id)
        return c ? { ...c, order: idx, updatedAt: now } : null
      })
      .filter((c): c is Category => c !== null)
    // 批量写入，避免并发"读-改-写"竞态
    await getRepository().saveCategories(reordered)
    set({ categories: reordered })
    scheduleBookmarksSyncPush()
  },

  async reorderSiblings(parentId, orderedIds) {
    const now = Date.now()
    const orderMap = new Map(orderedIds.map((id, i) => [id, i]))
    const updated: Category[] = []
    const next = get().categories.map((c) => {
      // 仅匹配同一父级下、且在 orderedIds 中的项；其他保持原状
      const sameParent = (c.parentId ?? '') === (parentId ?? '')
      if (!sameParent || !orderMap.has(c.id)) return c
      const merged = { ...c, order: orderMap.get(c.id)!, updatedAt: now }
      updated.push(merged)
      return merged
    })
    if (updated.length > 0) {
      await getRepository().saveCategories(updated)
    }
    set({ categories: next })
    if (updated.length > 0) scheduleBookmarksSyncPush()
  },

  async moveCategory(activeId, targetParentId, targetIndex) {
    const allCats = get().categories
    const active = allCats.find((c) => c.id === activeId)
    if (!active) return

    // ── 校验：禁止把节点移到自己 / 自己的后代下（循环引用） ──
    if (targetParentId === activeId) return
    const descendants = collectDescendantIds([activeId], allCats)
    if (targetParentId && descendants.has(targetParentId)) return

    const now = Date.now()
    const oldParentKey = active.parentId ?? ''
    const newParentKey = targetParentId ?? ''
    const samePar = oldParentKey === newParentKey

    // 1) 取新父级下的现有兄弟（不含 active 自身）
    const newSiblings = allCats
      .filter(
        (c) => (c.parentId ?? '') === newParentKey && c.id !== activeId,
      )
      .sort((a, b) => a.order - b.order)

    // 2) 在 targetIndex 处插入 active（同时改 parentId）
    const movedActive: Category = {
      ...active,
      parentId: targetParentId,
      updatedAt: now,
    }
    const clamped = Math.max(0, Math.min(targetIndex, newSiblings.length))
    newSiblings.splice(clamped, 0, movedActive)

    // 3) 收集需要更新的项（新父级里所有兄弟都要重新计算 order）
    const updateMap = new Map<string, Category>()
    newSiblings.forEach((c, idx) => {
      updateMap.set(c.id, { ...c, order: idx, updatedAt: now })
    })

    // 4) 跨父级移动时，旧父级剩余兄弟也要重排，避免空洞
    if (!samePar) {
      const oldSiblings = allCats
        .filter(
          (c) => (c.parentId ?? '') === oldParentKey && c.id !== activeId,
        )
        .sort((a, b) => a.order - b.order)
      oldSiblings.forEach((c, idx) => {
        updateMap.set(c.id, { ...c, order: idx, updatedAt: now })
      })
    }

    // 5) 写库 + setState（仅替换被更新的项，其余原样）
    const toSave = Array.from(updateMap.values())
    if (toSave.length > 0) {
      await getRepository().saveCategories(toSave)
    }
    set({
      categories: allCats.map((c) => updateMap.get(c.id) ?? c),
    })
    if (toSave.length > 0) scheduleBookmarksSyncPush()
  },

  async addCard({ categoryId, title, url, description, tags, icon }) {
    const now = Date.now()
    const order = get().cards.filter((c) => c.categoryId === categoryId).length
    // tags 经过 normalizeTags 标准化，避免脏数据进库
    const cleanTags = tags ? normalizeTags(tags) : undefined
    const cleanDesc =
      typeof description === 'string' && description.trim().length > 0
        ? description.trim()
        : undefined
    const card: BookmarkCard = {
      id: uuid(),
      categoryId,
      title,
      url,
      order,
      description: cleanDesc,
      tags: cleanTags && cleanTags.length > 0 ? cleanTags : undefined,
      icon: icon || undefined,
      createdAt: now,
      updatedAt: now,
    }
    await getRepository().saveCard(card)
    set({ cards: [...get().cards, card] })
    scheduleBookmarksSyncPush()
    return card
  },

  async updateCard(id, patch) {
    const card = get().cards.find((c) => c.id === id)
    if (!card) return
    const updated = { ...card, ...patch, updatedAt: Date.now() }
    await getRepository().saveCard(updated)
    set({ cards: get().cards.map((c) => (c.id === id ? updated : c)) })
    scheduleBookmarksSyncPush()
  },

  async setCardTags(cardId, tags) {
    const normalized = normalizeTags(tags)
    await get().updateCard(cardId, {
      tags: normalized.length > 0 ? normalized : undefined,
    })
  },

  async setCardTagsBatch(entries) {
    if (entries.length === 0) return
    const now = Date.now()
    const cardMap = new Map(get().cards.map((c) => [c.id, c]))
    const toSave: BookmarkCard[] = []
    for (const e of entries) {
      const card = cardMap.get(e.cardId)
      if (!card) continue
      const tags = normalizeTags(e.tags)
      const next: BookmarkCard = {
        ...card,
        tags: tags.length > 0 ? tags : undefined,
        updatedAt: now,
      }
      cardMap.set(e.cardId, next)
      toSave.push(next)
    }
    if (toSave.length === 0) return
    await getRepository().saveCards(toSave)
    set({
      cards: get().cards.map((c) => cardMap.get(c.id) ?? c),
    })
    scheduleBookmarksSyncPush()
  },

  async renameTag(oldTag, newTag) {
    const from = oldTag.trim()
    const to = newTag.trim()
    if (!from || !to || from === to) return
    const now = Date.now()
    const toSave: BookmarkCard[] = []
    const nextCards = get().cards.map((c) => {
      if (!c.tags?.includes(from)) return c
      const next = Array.from(
        new Set(c.tags.map((t) => (t === from ? to : t))),
      )
      const updated = { ...c, tags: next, updatedAt: now }
      toSave.push(updated)
      return updated
    })
    if (toSave.length > 0) await getRepository().saveCards(toSave)
    set({ cards: nextCards })
    if (toSave.length > 0) scheduleBookmarksSyncPush()
  },

  async mergeTags(tagsToMerge, target) {
    const merge = new Set(tagsToMerge.map((t) => t.trim()).filter(Boolean))
    const t = target.trim()
    if (!t || merge.size === 0) return
    merge.delete(t)
    if (merge.size === 0) return
    const now = Date.now()
    const toSave: BookmarkCard[] = []
    const nextCards = get().cards.map((c) => {
      if (!c.tags?.some((tag) => merge.has(tag))) return c
      const next = Array.from(
        new Set(c.tags.map((tag) => (merge.has(tag) ? t : tag))),
      )
      const updated = { ...c, tags: next, updatedAt: now }
      toSave.push(updated)
      return updated
    })
    if (toSave.length > 0) await getRepository().saveCards(toSave)
    set({ cards: nextCards })
    if (toSave.length > 0) scheduleBookmarksSyncPush()
  },

  async removeTag(tag) {
    const t = tag.trim()
    if (!t) return
    const now = Date.now()
    const toSave: BookmarkCard[] = []
    const nextCards = get().cards.map((c) => {
      if (!c.tags?.includes(t)) return c
      const next = c.tags.filter((x) => x !== t)
      const updated: BookmarkCard = {
        ...c,
        tags: next.length > 0 ? next : undefined,
        updatedAt: now,
      }
      toSave.push(updated)
      return updated
    })
    if (toSave.length > 0) await getRepository().saveCards(toSave)
    set({ cards: nextCards })
    if (toSave.length > 0) scheduleBookmarksSyncPush()
  },

  async removeCard(id) {
    await getRepository().deleteCard(id)
    // 同步清理"最近使用"，避免出现指向已删卡片的脏记录
    const nextRecent = get().recentEntries.filter((e) => e.cardId !== id)
    const recentChanged = nextRecent.length !== get().recentEntries.length
    if (recentChanged) void getRecentRepository().saveEntries(nextRecent)
    set({
      cards: get().cards.filter((c) => c.id !== id),
      recentEntries: nextRecent,
    })
    scheduleBookmarksSyncPush()
  },

  async moveCard(cardId, targetCategoryId, targetIndex) {
    const cards = [...get().cards]
    const card = cards.find((c) => c.id === cardId)
    if (!card) return
    const fromCategory = card.categoryId

    // 先把卡片归到新分类
    card.categoryId = targetCategoryId

    // 重排目标分类
    const targetGroup = cards
      .filter((c) => c.categoryId === targetCategoryId && c.id !== cardId)
      .sort((a, b) => a.order - b.order)
    targetGroup.splice(targetIndex, 0, card)
    targetGroup.forEach((c, i) => (c.order = i))

    // 重排原分类
    if (fromCategory !== targetCategoryId) {
      const fromGroup = cards
        .filter((c) => c.categoryId === fromCategory)
        .sort((a, b) => a.order - b.order)
      fromGroup.forEach((c, i) => (c.order = i))
    }

    // v0.21.14：先 setState 再 await 持久化（乐观更新）。
    // 之前先 await saveCards 才 set，IndexedDB 写入 ~几十毫秒期间
    // React state 仍是旧顺序，dnd-kit 结束拖拽后 sortable transform 重置 →
    // 卡片视觉先回原位再过渡到新位置 → 用户看到闪烁抖动。
    set({ cards })
    await getRepository().saveCards(cards)
    scheduleBookmarksSyncPush()
  },

  async reorderCardsInCategory(categoryId, orderedIds) {
    const cards = [...get().cards]
    const idxMap = new Map(orderedIds.map((id, i) => [id, i]))
    cards.forEach((c) => {
      if (c.categoryId === categoryId && idxMap.has(c.id)) {
        c.order = idxMap.get(c.id)!
      }
    })
    // v0.21.14：乐观更新，先 setState 让 sortable 立即应用新顺序
    set({ cards })
    await getRepository().saveCards(
      cards.filter((c) => c.categoryId === categoryId)
    )
    scheduleBookmarksSyncPush()
  },

  async recordRecentOpen(cardId) {
    // 卡片必须存在；若已被删除则忽略，避免脏记录
    if (!get().cards.some((c) => c.id === cardId)) return
    const now = Date.now()
    // 去重：移除已有记录后追加新记录到最前
    const filtered = get().recentEntries.filter((e) => e.cardId !== cardId)
    const next: RecentEntry[] = [{ cardId, openedAt: now }, ...filtered].slice(
      0,
      MAX_RECENT_BUFFER,
    )
    set({ recentEntries: next })
    await getRecentRepository().saveEntries(next)
  },

  async setRecentLimit(n) {
    // 合理边界：1 ~ MAX_RECENT_BUFFER
    const clamped = Math.max(1, Math.min(MAX_RECENT_BUFFER, Math.floor(n)))
    if (clamped === get().recentLimit) return
    set({ recentLimit: clamped })
    await getRecentRepository().saveLimit(clamped)
  },

  async clearRecent() {
    if (get().recentEntries.length === 0) return
    set({ recentEntries: [] })
    await getRecentRepository().saveEntries([])
  },

  async loadBrowserHistory(maxResults = MAX_RECENT_BUFFER) {
    // 关闭开关时不加载；防御性检查，避免被误调用拉取数据
    if (!get().settings.recentIncludeBrowserHistory) return
    const items = await getBrowserHistoryRepository().search(maxResults)
    set({ browserHistoryItems: items })
  },

  async deleteHistoryUrl(url) {
    // 1. 从浏览器原生历史中删除（如果可用）
    await getBrowserHistoryRepository().deleteUrl(url)
    // 2. 同步内存状态，立即把卡片从 UI 移除（即使原生删除失败也保持 UI 一致）
    set({
      browserHistoryItems: get().browserHistoryItems.filter((it) => it.url !== url),
    })
  },

  async addCardFromHistory({ url, title }) {
    const categoryId = get().activeCategoryId
    if (!categoryId) return null
    // 去重：同一分类下已有相同 url 时直接复用，不再追加
    const exist = get().cards.find(
      (c) => c.categoryId === categoryId && c.url === url,
    )
    if (exist) return exist
    return await get().addCard({ categoryId, title: title || url, url })
  },

  async updateSettings(patch) {
    const prev = get().settings
    const next: UserSettings = { ...prev, ...patch }
    set({ settings: next })

    // v0.21.x：把磁盘写入 debounce。背景模糊 / 字体色 / 壁纸颜色等滑块
    // 拖动时会以 ~60Hz 触发本函数，之前每次都 chrome.storage.local.set(整个 settings)
    // 既浪费 IO 又会拖慢主线程。现在 250ms idle 后只写最新一次。
    //
    // 内存状态依旧同步更新（上面的 set），UI 立刻响应；只有持久化被 defer。
    // unload 路径由模块级 beforeunload/visibilitychange 监听兜底 flush。
    scheduleSettingsSave()

    // V1.5：可同步字段发生变化时，再 debounce 一次推送到云端
    // - 不可同步字段（壁纸、侧边栏宽度、browserSync*）不会触发推送
    // - 自身节流到 800ms（比 local 慢，云端 quota 更紧：120 ops/min）
    if (syncableChanged(prev, next)) {
      scheduleSettingsSyncPush()
    }

    // ─── 副作用：开关切换时同步处理 browserHistoryItems ───
    const prevOn = !!prev.recentIncludeBrowserHistory
    const nextOn = !!next.recentIncludeBrowserHistory
    if (!prevOn && nextOn) {
      // 关 → 开：立即拉取一次，让用户感知到生效
      await get().loadBrowserHistory()
    } else if (prevOn && !nextOn) {
      // 开 → 关：清空内存，避免历史数据残留
      set({ browserHistoryItems: [] })
    }
  },

  async applyRemoteSettings(patch) {
    const prev = get().settings
    const next: UserSettings = { ...prev, ...patch }
    set({ settings: next })
    // 仍要落本地，让重启后从 local 读到最新值；走 scheduleSettingsSave
    // 而不是即时写，是为了把多个 onChanged 合批。
    scheduleSettingsSave()
    // 注意：故意 不 调 scheduleSettingsSyncPush，避免回声循环。
    // 副作用：开关切换时同步处理 browserHistoryItems（与 updateSettings 一致）
    const prevOn = !!prev.recentIncludeBrowserHistory
    const nextOn = !!next.recentIncludeBrowserHistory
    if (!prevOn && nextOn) {
      await get().loadBrowserHistory()
    } else if (prevOn && !nextOn) {
      set({ browserHistoryItems: [] })
    }
  },

  async applyRemoteBookmarks(payload) {
    // 内存先替换，UI 立刻刷新；不触发 push 回声
    set({ categories: payload.categories, cards: payload.cards })
    // 持久化到本地仓库：mode='replace' 会原子清空+重写 categories & cards，
    // 不动 settings（与本管线职责一致）
    try {
      await getRepository().bulkImport(
        {
          version: 'sync',
          exportedAt: Date.now(),
          categories: payload.categories,
          cards: payload.cards,
        },
        'replace',
      )
    } catch (err) {
      // 落盘失败不致命：内存已是新版，下次启动会因为 manifest.ts > lastPullTs
      // 而被 bootstrap 重新拉取，幂等。
      console.error('[sync] applyRemoteBookmarks 持久化失败：', err)
    }
    // 同步清理"最近使用"中指向已不存在卡片的脏记录
    const validIds = new Set(payload.cards.map((c) => c.id))
    const nextRecent = get().recentEntries.filter((e) => validIds.has(e.cardId))
    if (nextRecent.length !== get().recentEntries.length) {
      set({ recentEntries: nextRecent })
      void getRecentRepository().saveEntries(nextRecent)
    }
    // 激活分类被远端删了 → 落到第一个顶层分类
    const activeId = get().activeCategoryId
    if (activeId && !payload.categories.some((c) => c.id === activeId)) {
      const firstTop = payload.categories.find((c) => !c.parentId)
      set({ activeCategoryId: firstTop?.id ?? payload.categories[0]?.id ?? null })
    }
  },
}))

/* ──────────────────────────────────────────────────────────────────────
 * settings 持久化的防抖调度器。
 * - 250ms 是经验值：滑块拖动 250ms 内的连续 tick 合并成一次写；用户停下后
 *   感知不到延迟。
 * - 取 useBookmarkStore.getState() 而非闭包变量，确保 timer fire 时拿到的是最新合并值。
 * - flushSettingsSave 在 beforeunload / visibilitychange=hidden 时同步触发，
 *   避免用户拖完滑块立刻关掉标签页时丢失最新值。
 * ────────────────────────────────────────────────────────────────────── */
let settingsSaveTimer: ReturnType<typeof setTimeout> | null = null
const SETTINGS_SAVE_DEBOUNCE_MS = 250

function scheduleSettingsSave() {
  if (settingsSaveTimer) clearTimeout(settingsSaveTimer)
  settingsSaveTimer = setTimeout(() => {
    settingsSaveTimer = null
    void getRepository().saveSettings(useBookmarkStore.getState().settings)
  }, SETTINGS_SAVE_DEBOUNCE_MS)
}

function flushSettingsSave() {
  if (!settingsSaveTimer) return
  clearTimeout(settingsSaveTimer)
  settingsSaveTimer = null
  void getRepository().saveSettings(useBookmarkStore.getState().settings)
}

/* ──────────────────────────────────────────────────────────────────────
 * 同步推送 debounce（V1.5）—— 两条独立管线：
 *   - settings：800ms（用户调样式滑块是高频低字节）
 *   - bookmarks：1500ms（拖拽/批量编辑的"一阵子操作"应合并成一次推送，
 *     字节数大、写入贵，多等一会儿值得）
 *
 * chrome.storage.sync 配额：120 writes / 分钟 + 1800 writes / 小时；
 * 两条管线 + 各自 debounce 是双层保护。
 * pushSettings / pushBookmarks 内部都会自检 meta.enabled，
 * 未启用时为空操作不浪费请求。
 * ────────────────────────────────────────────────────────────────────── */
let settingsSyncPushTimer: ReturnType<typeof setTimeout> | null = null
let bookmarksSyncPushTimer: ReturnType<typeof setTimeout> | null = null
const SETTINGS_SYNC_PUSH_DEBOUNCE_MS = 800
const BOOKMARKS_SYNC_PUSH_DEBOUNCE_MS = 1500

function scheduleSettingsSyncPush() {
  if (settingsSyncPushTimer) clearTimeout(settingsSyncPushTimer)
  settingsSyncPushTimer = setTimeout(() => {
    settingsSyncPushTimer = null
    void syncPushSettings(useBookmarkStore.getState().settings)
  }, SETTINGS_SYNC_PUSH_DEBOUNCE_MS)
}

function flushSettingsSyncPush() {
  if (!settingsSyncPushTimer) return
  clearTimeout(settingsSyncPushTimer)
  settingsSyncPushTimer = null
  void syncPushSettings(useBookmarkStore.getState().settings)
}

function scheduleBookmarksSyncPush() {
  if (bookmarksSyncPushTimer) clearTimeout(bookmarksSyncPushTimer)
  bookmarksSyncPushTimer = setTimeout(() => {
    bookmarksSyncPushTimer = null
    const s = useBookmarkStore.getState()
    void syncPushBookmarks(s.categories, s.cards)
  }, BOOKMARKS_SYNC_PUSH_DEBOUNCE_MS)
}

function flushBookmarksSyncPush() {
  if (!bookmarksSyncPushTimer) return
  clearTimeout(bookmarksSyncPushTimer)
  bookmarksSyncPushTimer = null
  const s = useBookmarkStore.getState()
  void syncPushBookmarks(s.categories, s.cards)
}

// 模块初始化即挂监听；newtab 页常驻，不会反复 register。
// SSR / 非浏览器环境下 typeof window 兜底避免抛错。
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    flushSettingsSave()
    flushSettingsSyncPush()
    flushBookmarksSyncPush()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushSettingsSave()
      flushSettingsSyncPush()
      flushBookmarksSyncPush()
    }
  })
}

/** 暴露给外部按需主动 flush 两条推送管线 */
export function flushPendingSyncPush() {
  flushSettingsSyncPush()
  flushBookmarksSyncPush()
}

/**
 * 取消两条挂起的推送（不写云端）。
 * 「从云端覆盖」前要先调一下，避免：用户刚改了本地 → 还没到 debounce → 点拉取，
 * 在 readRemote 的 await 间隙里 push 触发，把刚改的本地值推上去，
 * 紧接着 pull 拿回来一看『云端 = 本地新值』，覆盖看起来没生效。
 */
export function cancelPendingSyncPush() {
  if (settingsSyncPushTimer) {
    clearTimeout(settingsSyncPushTimer)
    settingsSyncPushTimer = null
  }
  if (bookmarksSyncPushTimer) {
    clearTimeout(bookmarksSyncPushTimer)
    bookmarksSyncPushTimer = null
  }
}

/**
 * 暴露给所有产生 categories/cards 变更的外部入口（如 importFromBrowser、
 * AI organize、批量打标签 setCardTagsBatch / renameTag / mergeTags / removeTag、
 * exportToBrowser 回写 bookmarkId 等）。
 *
 * 内部 store 里的简单 CRUD（addCategory/updateCategory/removeCategory(ies)/
 * reorderCategories/reorderSiblings/moveCategory/addCard/updateCard/removeCard/
 * moveCard/reorderCardsInCategory）已经各自统一在 set() 后调用本函数。
 */
export function notifyBookmarksChanged() {
  scheduleBookmarksSyncPush()
}

/** 暴露给外部用：检查当前 meta.enabled 状态（如 onChanged listener 启动检测） */
export async function isSyncEnabled(): Promise<boolean> {
  const m = await getSyncMeta()
  return !!m.enabled
}
