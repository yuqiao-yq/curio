import { beforeEach, describe, expect, it, vi } from 'vitest'
import { retrieveContext, buildRagSystemPrompt } from './retriever'
import { DEFAULT_AI_SETTINGS } from '../types'
import { searchByEmbedding } from './embedder'
import { getPageContentsMap } from '../../repositories/PageContentsDB'
import type { BookmarkCard } from '../../types/bookmark'

vi.mock('./embedder', () => ({ searchByEmbedding: vi.fn() }))
vi.mock('../../repositories/PageContentsDB', () => ({ getPageContentsMap: vi.fn() }))

const card: BookmarkCard = {
  id: 'a',
  categoryId: 'c',
  title: '系统设计',
  url: 'https://example.com',
  createdAt: 1,
  updatedAt: 1,
  order: 0,
}
const page = {
  bookmarkId: 'a',
  url: card.url,
  title: card.title,
  content: '无关的开头。'.repeat(600) + '\n事务隔离避免并发写入覆盖。',
  contentHash: 'x',
  status: 'ok' as const,
  fetchedAt: 1,
}
beforeEach(() => {
  vi.mocked(searchByEmbedding).mockResolvedValue([])
  vi.mocked(getPageContentsMap).mockImplementation(async (ids) =>
    ids.includes('a') ? new Map([['a', page]]) : new Map(),
  )
})

describe('混合检索与正文授权', () => {
  it('能召回文章后半段的关键词并返回对应片段', async () => {
    const docs = await retrieveContext({
      query: '事务隔离',
      cards: [card],
      settings: {
        ...DEFAULT_AI_SETTINGS,
        privacy: { ...DEFAULT_AI_SETTINGS.privacy, sendPageContent: true },
      },
    })
    expect(docs).toHaveLength(1)
    expect(docs[0].excerptStart).toBeGreaterThan(1500)
    expect(docs[0].excerpt).toContain('事务隔离')
    expect(buildRagSystemPrompt(docs)).toContain('事务隔离')
  })
  it('没有正文授权时，只通过标题召回，不读取或发送正文', async () => {
    const docs = await retrieveContext({
      query: '系统设计',
      cards: [card],
      settings: DEFAULT_AI_SETTINGS,
    })
    expect(docs).toHaveLength(1)
    expect(docs[0].excerpt).toBeUndefined()
    expect(getPageContentsMap).toHaveBeenLastCalledWith([])
    expect(buildRagSystemPrompt(docs)).not.toContain('事务隔离')
  })
  it('向量服务失败时仍能通过关键词召回', async () => {
    vi.mocked(searchByEmbedding).mockRejectedValue(new Error('offline'))
    const docs = await retrieveContext({
      query: '系统设计',
      cards: [card],
      settings: DEFAULT_AI_SETTINGS,
    })
    expect(docs[0].card.id).toBe('a')
  })
})
