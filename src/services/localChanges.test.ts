import { afterEach, expect, it } from 'vitest'
import { waitFor } from '@testing-library/react'
import { subscribeLocalChanges } from './localChanges'
import { LOCAL_CHANGE_KEY } from './storageLock'
import { useBookmarkStore } from '../stores/useBookmarkStore'
import { localRepo } from '../repositories/LocalRepository'

let unsubscribe: (() => void) | undefined
afterEach(() => unsubscribe?.())

it('其它页面提交刷新书签，并保留当前分类与搜索', async () => {
  const cat = { id: 'a', name: 'A', order: 0, createdAt: 1, updatedAt: 1 }
  await localRepo.saveCategory(cat)
  useBookmarkStore.setState({
    cards: [],
    categories: [cat],
    activeCategoryId: 'a',
    searchKeyword: '查找',
  })
  unsubscribe = subscribeLocalChanges()
  await chrome.storage.local.set({
    'curio:cards': [
      {
        id: 'from-popup',
        categoryId: 'a',
        title: 'Popup',
        url: 'https://example.com',
        order: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    [LOCAL_CHANGE_KEY]: { writer: 'other-context', revision: '2' },
  })
  await waitFor(() => expect(useBookmarkStore.getState().cards[0]?.id).toBe('from-popup'))
  expect(useBookmarkStore.getState().activeCategoryId).toBe('a')
  expect(useBookmarkStore.getState().searchKeyword).toBe('查找')
})
