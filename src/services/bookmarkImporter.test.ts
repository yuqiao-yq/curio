/**
 * bookmarkImporter 测试
 *
 * 覆盖：
 *  - 每个文件夹独立成 category；只收"直接子层" url
 *  - parentId 链路：树形结构正确还原
 *  - 空文件夹（无书签 + 无子文件夹）→ 跳过
 *  - 无 children 根节点 / 无 bookmarks API → 空结果
 *  - 卡片记录 bookmarkId（用于后续与浏览器原生书签关联）
 *  - 同层 order 单调递增
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importFromBrowserBookmarks } from './bookmarkImporter'
import type { Browser } from 'wxt/browser'

type Node = Browser.bookmarks.BookmarkTreeNode

function folder(id: string, title: string, children: Node[] = []): Node {
  return { id, title, children } as Node
}
function bm(id: string, title: string, url: string): Node {
  return { id, title, url } as Node
}

/** 把一棵根树灌进 chrome.bookmarks.getTree 的 mock */
function setBookmarksTree(top: Node[]) {
  const rootTree: Node[] = [{ id: '0', title: '', children: top } as Node]
  // setup.ts 里的 chrome.bookmarks.getTree 是 vi.fn(()=>Promise.resolve([]))
  // 直接覆盖实现
  ;(chrome.bookmarks.getTree as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(rootTree)
}

afterEach(() => {
  vi.clearAllMocks()
})

beforeEach(() => {
  // 默认空树，免得某个 case 忘记 setBookmarksTree
  setBookmarksTree([])
})

// ─── 边界 ────────────────────────────────────────────

describe('importFromBrowserBookmarks: 边界', () => {
  it('空根 → 空结果', async () => {
    setBookmarksTree([])
    const r = await importFromBrowserBookmarks()
    expect(r.categories).toEqual([])
    expect(r.cards).toEqual([])
  })

  it('根没有 children → 空结果', async () => {
    ;(chrome.bookmarks.getTree as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: '0', title: '' } as Node,
    ])
    const r = await importFromBrowserBookmarks()
    expect(r.categories).toEqual([])
    expect(r.cards).toEqual([])
  })

  it('完全空的顶层文件夹（无 url 无 sub） → 跳过', async () => {
    setBookmarksTree([folder('top1', '空文件夹', [])])
    const r = await importFromBrowserBookmarks()
    expect(r.categories).toEqual([])
    expect(r.cards).toEqual([])
  })

  it('chrome.bookmarks 不可用 → 空结果而不是抛错', async () => {
    const orig = chrome.bookmarks
    // @ts-expect-error: 临时模拟「不支持 bookmarks API」环境
    chrome.bookmarks = undefined
    try {
      const r = await importFromBrowserBookmarks()
      expect(r.categories).toEqual([])
      expect(r.cards).toEqual([])
    } finally {
      chrome.bookmarks = orig
    }
  })
})

// ─── 主流程：层级 + 直接子层 ─────────────────────────

