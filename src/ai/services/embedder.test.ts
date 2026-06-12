/**
 * embedder 测试
 *
 * 重点覆盖：
 *  - cosineSimilarity：纯数学函数，最稳的回归靶
 *  - contentHashOf：增量识别的基石；返回稳定 + 对内容敏感
 *  - buildContent：embedding 输入文本构造（关键路径，影响召回质量）
 *  - findSimilarCards：§7.4 相关阅读，端到端走一次（含 fake-indexeddb）
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildContent,
  contentHashOf,
  cosineSimilarity,
  findSimilarCards,
} from './embedder'
import {
  embeddingsDB,
  putEmbeddings,
  type EmbeddingRow,
} from '../../repositories/EmbeddingsDB'
import type { BookmarkCard } from '../../types/bookmark'

// ─── helpers ──────────────────────────────────────────

function mkCard(over: Partial<BookmarkCard> = {}): BookmarkCard {
  return {
    id: 'c1',
    categoryId: 'cat1',
    title: 'Example',
    url: 'https://example.com/',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function mkRow(id: string, vec: number[], over: Partial<EmbeddingRow> = {}): EmbeddingRow {
  return {
    bookmarkId: id,
    vector: new Float32Array(vec),
    model: 'text-embedding-3-small',
    contentHash: 'h',
    createdAt: 1,
    ...over,
  }
}

afterEach(async () => {
  // fake-indexeddb 在每个 test 间不会自动清，需要手动清表
  await embeddingsDB.embeddings.clear()
})

// ─── cosineSimilarity ─────────────────────────────────

describe('cosineSimilarity', () => {
  it('相同方向向量返回 1', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 6)
    expect(cosineSimilarity([2, 4, 6], [1, 2, 3])).toBeCloseTo(1, 6)
  })

  it('正交向量返回 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0)
  })

  it('反向向量返回 -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6)
  })

  it('零向量返回 0（避免 NaN）', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0)
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0)
  })

  it('空向量返回 0', () => {
    expect(cosineSimilarity([], [])).toBe(0)
    expect(cosineSimilarity([], [1])).toBe(0)
  })

  it('Float32Array 和 number[] 可混用', () => {
    const a = new Float32Array([1, 2, 3])
    const b = [1, 2, 3]
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5)
  })

  it('长度不一致时按较短长度算（防御式）', () => {
    // [1,0,0,0] 与 [1,0] 都只比前 2 维 → 1
    expect(cosineSimilarity([1, 0, 0, 0], [1, 0])).toBeCloseTo(1, 6)
  })
})

// ─── contentHashOf ────────────────────────────────────

describe('contentHashOf', () => {
  it('同样输入输出稳定（决定增量识别正确性）', () => {
    expect(contentHashOf('hello world')).toBe(contentHashOf('hello world'))
  })

  it('不同输入产生不同 hash', () => {
    expect(contentHashOf('a')).not.toBe(contentHashOf('b'))
    expect(contentHashOf('hello')).not.toBe(contentHashOf('hello!'))
  })

  it('空串返回稳定值', () => {
    const a = contentHashOf('')
    expect(typeof a).toBe('string')
    expect(a.length).toBeGreaterThan(0)
  })

  it('返回 36 进制字符串（无负号 / 短）', () => {
    const h = contentHashOf('something with various 字符 ☆')
    expect(h).toMatch(/^[0-9a-z]+$/)
    expect(h.length).toBeLessThanOrEqual(8)
  })
})

// ─── buildContent ─────────────────────────────────────

describe('buildContent', () => {
  it('包含 title 和 domain', () => {
    const c = mkCard({ title: 'React Docs', url: 'https://react.dev/learn' })
    const s = buildContent(c)
    expect(s).toContain('React Docs')
    expect(s).toContain('react.dev')
  })

  it('去掉 www. 前缀（保证 domain 信号稳定）', () => {
    const c = mkCard({ url: 'https://www.medium.com/article' })
    expect(buildContent(c)).toContain('medium.com')
    expect(buildContent(c)).not.toContain('www.medium')
  })

  it('附加 tags 和 description', () => {
    const c = mkCard({ tags: ['前端', '文档'], description: '官方学习路径' })
    const s = buildContent(c)
    expect(s).toContain('前端')
    expect(s).toContain('文档')
    expect(s).toContain('官方学习路径')
  })

  it('无标题时用占位符（避免空字符串污染向量）', () => {
    const c = mkCard({ title: '' })
    expect(buildContent(c)).toContain('(无标题)')
  })

  it('非法 URL 静默降级为空 domain，不抛错', () => {
    const c = mkCard({ url: 'not-a-url' })
    expect(() => buildContent(c)).not.toThrow()
    expect(buildContent(c)).toContain('Example')
  })

  it('无正文时截断到 300 字符（成本控制）', () => {
    const c = mkCard({ title: 'X'.repeat(500) })
    expect(buildContent(c).length).toBeLessThanOrEqual(300)
  })

  it('有正文时整体 ≤ 4000 字符', () => {
    const body = 'Y'.repeat(10_000)
    const c = mkCard()
    const s = buildContent(c, body)
    expect(s.length).toBeLessThanOrEqual(4000)
    // 头部元数据应该被保留
    expect(s).toContain('Example')
  })

  it('正文与头部用 \\n\\n 分隔（让 embedding 学到两层）', () => {
    const c = mkCard()
    const s = buildContent(c, 'body content here')
    expect(s).toContain('\n\nbody content here')
  })
})

// ─── findSimilarCards (§7.4) ──────────────────────────

describe('findSimilarCards', () => {
  it('目标卡未生成 embedding 时返回 no-self-embedding', async () => {
    const cards = [mkCard({ id: 'c1' }), mkCard({ id: 'c2' })]
    const r = await findSimilarCards('c1', cards)
    expect(r.hits).toEqual([])
    expect(r.reason).toBe('no-self-embedding')
  })

  it('没有候选超过阈值时返回 no-candidates', async () => {
    await putEmbeddings([
      mkRow('c1', [1, 0, 0]),
      mkRow('c2', [0, 1, 0]), // 与 c1 cosine=0，远低于 0.4
    ])
    const cards = [mkCard({ id: 'c1' }), mkCard({ id: 'c2' })]
    const r = await findSimilarCards('c1', cards)
    expect(r.hits).toEqual([])
    expect(r.reason).toBe('no-candidates')
  })

  it('按相似度倒序返回 top K，且不含自身', async () => {
    await putEmbeddings([
      mkRow('c1', [1, 0, 0]),
      mkRow('c2', [0.9, 0.1, 0]), // 高相似
      mkRow('c3', [0.95, 0.05, 0]), // 更高相似
      mkRow('c4', [0.5, 0.5, 0]), // 中等相似
    ])
    const cards = ['c1', 'c2', 'c3', 'c4'].map((id) => mkCard({ id }))
    const r = await findSimilarCards('c1', cards, { topK: 2 })

    expect(r.reason).toBeUndefined()
    expect(r.hits).toHaveLength(2)
    expect(r.hits[0].card.id).toBe('c3') // 最相似
    expect(r.hits[1].card.id).toBe('c2')
    // 不能含自身
    expect(r.hits.find((h) => h.card.id === 'c1')).toBeUndefined()
    // score 单调递减
    expect(r.hits[0].score).toBeGreaterThanOrEqual(r.hits[1].score)
  })

  it('过滤掉 cards 中已删除的孤立 embedding', async () => {
    await putEmbeddings([
      mkRow('c1', [1, 0, 0]),
      mkRow('orphan', [1, 0, 0]), // 与 c1 完全相同，但 cards 中不存在
    ])
    const cards = [mkCard({ id: 'c1' })]
    const r = await findSimilarCards('c1', cards)
    // 只剩自己，找不到候选
    expect(r.reason).toBe('no-candidates')
    expect(r.hits).toEqual([])
  })

  it('minScore 自定义生效', async () => {
    await putEmbeddings([
      mkRow('c1', [1, 0]),
      mkRow('c2', [0.7, 0.7]), // cosine ≈ 0.707
    ])
    const cards = [mkCard({ id: 'c1' }), mkCard({ id: 'c2' })]

    // 阈值 0.8 → 滤掉
    const r1 = await findSimilarCards('c1', cards, { minScore: 0.8 })
    expect(r1.hits).toHaveLength(0)
    expect(r1.reason).toBe('no-candidates')

    // 阈值 0.5 → 保留
    const r2 = await findSimilarCards('c1', cards, { minScore: 0.5 })
    expect(r2.hits).toHaveLength(1)
    expect(r2.hits[0].card.id).toBe('c2')
  })
})
