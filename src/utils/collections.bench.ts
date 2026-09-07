import { bench, describe } from 'vitest'
import { selectCollection, INBOX_ID } from './collections'
import { searchBookmarks } from './searchBookmarks'

for (const size of [100, 1000, 5000]) {
  const cards = Array.from({ length: size }, (_, i) => ({
    id: String(i),
    categoryId: i % 4 ? 'work' : INBOX_ID,
    title: `资料 ${i} ${i % 20 ? '文档' : '数据库'}`,
    url: `https://example.com/${i}`,
    createdAt: (i * 7919) % size,
    updatedAt: (i * 7919) % size,
    order: i,
  }))
  describe(`${size} 书签`, () => {
    bench(
      '搜索全部匹配',
      () => {
        searchBookmarks(cards, '数据库')
      },
      { time: 1000, iterations: 20 },
    )
    bench(
      '最近收藏排序',
      () => {
        selectCollection(cards, 'recent')
      },
      { time: 1000, iterations: 20 },
    )
  })
}
