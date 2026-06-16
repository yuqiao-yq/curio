/**
 * bookmarkExporter 测试
 *
 * 起因：用户报"多次同步后浏览器侧文件夹在但书签都没了，toast 清理数 > 0"
 * 高度怀疑 pruneStrangers 在某些 case 下把刚同步上去的书签也误删了。
 *
 * 这里用一个内存版 chrome.bookmarks 跑完整的 exportToBrowserBookmarks，
 * 直接对比同步后浏览器侧的树形结构，看到底丢没丢。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exportToBrowserBookmarks } from './bookmarkExporter'
import type { BookmarkCard, Category } from '../types/bookmark'
import type { Browser } from 'wxt/browser'

type Node = Browser.bookmarks.BookmarkTreeNode

/* ─── 内存版 bookmarks API ────────────────────────────── */

interface MemNode {
  id: string
  title: string
  url?: string
  parentId?: string
  children?: MemNode[]
}

let store: Map<string, MemNode>
let nextId: number

function freshStore() {
  store = new Map()
  nextId = 1000
  // Chrome 风格：root(0) → [书签栏(1), 其他书签(2)]
  const root: MemNode = { id: '0', title: '', children: [] }
  const bar: MemNode = { id: '1', title: 'Bookmarks bar', parentId: '0', children: [] }
  const other: MemNode = { id: '2', title: 'Other bookmarks', parentId: '0', children: [] }
  root.children = [bar, other]
  store.set('0', root)
  store.set('1', bar)
  store.set('2', other)
}

function cloneToTreeNode(n: MemNode): Node {
  return {
    id: n.id,
    title: n.title,
    url: n.url,
    parentId: n.parentId,
    children: n.children?.map(cloneToTreeNode),
  } as Node
}

function installMockBookmarks() {
  const api = {
    getTree: vi.fn(async () => [cloneToTreeNode(store.get('0')!)]),
    getChildren: vi.fn(async (parentId: string) => {
      const p = store.get(parentId)
      if (!p) throw new Error('no such id ' + parentId)
      return (p.children ?? []).map(cloneToTreeNode)
    }),
    get: vi.fn(async (id: string) => {
      const n = store.get(id)
      if (!n) throw new Error('no such id ' + id)
      return [cloneToTreeNode(n)]
    }),
    create: vi.fn(
      async (params: { parentId: string; title: string; url?: string }) => {
        const id = String(nextId++)
        const node: MemNode = {
          id,
          title: params.title,
          url: params.url,
          parentId: params.parentId,
        }
        if (!params.url) node.children = []
        store.set(id, node)
        const parent = store.get(params.parentId)
        if (!parent) throw new Error('no such parent ' + params.parentId)
        parent.children = [...(parent.children ?? []), node]
        return cloneToTreeNode(node)
      },
    ),
    update: vi.fn(
      async (id: string, patch: { title?: string; url?: string }) => {
        const n = store.get(id)
        if (!n) throw new Error('no such id ' + id)
        if (patch.title !== undefined) n.title = patch.title
        if (patch.url !== undefined) n.url = patch.url
        return cloneToTreeNode(n)
      },
    ),
    move: vi.fn(async (id: string, dest: { parentId: string }) => {
      const n = store.get(id)
      if (!n) throw new Error('no such id ' + id)
      const oldParent = n.parentId ? store.get(n.parentId) : undefined
      if (oldParent) {
        oldParent.children = (oldParent.children ?? []).filter((c) => c.id !== id)
      }
      const newParent = store.get(dest.parentId)
      if (!newParent) throw new Error('no such parent ' + dest.parentId)
      n.parentId = dest.parentId
      newParent.children = [...(newParent.children ?? []), n]
      return cloneToTreeNode(n)
    }),
    remove: vi.fn(async (id: string) => {
      const n = store.get(id)
      if (!n) return
      const parent = n.parentId ? store.get(n.parentId) : undefined
      if (parent) {
        parent.children = (parent.children ?? []).filter((c) => c.id !== id)
      }
      store.delete(id)
    }),
    removeTree: vi.fn(async (id: string) => {
      const n = store.get(id)
      if (!n) return
      const collectIds = (m: MemNode): string[] => [
        m.id,
        ...(m.children ?? []).flatMap(collectIds),
      ]
      const ids = collectIds(n)
      const parent = n.parentId ? store.get(n.parentId) : undefined
      if (parent) {
        parent.children = (parent.children ?? []).filter((c) => c.id !== id)
      }
      ids.forEach((i) => store.delete(i))
    }),
    search: vi.fn(async () => []),
  }
  ;(chrome as unknown as { bookmarks: typeof api }).bookmarks = api
  ;(globalThis as unknown as { browser: { bookmarks: typeof api } }).browser.bookmarks = api
}

