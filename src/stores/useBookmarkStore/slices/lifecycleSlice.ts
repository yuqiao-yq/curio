import type { BookmarkCard, Category } from '../../../types/bookmark'
import { getRecentRepository, getRepository } from '../../../repositories'
import { importFromBrowserBookmarks } from '../../../services/bookmarkImporter'
import { exportToBrowserBookmarks } from '../../../services/bookmarkExporter'
import { groupBy } from '../helpers'
import { scheduleBookmarksSyncPush } from '../scheduler'
import type { BookmarkState, StoreGet, StoreSet } from '../types'

/* ──────────────────────────────────────────────────────────────────────
 * 生命周期 + 浏览器书签互通。
 *
 * 三个 action：
 *   - init                 启动初始化：并行读 4 个表 + 默认激活分类 + 清脏数据
 *   - importFromBrowser    从浏览器原生书签合并导入（按"同父+同名"分类匹配 /
 *                          按 (categoryId, url) 卡片去重）
 *   - exportToBrowser      把本地数据镜像写到浏览器原生书签 + 回写 bookmarkId
 * ────────────────────────────────────────────────────────────────────── */

type LifecycleSlice = Pick<
  BookmarkState,
  'init' | 'importFromBrowser' | 'exportToBrowser'
>

export const createLifecycleSlice = (
  set: StoreSet,
  get: StoreGet,
): LifecycleSlice => ({
  async init() {
    set({ loading: true })
    const repo = getRepository()
    const recentRepo = getRecentRepository()
    const [categories, cards, recentEntries, recentLimit, settings] =
      await Promise.all([
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
        categoryId: newIdToFinalId.get(card.categoryId) ?? card.categoryId,
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
})
