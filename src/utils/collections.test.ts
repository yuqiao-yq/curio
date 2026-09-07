import { expect, it } from 'vitest'
import { INBOX_ID, selectCollection } from './collections'
import type { BookmarkCard } from '../types/bookmark'

it('智能视图筛选不修改原数据，最近收藏按时间排序', () => {
  const cards: BookmarkCard[] = [
    {
      id: 'a',
      categoryId: INBOX_ID,
      title: 'a',
      url: 'https://a.com',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: 'b',
      categoryId: 'work',
      title: 'b',
      url: 'https://b.com',
      tags: ['work'],
      order: 0,
      createdAt: 2,
      updatedAt: 2,
    },
  ]
  expect(selectCollection(cards, 'inbox').map((c) => c.id)).toEqual(['a'])
  expect(selectCollection(cards, 'untagged').map((c) => c.id)).toEqual(['a'])
  expect(selectCollection(cards, 'recent').map((c) => c.id)).toEqual(['b', 'a'])
  expect(cards.map((c) => c.id)).toEqual(['a', 'b'])
})
