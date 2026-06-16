/**
 * lifecycleSlice.importFromBrowser 集成回归测试
 *
 * 起因：用户报"从浏览器导入只导了目录结构，文件夹都是空的"。
 * 这层测试直接打 store action，验证：
 *  - 首次导入：分类 + 卡片都进库；activeCategoryId 命中第一个顶层
 *  - 二次导入相同数据：去重生效，不重复落卡
 *  - 本地已有同名分类：cards 正确 remap 到本地 id 下
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from 'wxt/browser'
import { useBookmarkStore } from '..'

type Node = Browser.bookmarks.BookmarkTreeNode

function folder(id: string, title: string, children: Node[] = []): Node {
  return { id, title, children } as Node
}
function bm(id: string, title: string, url: string): Node {
  return { id, title, url } as Node
}

function setBookmarksTree(top: Node[]) {
  const rootTree: Node[] = [{ id: '0', title: '', children: top } as Node]
  ;(chrome.bookmarks.getTree as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(rootTree)
}

beforeEach(() => {
  // 重置 store 到干净状态（setup.ts 已 _reset storage，但 zustand 内存还在）
  useBookmarkStore.setState({
    categories: [],
    cards: [],
    activeCategoryId: null,
    initialized: false,
  })
  setBookmarksTree([])
})

describe('lifecycleSlice.importFromBrowser', () => {
  it('首次导入：分类 + 卡片都进库，state.cards 不为空', async () => {
    setBookmarksTree([
      folder('bar', '书签栏', [
        bm('b1', 'Google', 'https://google.com/'),
        folder('work', '工作', [
          bm('b2', 'Jira', 'https://jira.com/'),
        ]),
      ]),
    ])

    const result = await useBookmarkStore.getState().importFromBrowser()

    // 关键断言：cards 不能为 0
    expect(result.cardsAdded).toBe(2)
    expect(result.categoriesAdded).toBe(2)

    const { categories, cards } = useBookmarkStore.getState()
    expect(categories.map((c) => c.name).sort()).toEqual(['书签栏', '工作'])
    expect(cards).toHaveLength(2)
    expect(cards.map((c) => c.url).sort()).toEqual([
      'https://google.com/',
      'https://jira.com/',
    ])

    // 卡片必须挂在对应分类下，不能成孤儿
    const bar = categories.find((c) => c.name === '书签栏')!
    const work = categories.find((c) => c.name === '工作')!
    expect(cards.find((c) => c.bookmarkId === 'b1')?.categoryId).toBe(bar.id)
    expect(cards.find((c) => c.bookmarkId === 'b2')?.categoryId).toBe(work.id)
  })

  it('二次导入相同数据：cards 全部按 (categoryId, url) 去重，0 新增', async () => {
    setBookmarksTree([
      folder('bar', '书签栏', [bm('b1', 'G', 'https://g.com/')]),
    ])

    await useBookmarkStore.getState().importFromBrowser()
    const second = await useBookmarkStore.getState().importFromBrowser()

    expect(second.categoriesAdded).toBe(0)
    expect(second.cardsAdded).toBe(0)
    expect(second.cardsSkipped).toBe(1)

    // 库内仍只有 1 张卡，没被复制
    expect(useBookmarkStore.getState().cards).toHaveLength(1)
  })

  it('本地已有同名顶层分类：导入的 cards 应 remap 到本地分类 id 下', async () => {
    // 先手动塞一个本地"书签栏"分类
    const localCat = {
      id: 'local-bar',
      name: '书签栏',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    await import('../../../repositories').then((m) =>
      m.getRepository().saveCategories([localCat])
    )

    setBookmarksTree([
      folder('bar', '书签栏', [bm('b1', 'G', 'https://g.com/')]),
    ])

    await useBookmarkStore.getState().importFromBrowser()

    const { categories, cards } = useBookmarkStore.getState()
    // 不应新建第二个"书签栏"
    expect(categories.filter((c) => c.name === '书签栏')).toHaveLength(1)
    // card 必须挂在本地分类下
    expect(cards).toHaveLength(1)
    expect(cards[0].categoryId).toBe('local-bar')
  })

  it('真实 Chrome 风格的树（root 有多层级容器）：所有书签都能进库', async () => {
    const realTree = [
      {
        id: '0',
        title: '',
        children: [
          {
            id: '1',
            title: 'Bookmarks bar',
            parentId: '0',
            children: [
              { id: '101', title: 'Google', url: 'https://google.com/', parentId: '1' },
              {
                id: '102',
                title: 'Work',
                parentId: '1',
                children: [
                  { id: '201', title: 'Jira', url: 'https://jira.com/', parentId: '102' },
                  { id: '202', title: 'Confluence', url: 'https://conf.com/', parentId: '102' },
                ],
              },
            ],
          },
          {
            id: '2',
            title: 'Other bookmarks',
            parentId: '0',
            children: [
              { id: '301', title: 'Random', url: 'https://random.com/', parentId: '2' },
            ],
          },
          {
            id: '3',
            title: 'Mobile bookmarks',
            parentId: '0',
            children: [],
          },
        ],
      },
    ]
    ;(chrome.bookmarks.getTree as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(realTree)

    const r = await useBookmarkStore.getState().importFromBrowser()
    expect(r.cardsAdded).toBe(4)
    const { cards } = useBookmarkStore.getState()
    expect(cards.map((c) => c.url).sort()).toEqual([
      'https://conf.com/',
      'https://google.com/',
      'https://jira.com/',
      'https://random.com/',
    ])
  })
})
