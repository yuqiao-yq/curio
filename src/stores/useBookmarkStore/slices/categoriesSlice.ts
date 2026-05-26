import { v4 as uuid } from 'uuid'
import type { Category } from '../../../types/bookmark'
import { getRepository, getRecentRepository } from '../../../repositories'
import { collectDescendantIds } from '../helpers'
import { scheduleBookmarksSyncPush } from '../scheduler'
import type { BookmarkState, StoreGet, StoreSet } from '../types'

/* ──────────────────────────────────────────────────────────────────────
 * 分类 CRUD + 排序 + 跨父级移动。
 *
 * 关键不变量：
 *   - 同父级（parentId 相同）下，order 必须是连续 0..n-1（保证 reorder 不出空洞）
 *   - 删除分类时级联清理后代 + 同步清"最近使用"中指向已删卡片的脏记录
 *   - moveCategory 校验循环引用，禁止移到自己的后代下
 * ────────────────────────────────────────────────────────────────────── */

type CategoriesSlice = Pick<
  BookmarkState,
  | 'addCategory'
  | 'renameCategory'
  | 'updateCategory'
  | 'removeCategory'
  | 'removeCategories'
  | 'reorderCategories'
  | 'reorderSiblings'
  | 'moveCategory'
>

export const createCategoriesSlice = (
  set: StoreSet,
  get: StoreGet,
): CategoriesSlice => ({
  async addCategory(name, icon, parentId) {
    const now = Date.now()
    // order 取同一父级（顶层 = parentId 为空）下的现有数量，避免新分类排到陌生位置
    const siblingCount = get().categories.filter(
      (c) => (c.parentId ?? '') === (parentId ?? ''),
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
    await getRepository().deleteCategories(ids) // repo 内部会级联
    const remaining = allCats.filter((c) => !allDeleteIds.has(c.id))
    const remainingCards = allCards.filter(
      (c) => !allDeleteIds.has(c.categoryId),
    )
    // 同步清理"最近使用"中已被级联删除的卡片
    const removedCardIds = new Set(
      allCards.filter((c) => allDeleteIds.has(c.categoryId)).map((c) => c.id),
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
        ? (remaining[0]?.id ?? null)
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
})