/* ─── helpers ─────────────────────────────────────────── */

function mkCat(over: Partial<Category> = {}): Category {
  return {
    id: 'cat-x',
    name: 'Default',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}
function mkCard(over: Partial<BookmarkCard> = {}): BookmarkCard {
  return {
    id: 'card-x',
    categoryId: 'cat-x',
    title: 'Example',
    url: 'https://example.com/',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

/** 找出 mirrorFolder 下"文件夹 X"，返回它的子节点（按存储顺序） */
function listFolderItems(folderTitle: string): MemNode[] {
  for (const n of store.values()) {
    if (!n.url && n.title === folderTitle && n.parentId) {
      return n.children ?? []
    }
  }
  return []
}

/* ─── 测试 ────────────────────────────────────────────── */

beforeEach(() => {
  freshStore()
  installMockBookmarks()
})

describe('exportToBrowserBookmarks: 多次同步回归', () => {
  it('首次同步：cat + cards 全部进浏览器', async () => {
    const cats = [mkCat({ id: 'A', name: '文件夹A' })]
    const cards = Array.from({ length: 7 }, (_, i) =>
      mkCard({
        id: 'c' + i,
        categoryId: 'A',
        title: 'T' + i,
        url: `https://t${i}.com/`,
        order: i,
      }),
    )

    const r = await exportToBrowserBookmarks(cats, cards, {
      root: 'bookmarks_bar',
      folderName: 'Curio',
    })

    expect(r.foldersCreated).toBe(1)
    expect(r.bookmarksCreated).toBe(7)
    expect(r.nodesRemoved).toBe(0)
    expect(r.errors).toEqual([])

    const items = listFolderItems('文件夹A')
    expect(items).toHaveLength(7)
    expect(items.every((n) => !!n.url)).toBe(true)
  })

  it('🔥 BUG 复现：先同步 3 张 → Curio 加 4 张但 bookmarkId 已回写 → 二次同步后浏览器侧应该 7 张全在', async () => {
    // ─── 第一次：3 张卡，全部新建 ───
    const cats: Category[] = [mkCat({ id: 'A', name: '文件夹A' })]
    const cards: BookmarkCard[] = [
      mkCard({ id: 'c0', categoryId: 'A', title: 'T0', url: 'https://t0.com/', order: 0 }),
      mkCard({ id: 'c1', categoryId: 'A', title: 'T1', url: 'https://t1.com/', order: 1 }),
      mkCard({ id: 'c2', categoryId: 'A', title: 'T2', url: 'https://t2.com/', order: 2 }),
    ]
    const r1 = await exportToBrowserBookmarks(cats, cards, {
      root: 'bookmarks_bar',
      folderName: 'Curio',
    })
    expect(r1.bookmarksCreated).toBe(3)

    // 模拟外层 lifecycleSlice.exportToBrowser 的"回写 bookmarkId"
    cats[0].bookmarkId = r1.categoryIdToBookmarkId.get('A')!
    cards.forEach((c) => {
      c.bookmarkId = r1.cardIdToBookmarkId.get(c.id)!
    })

    // ─── Curio 中又新增了 4 张（没 bookmarkId） ───
    cards.push(
      mkCard({ id: 'c3', categoryId: 'A', title: 'T3', url: 'https://t3.com/', order: 3 }),
      mkCard({ id: 'c4', categoryId: 'A', title: 'T4', url: 'https://t4.com/', order: 4 }),
      mkCard({ id: 'c5', categoryId: 'A', title: 'T5', url: 'https://t5.com/', order: 5 }),
      mkCard({ id: 'c6', categoryId: 'A', title: 'T6', url: 'https://t6.com/', order: 6 }),
    )

    // ─── 第二次同步 ───
    const r2 = await exportToBrowserBookmarks(cats, cards, {
      root: 'bookmarks_bar',
      folderName: 'Curio',
    })

    const items = listFolderItems('文件夹A')

    // 期望：浏览器侧"文件夹A"里有 7 张书签
    expect(r2.errors).toEqual([])
    expect(items).toHaveLength(7)
    // 新增 4 张，旧 3 张复用
    expect(r2.bookmarksCreated).toBe(4)
    // ⚠️ 关键：不应该把旧 3 张清掉
    expect(r2.nodesRemoved).toBe(0)
  })

  it('🔥 用户跨设备同步：Curio 数据带了"陌生设备的 bookmarkId" → 不应误删本设备真实节点', async () => {
    // 模拟 applyRemoteBookmarks 把云端数据写到本机：
    // - bookmarkId 是远端设备记录的浏览器节点 id，对本机来说是"野指针"
    // - 本机浏览器里其实根本没有这些 id
    // - 但本机过去其实自己同步过一次，旧节点还在浏览器里
    const cats: Category[] = [mkCat({ id: 'A', name: '文件夹A' })]
    const cards: BookmarkCard[] = [
      mkCard({ id: 'c0', categoryId: 'A', title: 'T0', url: 'https://t0.com/', order: 0 }),
      mkCard({ id: 'c1', categoryId: 'A', title: 'T1', url: 'https://t1.com/', order: 1 }),
    ]
    // 第一次 export 在"本机"产生真实节点
    const r1 = await exportToBrowserBookmarks(cats, cards, {
      root: 'bookmarks_bar',
      folderName: 'Curio',
    })
    cats[0].bookmarkId = r1.categoryIdToBookmarkId.get('A')!
    cards.forEach((c) => (c.bookmarkId = r1.cardIdToBookmarkId.get(c.id)!))

    // 模拟跨设备同步：远端 push 下来一份新数据，bookmarkId 是"另一台设备"的
    // → 在本机这些 id 是无效的（对应不到节点）
    cats[0].bookmarkId = 'remote-folder-id-9999'
    cards[0].bookmarkId = 'remote-card-id-8888'
    cards[1].bookmarkId = 'remote-card-id-7777'
    cards.push(
      mkCard({ id: 'c2', categoryId: 'A', title: 'T2', url: 'https://t2.com/', order: 2 }),
    )

    const r2 = await exportToBrowserBookmarks(cats, cards, {
      root: 'bookmarks_bar',
      folderName: 'Curio',
    })

    const items = listFolderItems('文件夹A')
    expect(r2.errors).toEqual([])
    // 期望：3 张（2 旧复用 + 1 新建），不应该把旧 2 张当陌生节点清掉
    expect(items).toHaveLength(3)
    const urls = items.map((n) => n.url).sort()
    expect(urls).toEqual([
      'https://t0.com/',
      'https://t1.com/',
      'https://t2.com/',
    ])
  })

  it('🔥 用户先删了部分 cards 后新增了 cards：应该只清掉被删的，不能把新增的也清掉', async () => {
    const cats: Category[] = [mkCat({ id: 'A', name: '文件夹A' })]
    const cards: BookmarkCard[] = [
      mkCard({ id: 'c0', categoryId: 'A', title: 'T0', url: 'https://t0.com/', order: 0 }),
      mkCard({ id: 'c1', categoryId: 'A', title: 'T1', url: 'https://t1.com/', order: 1 }),
      mkCard({ id: 'c2', categoryId: 'A', title: 'T2', url: 'https://t2.com/', order: 2 }),
    ]
    const r1 = await exportToBrowserBookmarks(cats, cards, {
      root: 'bookmarks_bar',
      folderName: 'Curio',
    })
    cats[0].bookmarkId = r1.categoryIdToBookmarkId.get('A')!
    cards.forEach((c) => (c.bookmarkId = r1.cardIdToBookmarkId.get(c.id)!))

    // Curio 中：c0 被删除；新增 c3, c4
    const updatedCards = [
      cards[1], // c1
      cards[2], // c2
      mkCard({ id: 'c3', categoryId: 'A', title: 'T3', url: 'https://t3.com/', order: 3 }),
      mkCard({ id: 'c4', categoryId: 'A', title: 'T4', url: 'https://t4.com/', order: 4 }),
    ]

    const r2 = await exportToBrowserBookmarks(cats, updatedCards, {
      root: 'bookmarks_bar',
      folderName: 'Curio',
    })

    const items = listFolderItems('文件夹A')
    expect(items).toHaveLength(4)
    const urls = items.map((n) => n.url).sort()
    expect(urls).toEqual([
      'https://t1.com/',
      'https://t2.com/',
      'https://t3.com/',
      'https://t4.com/',
    ])
    expect(r2.nodesRemoved).toBe(1) // 只删了 c0 对应的节点
  })

  it('🔥 BUG 灾难场景：cards.bookmarkId 全员错位 + url 同 → url 兜底必须保留旧节点', async () => {
    // 第一次正常同步建立旧节点
    const cats: Category[] = [mkCat({ id: 'A', name: '文件夹A' })]
    const cards: BookmarkCard[] = Array.from({ length: 7 }, (_, i) =>
      mkCard({
        id: 'c' + i,
        categoryId: 'A',
        title: 'T' + i,
        url: `https://t${i}.com/`,
        order: i,
      }),
    )
    const r1 = await exportToBrowserBookmarks(cats, cards, {
      root: 'bookmarks_bar',
      folderName: 'Curio',
    })
    expect(r1.bookmarksCreated).toBe(7)
    const folderId = r1.categoryIdToBookmarkId.get('A')!

    // 灾难态：bookmarkId 全员被错误地改成"陌生设备的 id"
    cats[0].bookmarkId = 'remote-folder-id-99999'
    cards.forEach((c, i) => (c.bookmarkId = `remote-card-id-${i}`))

    // 第二次同步
    const r2 = await exportToBrowserBookmarks(cats, cards, {
      root: 'bookmarks_bar',
      folderName: 'Curio',
    })

    const items = listFolderItems('文件夹A')
    // 期望：7 张旧节点全部保留（要么 step 2 复用，要么 url 兜底保留）
    expect(items).toHaveLength(7)
    // 没有错误
    expect(r2.errors).toEqual([])
    // folder 也复用了同一个
    expect(r2.categoryIdToBookmarkId.get('A')).toBe(folderId)
  })

  it('🔥 BUG 灾难场景：cards 非空但全部 sync 失败 → 保险丝必须阻止 prune 清空文件夹', async () => {
    // 先建立旧节点
    const cats: Category[] = [mkCat({ id: 'A', name: '文件夹A' })]
    const cards: BookmarkCard[] = Array.from({ length: 5 }, (_, i) =>
      mkCard({
        id: 'c' + i,
        categoryId: 'A',
        title: 'T' + i,
        url: `https://t${i}.com/`,
        order: i,
      }),
    )
    await exportToBrowserBookmarks(cats, cards, {
      root: 'bookmarks_bar',
      folderName: 'Curio',
    })
    expect(listFolderItems('文件夹A')).toHaveLength(5)

    // 注入故障：所有 syncCardBookmark 涉及的 create 都抛错
    // （cards 没 bookmarkId，会走 step 3 → create 失败）
    const newCards: BookmarkCard[] = cards.map((c) => ({
      ...c,
      bookmarkId: undefined,
    }))
    // 把 mirror 下的旧节点 url 都篡改，让 step 2 也找不到同 url
    for (const n of store.values()) {
      if (n.url) n.url = n.url + '?changed'
    }
    // chrome.bookmarks.create 改成全部 reject
    const origCreate = chrome.bookmarks.create as unknown as ReturnType<
      typeof vi.fn
    >
    origCreate.mockImplementation(async () => {
      throw new Error('mocked: create blocked')
    })

    const r = await exportToBrowserBookmarks(cats, newCards, {
      root: 'bookmarks_bar',
      folderName: 'Curio',
    })

    // 保险丝触发：errors 包含 prune 跳过提示
    expect(r.errors.some((e) => e.includes('跳过镜像清理'))).toBe(true)
    // 关键：旧 5 张节点不应该被 prune 清空
    expect(listFolderItems('文件夹A')).toHaveLength(5)
  })

  it('用户在浏览器中手动删了 Curio 镜像下的某个 card 节点 → 二次同步应重新建回来', async () => {
    const cats: Category[] = [mkCat({ id: 'A', name: '文件夹A' })]
    const cards: BookmarkCard[] = [
      mkCard({ id: 'c0', categoryId: 'A', title: 'T0', url: 'https://t0.com/', order: 0 }),
    ]
    const r1 = await exportToBrowserBookmarks(cats, cards, {
      root: 'bookmarks_bar',
      folderName: 'Curio',
    })
    cards[0].bookmarkId = r1.cardIdToBookmarkId.get('c0')!
    cats[0].bookmarkId = r1.categoryIdToBookmarkId.get('A')!

    // 用户在浏览器侧手动删了那个书签
    await (chrome as unknown as { bookmarks: { remove: (id: string) => Promise<void> } })
      .bookmarks.remove(cards[0].bookmarkId)

    const r2 = await exportToBrowserBookmarks(cats, cards, {
      root: 'bookmarks_bar',
      folderName: 'Curio',
    })
    const items = listFolderItems('文件夹A')
    expect(items).toHaveLength(1)
    expect(items[0].url).toBe('https://t0.com/')
    expect(r2.errors).toEqual([])
  })
})
