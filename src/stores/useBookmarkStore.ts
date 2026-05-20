import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { browser } from 'wxt/browser'
import type { BookmarkCard, Category, UserSettings } from '../types/bookmark'
import { DEFAULT_SETTINGS } from '../types/bookmark'
import { getRepository } from '../repositories'
import { importFromBrowserBookmarks } from '../services/bookmarkImporter'

/** browser.storage.local key（与 LocalRepository 的 KEYS 平级，专给"最近使用"使用） */
const RECENT_ENTRIES_KEY = 'tabit:recent'
const RECENT_LIMIT_KEY = 'tabit:recentLimit'
/** 默认显示数量；用户可在 RecentSection 中修改并持久化 */
export const DEFAULT_RECENT_LIMIT = 8
/** 内存中保留的最大条目数：留出余量，方便用户调大 N 时仍能显示历史；显示时再切片 */
const MAX_RECENT_BUFFER = 100

/**
 * 最近使用记录：
 * - cardId: 引用 BookmarkCard.id；卡片被删除时会同步清理
 * - openedAt: 打开时间戳（ms），用于排序与去重决策
 */
export interface RecentEntry {
  cardId: string
  openedAt: number
}

/**
 * 浏览器历史条目（精简版，只保留 UI 渲染所需字段）。
 * 来自 browser.history.search()，不持久化到本地存储 —— 每次新开标签页时按需拉取。
 * 隐私考虑：浏览器原生历史本身已在用户掌控之中，我们只读不写、不复制到自己的存储里。
 */
export interface BrowserHistoryItem {
  url: string
  title: string
  /** 最后一次访问时间戳（ms）；某些浏览器返回的 lastVisitTime 可能为 undefined，统一兜底为 0 */
  lastVisit: number
}

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
    const [categories, cards, recent, settings] = await Promise.all([
      repo.getCategories(),
      repo.getCards(),
      loadRecentFromStorage(),
      repo.getSettings(),
    ])
    // 默认激活：排序第一的【顶层】分类（与用户在侧栏看到的"第一项"对齐）
    // categories 已按 order 排序，但可能子级与顶层混杂，需显式取顶层
    const firstTop = categories.find((c) => !c.parentId)
    // 清理脏数据：卡片可能已被删除
    const cardIdSet = new Set(cards.map((c) => c.id))
    const cleanedEntries = recent.entries.filter((e) => cardIdSet.has(e.cardId))
    set({
      categories,
      cards,
      activeCategoryId: firstTop?.id ?? categories[0]?.id ?? null,
      recentEntries: cleanedEntries,
      recentLimit: recent.limit,
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
      return {
        categoriesAdded: catsToCreate.length,
        cardsAdded: cardsToAdd.length,
        cardsSkipped: importedCards.length - cardsToAdd.length,
      }
    } finally {
      set({ loading: false })
    }
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
      void saveRecentEntries(nextRecent)
    }
    set({
      categories: remaining,
      cards: remainingCards,
      recentEntries: nextRecent,
      activeCategoryId: allDeleteIds.has(get().activeCategoryId ?? '')
        ? remaining[0]?.id ?? null
        : get().activeCategoryId,
    })
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
    return card
  },

  async updateCard(id, patch) {
    const card = get().cards.find((c) => c.id === id)
    if (!card) return
    const updated = { ...card, ...patch, updatedAt: Date.now() }
    await getRepository().saveCard(updated)
    set({ cards: get().cards.map((c) => (c.id === id ? updated : c)) })
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
  },

  async removeCard(id) {
    await getRepository().deleteCard(id)
    // 同步清理"最近使用"，避免出现指向已删卡片的脏记录
    const nextRecent = get().recentEntries.filter((e) => e.cardId !== id)
    const recentChanged = nextRecent.length !== get().recentEntries.length
    if (recentChanged) void saveRecentEntries(nextRecent)
    set({
      cards: get().cards.filter((c) => c.id !== id),
      recentEntries: nextRecent,
    })
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
    await saveRecentEntries(next)
  },

  async setRecentLimit(n) {
    // 合理边界：1 ~ MAX_RECENT_BUFFER
    const clamped = Math.max(1, Math.min(MAX_RECENT_BUFFER, Math.floor(n)))
    if (clamped === get().recentLimit) return
    set({ recentLimit: clamped })
    await browser.storage.local.set({ [RECENT_LIMIT_KEY]: clamped })
  },

  async clearRecent() {
    if (get().recentEntries.length === 0) return
    set({ recentEntries: [] })
    await saveRecentEntries([])
  },

  async loadBrowserHistory(maxResults = MAX_RECENT_BUFFER) {
    // 关闭开关时不加载；防御性检查，避免被误调用拉取数据
    if (!get().settings.recentIncludeBrowserHistory) return
    const items = await fetchBrowserHistory(maxResults)
    set({ browserHistoryItems: items })
  },

  async deleteHistoryUrl(url) {
    // 1. 从浏览器原生历史中删除（如果可用）
    try {
      const api = (browser as unknown as {
        history?: { deleteUrl?: (details: { url: string }) => Promise<void> }
      }).history
      if (api?.deleteUrl) {
        await api.deleteUrl({ url })
      }
    } catch {
      /* ignore: 没权限或浏览器不支持 */
    }
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
    await getRepository().saveSettings(next)

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
}))

