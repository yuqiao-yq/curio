import type { BookmarkCard } from '../types/bookmark'

export function searchBookmarks(
  cards: BookmarkCard[],
  query: string,
  limit = Infinity,
): BookmarkCard[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const result: BookmarkCard[] = []
  for (const card of cards) {
    if (card.title.toLowerCase().includes(q) || card.url.toLowerCase().includes(q)) {
      result.push(card)
      if (result.length >= limit) break
    }
  }
  return result
}
