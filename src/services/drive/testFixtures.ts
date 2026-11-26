import { DEFAULT_SETTINGS, type ExportData } from '../../types/bookmark'
export const fixture = (): ExportData => ({
  version: '1.0',
  exportedAt: 0,
  settings: { ...DEFAULT_SETTINGS },
  categories: [
    {
      id: 'folder',
      name: 'Work',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
      bookmarkId: 'native-folder',
    },
  ],
  cards: ['a', 'b', 'c'].map((id, order) => ({
    id,
    categoryId: 'folder',
    title: id,
    url: `https://${id}.example.com`,
    order,
    createdAt: 1,
    updatedAt: 1,
    bookmarkId: `native-${id}`,
  })),
})