/** BFS 收集所有后代分类 ID（与 LocalRepository 中的逻辑对称） */
/**
 * 标签标准化：trim、过滤空、去重、单个 ≤ 12 字符、整体 ≤ 8 个。
 * 在所有 tag 写入前都过一遍，避免脏数据。
 */
function normalizeTags(tags: string[] | undefined | null): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const t = raw.trim().slice(0, 12)
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= 8) break
  }
  return out
}

function collectDescendantIds(ids: string[], allCats: Category[]): Set<string> {
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

/** 简易 groupBy：按 keyFn 分桶 */
function groupBy<T, K>(arr: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of arr) {
    const k = keyFn(item)
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}

/**
 * 从 browser.storage.local 读取「最近使用」相关数据。
 * 故意走 browser.storage 直接访问而不扩 BookmarkRepository 接口：
 * - recent 数据是用户在本扩展内的临时行为日志，与"书签数据"语义不同
 * - 后续如要同步到云端，可单独抽 RecentRepository
 */
async function loadRecentFromStorage(): Promise<{
  entries: RecentEntry[]
  limit: number
}> {
  try {
    const result = await browser.storage.local.get([
      RECENT_ENTRIES_KEY,
      RECENT_LIMIT_KEY,
    ])
    const raw = result[RECENT_ENTRIES_KEY]
    const entries = Array.isArray(raw)
      ? (raw as RecentEntry[]).filter(
          (e) => e && typeof e.cardId === 'string' && typeof e.openedAt === 'number',
        )
      : []
    const limitRaw = result[RECENT_LIMIT_KEY]
    const limit =
      typeof limitRaw === 'number' && limitRaw > 0
        ? Math.min(MAX_RECENT_BUFFER, Math.floor(limitRaw))
        : DEFAULT_RECENT_LIMIT
    return { entries, limit }
  } catch {
    return { entries: [], limit: DEFAULT_RECENT_LIMIT }
  }
}

async function saveRecentEntries(entries: RecentEntry[]): Promise<void> {
  try {
    await browser.storage.local.set({ [RECENT_ENTRIES_KEY]: entries })
  } catch {
    // browser.storage 偶发失败不影响内存状态
  }
}

/**
 * 调用 browser.history.search 拉取最近浏览器历史。
 *
 * 实现说明：
 * - WXT 的 browser 类型并非所有浏览器/版本都默认包含 history 字段，
 *   这里通过窄化的 unknown 断言访问，避免硬编码 chrome.* 失去 firefox 兼容
 * - text: '' 表示不限关键字；startTime: 0 表示自浏览器有记录起
 * - 返回结果统一映射为 { url, title, lastVisit }，并按 lastVisit 倒序
 * - 任何异常都吞掉返回空数组，保证 UI 不崩
 */
async function fetchBrowserHistory(maxResults: number): Promise<BrowserHistoryItem[]> {
  type RawHistoryItem = {
    url?: string
    title?: string
    lastVisitTime?: number
  }
  type HistoryApi = {
    search?: (query: {
      text: string
      startTime?: number
      maxResults?: number
    }) => Promise<RawHistoryItem[]>
  }
  try {
    const api = (browser as unknown as { history?: HistoryApi }).history
    if (!api?.search) return []
    const raw = await api.search({
      text: '',
      startTime: 0,
      maxResults,
    })
    return raw
      .filter((it): it is RawHistoryItem & { url: string } => !!it.url)
      .map((it) => ({
        url: it.url,
        title: it.title?.trim() || it.url,
        lastVisit: typeof it.lastVisitTime === 'number' ? it.lastVisitTime : 0,
      }))
      .sort((a, b) => b.lastVisit - a.lastVisit)
  } catch {
    return []
  }
}
