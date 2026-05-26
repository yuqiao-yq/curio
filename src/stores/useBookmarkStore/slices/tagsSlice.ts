import type { BookmarkCard } from '../../../types/bookmark'
import { getRepository } from '../../../repositories'
import { normalizeTags } from '../helpers'
import { scheduleBookmarksSyncPush } from '../scheduler'
import type { BookmarkState, StoreGet, StoreSet } from '../types'

/* ──────────────────────────────────────────────────────────────────────
 * 标签批量操作。
 *
 * 设计：所有写入都过 normalizeTags（trim / 去重 / ≤12 字符 / ≤8 个），
 * renameTag/mergeTags/removeTag 三个全库 action 共享"仅持久化变更项"的
 * 模式，避免无谓写盘。
 * ────────────────────────────────────────────────────────────────────── */

type TagsSlice = Pick<
  BookmarkState,
  'setCardTags' | 'setCardTagsBatch' | 'renameTag' | 'mergeTags' | 'removeTag'
>

export const createTagsSlice = (
  set: StoreSet,
  get: StoreGet,
): TagsSlice => ({
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
})
