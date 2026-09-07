import type { BookmarkCard } from '../types/bookmark'

export const INBOX_ID = 'curio:inbox'
export type CollectionView = 'inbox' | 'recent' | 'untagged'
export const COLLECTION_LABELS: Record<CollectionView, string> = {
  inbox: '收件箱',
  recent: '最近收藏',
  untagged: '无标签',
}

export function selectCollection(cards: BookmarkCard[], view: CollectionView): BookmarkCard[] {
  const selected =
    view === 'inbox'
      ? cards.filter((c) => c.categoryId === INBOX_ID)
      : view === 'untagged'
        ? cards.filter((c) => !c.tags?.length)
        : [...cards]
  return selected.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
}
