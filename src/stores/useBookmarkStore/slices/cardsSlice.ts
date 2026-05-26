import { v4 as uuid } from 'uuid'
import type { BookmarkCard } from '../../../types/bookmark'
import { getRepository, getRecentRepository } from '../../../repositories'
import { normalizeTags } from '../helpers'
import { scheduleBookmarksSyncPush } from '../scheduler'
import type { BookmarkState, StoreGet, StoreSet } from '../types'

/* ──────────────────────────────────────────────────────────────────────
 * 卡片 CRUD + 跨分类移动 + 单分类内重排。
 *
 * 性能要点：
 *   - moveCard / reorderCardsInCategory 采用 v0.21.14 起的"先 setState 再 await
 *     持久化"乐观更新模式，避免 dnd-kit 拖拽结束后视觉回弹。
 * ────────────────────────────────────────────────────────────────────── */

type CardsSlice = Pick<
  BookmarkState,
  'addCard' | 'updateCard' | 'removeCard' | 'moveCard' | 'reorderCardsInCategory'
>

export const createCardsSlice = (
  set: StoreSet,
  get: StoreGet,
): CardsSlice => ({
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
      cards.filter((c) => c.categoryId === categoryId),
    )
    scheduleBookmarksSyncPush()
  },
})
