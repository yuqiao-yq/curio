/**
 * quality.ts (§6.4 整理质检) 测试
 *
 * 覆盖：
 *  - URL 完全重复检测：分组、稳定排序、空 URL 跳过、大小写归一
 *  - 长期未访问：6 个月 cutoff 边界
 *  - 失效检测：HEAD 4xx → dead；HEAD 405 → GET 兜底；非 http(s) 跳过
 *  - 内容相似度（embedding 簇）：>= 阈值合并；与 exact_url 不重复
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scanQuality } from './quality'
import {
  embeddingsDB,
  putEmbeddings,
  type EmbeddingRow,
} from '../../repositories/EmbeddingsDB'
import type { BookmarkCard } from '../../types/bookmark'

const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000

function mkCard(over: Partial<BookmarkCard> = {}): BookmarkCard {
  return {
    id: 'c1',
    categoryId: 'cat1',
    title: 'Example',
    url: 'https://example.com/',
    order: 0,
    createdAt: 1,
    updatedAt: Date.now(),
    ...over,
  }
}

function mkRow(id: string, vec: number[]): EmbeddingRow {
  return {
    bookmarkId: id,
    vector: new Float32Array(vec),
    model: 'm',
    contentHash: 'h',
    createdAt: 1,
  }
}

afterEach(async () => {
  await embeddingsDB.embeddings.clear()
  vi.restoreAllMocks()
})

// ─── URL 完全重复 ────────────────────────────────────

describe('scanQuality: URL 完全重复', () => {
  beforeEach(() => {
    // 默认所有 fetch 都返回 200，避免被失效检测污染
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 200 }))),
    )
  })

  it('完全相同 URL 的卡聚成一组', async () => {
    const cards = [
      mkCard({ id: 'a', url: 'https://x.com/' }),
      mkCard({ id: 'b', url: 'https://x.com/' }),
      mkCard({ id: 'c', url: 'https://y.com/' }),
    ]
    const r = await scanQuality({ cards, enableContentSimilarity: false })
    expect(r.duplicateGroups).toHaveLength(1)
    expect(r.duplicateGroups[0].kind).toBe('exact_url')
    expect(r.duplicateGroups[0].cards.map((c) => c.id).sort()).toEqual(['a', 'b'])
  })

  it('URL 大小写 + 空白归一', async () => {
    const cards = [
      mkCard({ id: 'a', url: 'https://X.com/' }),
      mkCard({ id: 'b', url: '  https://x.com/  ' }),
    ]
    const r = await scanQuality({ cards, enableContentSimilarity: false })
    expect(r.duplicateGroups).toHaveLength(1)
    expect(r.duplicateGroups[0].cards.map((c) => c.id).sort()).toEqual(['a', 'b'])
  })

  it('空 URL 不参与重复检测', async () => {
    const cards = [
      mkCard({ id: 'a', url: '' }),
      mkCard({ id: 'b', url: '' }),
    ]
    const r = await scanQuality({ cards, enableContentSimilarity: false })
    expect(r.duplicateGroups).toHaveLength(0)
  })

  it('单一卡片不形成组', async () => {
    const cards = [mkCard({ id: 'a' })]
    const r = await scanQuality({ cards, enableContentSimilarity: false })
    expect(r.duplicateGroups).toHaveLength(0)
  })

  it('groupId 按 cardId 最小者确定（稳定）', async () => {
    const cards = [
      mkCard({ id: 'z' }),
      mkCard({ id: 'a' }),
      mkCard({ id: 'm' }),
    ]
    const r = await scanQuality({ cards, enableContentSimilarity: false })
    expect(r.duplicateGroups[0].groupId).toBe('exact:a')
  })
})

// ─── 长期未访问 ──────────────────────────────────────

describe('scanQuality: 长期未访问', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 200 }))),
    )
  })

  it('updatedAt 早于 6 个月前 → stale', async () => {
    const now = Date.now()
    const cards = [
      mkCard({ id: 'fresh', updatedAt: now - 1000 }),
      mkCard({ id: 'old', updatedAt: now - SIX_MONTHS_MS - 1000 }),
    ]
    const r = await scanQuality({ cards, enableContentSimilarity: false })
    expect(r.staleCards.map((c) => c.id)).toEqual(['old'])
  })

  it('正好 6 个月边界以内不算 stale', async () => {
    const now = Date.now()
    const cards = [
      // 给 1s buffer 防止测试运行期间 Date.now() 推移触发误判
      mkCard({ id: 'edge', updatedAt: now - SIX_MONTHS_MS + 10_000 }),
    ]
    const r = await scanQuality({ cards, enableContentSimilarity: false })
    expect(r.staleCards).toHaveLength(0)
  })
})

// ─── 失效检测 ────────────────────────────────────────

describe('scanQuality: 失效检测', () => {
  it('HEAD 404 → dead', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 404, statusText: 'Not Found' }))),
    )
    const cards = [mkCard({ id: 'a', url: 'https://dead.example.com/' })]
    const r = await scanQuality({ cards, enableContentSimilarity: false })
    expect(r.deadCards).toHaveLength(1)
    expect(r.deadCards[0].card.id).toBe('a')
    expect(r.deadCards[0].httpStatus).toBe(404)
  })

  it('HEAD 405 → 自动用 GET 兜底', async () => {
    let firstCall = true
    vi.stubGlobal(
      'fetch',
      vi.fn((_: string, init?: RequestInit) => {
        if (firstCall) {
          firstCall = false
          expect(init?.method).toBe('HEAD')
          return Promise.resolve(new Response('', { status: 405 }))
        }
        // GET 兜底成功
        expect(init?.method).toBe('GET')
        return Promise.resolve(new Response('ok', { status: 200 }))
      }),
    )
    const cards = [mkCard({ id: 'a', url: 'https://picky.example.com/' })]
    const r = await scanQuality({ cards, enableContentSimilarity: false })
    expect(r.deadCards).toHaveLength(0)
  })

  it('HEAD 网络错误 → 也尝试 GET 兜底', async () => {
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        n++
        if (n === 1) return Promise.reject(new TypeError('Failed to fetch'))
        return Promise.resolve(new Response('', { status: 200 }))
      }),
    )
    const cards = [mkCard({ id: 'a', url: 'https://flaky.example.com/' })]
    const r = await scanQuality({ cards, enableContentSimilarity: false })
    expect(r.deadCards).toHaveLength(0)
    expect(n).toBe(2)
  })

  it('GET 也失败 → dead，错误信息可读', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    )
    const cards = [mkCard({ id: 'a', url: 'https://offline.example.com/' })]
    const r = await scanQuality({ cards, enableContentSimilarity: false })
    expect(r.deadCards).toHaveLength(1)
    expect(r.deadCards[0].error).toBeTruthy()
  })

  it('非 http(s) URL 不做 HEAD，计入 skippedNonHttp', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response('', { status: 200 })),
    )
    vi.stubGlobal('fetch', fetchSpy)
    const cards = [
      mkCard({ id: 'a', url: 'chrome://settings' }),
      mkCard({ id: 'b', url: 'file:///tmp/x' }),
    ]
    const r = await scanQuality({ cards, enableContentSimilarity: false })
    expect(r.deadCards).toHaveLength(0)
    expect(r.meta.skippedNonHttp).toBe(2)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('同 URL 多卡 → 只发一次 HEAD，但失败时所有相同 URL 卡都标失效', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response('', { status: 404, statusText: 'NF' })),
    )
    vi.stubGlobal('fetch', fetchSpy)
    const cards = [
      mkCard({ id: 'a', url: 'https://dead.example.com/' }),
      mkCard({ id: 'b', url: 'https://dead.example.com/' }),
    ]
    const r = await scanQuality({ cards, enableContentSimilarity: false })
    // 仅 1 次 fetch（HEAD 兜底逻辑：404 不会触发 GET 兜底）
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    // 但两个卡都被标为 dead
    expect(r.deadCards.map((d) => d.card.id).sort()).toEqual(['a', 'b'])
  })
})

// ─── 内容相似度（embedding） ──────────────────────────

describe('scanQuality: 内容相似度', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 200 }))),
    )
  })

  it('cosine ≥ 阈值 → 合并为 similar_content 组', async () => {
    await putEmbeddings([
      mkRow('a', [1, 0, 0]),
      mkRow('b', [0.99, 0.1, 0]), // 与 a 极相似
      mkRow('c', [0, 1, 0]), // 不相似
    ])
    const cards = [
      mkCard({ id: 'a', url: 'https://a.com/' }),
      mkCard({ id: 'b', url: 'https://b.com/' }),
      mkCard({ id: 'c', url: 'https://c.com/' }),
    ]
    const r = await scanQuality({ cards, similarityThreshold: 0.9 })
    const sim = r.duplicateGroups.filter((g) => g.kind === 'similar_content')
    expect(sim).toHaveLength(1)
    expect(sim[0].cards.map((c) => c.id).sort()).toEqual(['a', 'b'])
    expect(sim[0].minScore).toBeGreaterThan(0.9)
  })

  it('三个相似项被 union-find 合并到同一簇', async () => {
    await putEmbeddings([
      mkRow('a', [1, 0]),
      mkRow('b', [0.98, 0.02]),
      mkRow('c', [0.97, 0.03]),
    ])
    const cards = ['a', 'b', 'c'].map((id) =>
      mkCard({ id, url: `https://${id}.com/` }),
    )
    const r = await scanQuality({ cards, similarityThreshold: 0.9 })
    const sim = r.duplicateGroups.filter((g) => g.kind === 'similar_content')
    expect(sim).toHaveLength(1)
    expect(sim[0].cards).toHaveLength(3)
  })

  it('已被 exact_url 覆盖的卡不再出现在 similar_content', async () => {
    await putEmbeddings([
      mkRow('a', [1, 0]),
      mkRow('b', [1, 0]), // URL 也相同
      mkRow('c', [0.99, 0.01]), // 内容相似但 URL 不同
    ])
    const cards = [
      mkCard({ id: 'a', url: 'https://same.com/' }),
      mkCard({ id: 'b', url: 'https://same.com/' }),
      mkCard({ id: 'c', url: 'https://other.com/' }),
    ]
    const r = await scanQuality({ cards, similarityThreshold: 0.9 })
    const exact = r.duplicateGroups.filter((g) => g.kind === 'exact_url')
    const sim = r.duplicateGroups.filter((g) => g.kind === 'similar_content')
    expect(exact).toHaveLength(1)
    expect(exact[0].cards.map((c) => c.id).sort()).toEqual(['a', 'b'])
    // c 单独，没法形成组
    expect(sim).toHaveLength(0)
  })

  it('enableContentSimilarity=false 时跳过比对（embeddingPairs=0）', async () => {
    await putEmbeddings([mkRow('a', [1, 0]), mkRow('b', [1, 0])])
    const cards = [
      mkCard({ id: 'a', url: 'https://a.com/' }),
      mkCard({ id: 'b', url: 'https://b.com/' }),
    ]
    const r = await scanQuality({ cards, enableContentSimilarity: false })
    expect(r.meta.embeddingPairs).toBe(0)
    expect(r.duplicateGroups.filter((g) => g.kind === 'similar_content')).toHaveLength(0)
  })

  it('低于阈值不合并', async () => {
    await putEmbeddings([mkRow('a', [1, 0]), mkRow('b', [0.5, 0.866])])
    const cards = [
      mkCard({ id: 'a', url: 'https://a.com/' }),
      mkCard({ id: 'b', url: 'https://b.com/' }),
    ]
    const r = await scanQuality({ cards, similarityThreshold: 0.9 })
    expect(r.duplicateGroups.filter((g) => g.kind === 'similar_content')).toHaveLength(0)
  })
})

// ─── meta / 中止 ─────────────────────────────────────

describe('scanQuality: meta + abort', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 200 }))),
    )
  })

  it('meta 包含 totalCards / durationMs', async () => {
    const cards = [mkCard({ id: 'a' })]
    const r = await scanQuality({ cards, enableContentSimilarity: false })
    expect(r.meta.totalCards).toBe(1)
    expect(r.meta.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('abort 后内容相似度循环及时退出', async () => {
    await putEmbeddings(
      Array.from({ length: 20 }, (_, i) => mkRow(`c${i}`, [Math.random(), Math.random()])),
    )
    const cards = Array.from({ length: 20 }, (_, i) =>
      mkCard({ id: `c${i}`, url: `https://x${i}.com/` }),
    )
    const ac = new AbortController()
    ac.abort()
    const r = await scanQuality({
      cards,
      signal: ac.signal,
      similarityThreshold: 0.9,
    })
    // 已经 abort，pairs 应该是 0（外层 for 第一次就 break）
    expect(r.meta.embeddingPairs).toBe(0)
  })
})