describe('importFromBrowserBookmarks: 层级', () => {
  it('扁平：单文件夹下 N 个书签 → 1 category + N 卡片', async () => {
    setBookmarksTree([
      folder('bar', '书签栏', [
        bm('b1', 'Google', 'https://google.com/'),
        bm('b2', 'GitHub', 'https://github.com/'),
      ]),
    ])
    const r = await importFromBrowserBookmarks()
    expect(r.categories).toHaveLength(1)
    expect(r.categories[0].name).toBe('书签栏')
    expect(r.categories[0].parentId).toBeUndefined()
    expect(r.cards).toHaveLength(2)
    // 同 category 下 order 0, 1
    expect(r.cards.map((c) => c.order)).toEqual([0, 1])
    // bookmarkId 必须回写
    expect(r.cards.map((c) => c.bookmarkId).sort()).toEqual(['b1', 'b2'])
    // 所有卡片归属同一 category
    expect(r.cards.every((c) => c.categoryId === r.categories[0].id)).toBe(true)
  })

  it('嵌套：parentId 维护正确（书签栏 → 工作 → 项目A）', async () => {
    setBookmarksTree([
      folder('bar', '书签栏', [
        bm('b1', 'Google', 'https://google.com/'),
        folder('work', '工作', [
          bm('b2', 'Jira', 'https://jira.com/'),
          folder('proj', '项目A', [bm('b3', 'Doc', 'https://doc.com/')]),
        ]),
      ]),
    ])
    const r = await importFromBrowserBookmarks()
    expect(r.categories.map((c) => c.name)).toEqual(['书签栏', '工作', '项目A'])

    const [bar, work, proj] = r.categories
    expect(bar.parentId).toBeUndefined()
    expect(work.parentId).toBe(bar.id)
    expect(proj.parentId).toBe(work.id)

    // 每张卡归到自己的"直接父文件夹"分类
    const byId = new Map(r.cards.map((c) => [c.bookmarkId, c]))
    expect(byId.get('b1')?.categoryId).toBe(bar.id)
    expect(byId.get('b2')?.categoryId).toBe(work.id)
    expect(byId.get('b3')?.categoryId).toBe(proj.id)
  })

  it('"只收直接子层书签"：祖父文件夹不应包含孙书签', async () => {
    setBookmarksTree([
      folder('a', 'A', [
        folder('b', 'B', [bm('x', 'X', 'https://x.com/')]),
      ]),
    ])
    const r = await importFromBrowserBookmarks()
    const catA = r.categories.find((c) => c.name === 'A')!
    const catB = r.categories.find((c) => c.name === 'B')!

    // x.com 属于 B（直接父），不该出现在 A
    expect(r.cards).toHaveLength(1)
    expect(r.cards[0].categoryId).toBe(catB.id)
    expect(r.cards[0].categoryId).not.toBe(catA.id)
  })

  it('order 全局单调递增（每个新 category 都拿下一个 order）', async () => {
    setBookmarksTree([
      folder('a', 'A', [bm('x', 'X', 'https://x.com/')]),
      folder('b', 'B', [bm('y', 'Y', 'https://y.com/')]),
      folder('c', 'C', [bm('z', 'Z', 'https://z.com/')]),
    ])
    const r = await importFromBrowserBookmarks()
    const orders = r.categories.map((c) => c.order)
    // 单调递增，无重复
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
    expect(new Set(orders).size).toBe(orders.length)
  })
})

// ─── 兜底数据修复 ────────────────────────────────────

describe('importFromBrowserBookmarks: 数据兜底', () => {
  it('文件夹无 title → "未命名"', async () => {
    setBookmarksTree([
      folder('f1', '', [bm('b1', 'X', 'https://x.com/')]),
    ])
    const r = await importFromBrowserBookmarks()
    expect(r.categories[0].name).toBe('未命名')
  })

  it('文件夹 title 含前后空白 → 自动 trim', async () => {
    setBookmarksTree([
      folder('f1', '  工作  ', [bm('b1', 'X', 'https://x.com/')]),
    ])
    const r = await importFromBrowserBookmarks()
    expect(r.categories[0].name).toBe('工作')
  })

  it('书签无 title → 用 url 兜底', async () => {
    setBookmarksTree([
      folder('f1', 'X', [bm('b1', '', 'https://no-title.com/')]),
    ])
    const r = await importFromBrowserBookmarks()
    expect(r.cards[0].title).toBe('https://no-title.com/')
  })

  it('生成的 category / card id 是 uuid（不会重复）', async () => {
    setBookmarksTree([
      folder('f1', 'X', [
        bm('b1', 'A', 'https://a.com/'),
        bm('b2', 'B', 'https://b.com/'),
      ]),
      folder('f2', 'Y', [bm('b3', 'C', 'https://c.com/')]),
    ])
    const r = await importFromBrowserBookmarks()
    const ids = [...r.categories.map((c) => c.id), ...r.cards.map((c) => c.id)]
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f-]{36}$/i) // uuid v4 形态
    }
  })

  it('createdAt / updatedAt 用同一个 batch 时间戳（便于排序稳定）', async () => {
    setBookmarksTree([
      folder('f1', 'X', [bm('b1', 'A', 'https://a.com/')]),
    ])
    const r = await importFromBrowserBookmarks()
    const ts = r.categories[0].createdAt
    expect(r.categories[0].updatedAt).toBe(ts)
    expect(r.cards[0].createdAt).toBe(ts)
    expect(r.cards[0].updatedAt).toBe(ts)
  })
})
