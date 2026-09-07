import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { localRepo, LocalRepository } from '../repositories/LocalRepository'
import { DEFAULT_SETTINGS, type BookmarkCard } from '../types/bookmark'
import {
  BOOKMARK_SYNC_STATE_KEY,
  getBookmarkSyncState,
  acknowledgeBookmarkSync,
} from './bookmarkSyncState'
import { LOCAL_CHANGE_KEY } from './storageLock'
import {
  bootstrapSync,
  commitReceivedBookmarks,
  getMeta,
  handleBookmarksRemoteChange,
  KEY_BM_MANIFEST,
  keyBmChunk,
  pushLocalBookmarks,
  pushSettings,
  readBookmarksRemote,
  setMeta,
  wipeRemote,
} from './SyncService'

const category = { id: 'c', name: 'C', order: 0, createdAt: 1, updatedAt: 1 }
const card = (id: string): BookmarkCard => ({
  id,
  categoryId: 'c',
  title: id,
  url: `https://example.com/${id}`,
  order: 0,
  createdAt: 1,
  updatedAt: 1,
})
const payload = (ids: string[]) => ({ categories: [category], cards: ids.map(card) })

beforeEach(async () => {
  await setMeta({ enabled: true })
})
afterEach(() => vi.restoreAllMocks())

async function seedSynced() {
  await localRepo.saveCategory(category)
  await localRepo.saveCard(card('original'))
  expect((await pushLocalBookmarks()).ok).toBe(true)
}
async function setRemote(ids: string[]) {
  const ts = Math.max(Date.now(), (await getMeta()).bookmarks.lastPushTs ?? 0) + 1000
  const data = payload(ids)
  const json = JSON.stringify(data)
  await chrome.storage.sync.set({
    [KEY_BM_MANIFEST]: {
      version: 1,
      ts,
      chunkCount: 1,
      totalBytes: new TextEncoder().encode(json).length,
    },
    [keyBmChunk(0)]: json,
  })
  return { ts, data }
}

it('书签、待同步版本与页面通知在同一次写入中提交', async () => {
  const set = vi.mocked(chrome.storage.local.set)
  set.mockClear()
  await localRepo.saveCard(card('new'))
  const writes = set.mock.calls.filter(([items]) => 'curio:cards' in items)
  expect(writes).toHaveLength(1)
  expect(writes[0][0]).toMatchObject({
    [BOOKMARK_SYNC_STATE_KEY]: { pending: true },
    [LOCAL_CHANGE_KEY]: { revision: expect.any(String) },
  })
})

it('关闭页面前未推送的删除，下次启动会续传而非恢复旧书签', async () => {
  await seedSynced()
  await localRepo.deleteCard('original')
  expect((await new LocalRepository().getSyncSnapshot()).state?.pending).toBe(true)
  const result = await bootstrapSync(DEFAULT_SETTINGS)
  expect(result.appliedBookmarks).toBeUndefined()
  expect(result.warnings).toEqual([])
  expect((await readBookmarksRemote())?.payload.cards).toEqual([])
  expect((await getBookmarkSyncState())?.pending).toBe(false)
})

it('启动遇到两端修改时保留双方数据，等待显式处理', async () => {
  await seedSynced()
  await localRepo.saveCard(card('local-change'))
  const remote = await setRemote(['remote-change'])
  const result = await bootstrapSync(DEFAULT_SETTINGS)
  expect(result.warnings?.join(' ')).toContain('本地有未同步')
  expect((await localRepo.getCards()).map((c) => c.id)).toContain('local-change')
  expect((await readBookmarksRemote())?.payload).toEqual(remote.data)
  expect((await getBookmarkSyncState())?.pending).toBe(true)
  await expect(commitReceivedBookmarks(remote.data, remote.ts)).rejects.toThrow('本地有未同步')
  expect((await getMeta()).bookmarks.lastPullTs).toBeUndefined()
})

it('选择从云端覆盖后才丢弃待同步版本，并在成功落盘后确认接收', async () => {
  await seedSynced()
  await localRepo.saveCard(card('local-change'))
  const remote = await setRemote(['remote-change'])
  expect(await commitReceivedBookmarks(remote.data, remote.ts, true)).toBe(true)
  expect((await localRepo.getCards()).map((c) => c.id)).toEqual(['remote-change'])
  expect((await getBookmarkSyncState())?.pending).toBe(false)
  expect((await getMeta()).bookmarks.lastPullTs).toBe(remote.ts)
})

it('读到远端或本地保存失败，都不能提前确认接收；失败后仍可重试', async () => {
  await seedSynced()
  const remote = await setRemote(['remote-change'])
  const manifest = (await readBookmarksRemote())!.manifest
  const received = await handleBookmarksRemoteChange(manifest)
  expect(received.ts).toBe(remote.ts)
  expect((await getMeta()).bookmarks.lastPullTs).toBeUndefined()
  vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('disk full'))
  await expect(commitReceivedBookmarks(received.payload!, received.ts!)).rejects.toThrow(
    'disk full',
  )
  expect((await getMeta()).bookmarks.lastPullTs).toBeUndefined()
  expect((await localRepo.getCards())[0].id).toBe('original')
  const retry = await handleBookmarksRemoteChange(manifest)
  expect(await commitReceivedBookmarks(retry.payload!, retry.ts!)).toBe(true)
  expect((await getMeta()).bookmarks.lastPullTs).toBe(remote.ts)
})

it('同步请求期间的新编辑不会被旧请求清掉待同步状态', async () => {
  await localRepo.saveCard(card('first'))
  const originalSet = chrome.storage.sync.set.bind(chrome.storage.sync)
  vi.mocked(chrome.storage.sync.set).mockImplementationOnce(async (items) => {
    await localRepo.saveCard(card('during-request'))
    return originalSet(items)
  })
  expect((await pushLocalBookmarks()).ok).toBe(true)
  expect((await getBookmarkSyncState())?.pending).toBe(true)
  expect((await readBookmarksRemote())?.payload.cards.map((c) => c.id)).toEqual(['first'])
  expect((await pushLocalBookmarks()).ok).toBe(true)
  expect((await readBookmarksRemote())?.payload.cards).toHaveLength(2)
  expect((await getBookmarkSyncState())?.pending).toBe(false)
})

it('本机推送触发的 storage 事件不会被误识别为远端版本', async () => {
  await localRepo.saveCard(card('mine'))
  const originalSet = chrome.storage.sync.set.bind(chrome.storage.sync)
  let echo: ReturnType<typeof handleBookmarksRemoteChange> | undefined
  vi.mocked(chrome.storage.sync.set).mockImplementationOnce(async (items) => {
    await originalSet(items)
    echo = handleBookmarksRemoteChange(items[KEY_BM_MANIFEST])
  })
  expect((await pushLocalBookmarks()).ok).toBe(true)
  expect(await echo).toEqual({})
})

it('旧版本确认不会清除后续编辑，修改偏好也不会覆盖待同步标记', async () => {
  await localRepo.saveCard(card('first'))
  const revision = (await getBookmarkSyncState())!.revision
  await localRepo.saveCard(card('second'))
  await localRepo.saveSettings(DEFAULT_SETTINGS)
  await acknowledgeBookmarkSync(revision)
  expect((await getBookmarkSyncState())?.pending).toBe(true)
})

it('用户选择推送本机时可修复损坏的远端分片', async () => {
  await localRepo.saveCard(card('local'))
  await chrome.storage.sync.set({ [KEY_BM_MANIFEST]: { ts: 5, chunkCount: 2 } })
  expect((await pushLocalBookmarks()).ok).toBe(false)
  expect((await pushLocalBookmarks({ force: true })).ok).toBe(true)
  expect((await readBookmarksRemote())?.payload.cards[0].id).toBe('local')
})

it.each(['bookmarks', 'settings'])(
  '清空云端与进行中的 %s 推送串行执行，不留下分片或回填数据',
  async (pipeline) => {
    await localRepo.saveCard(card('local'))
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const entered = new Promise<void>((resolve) => {
      started = resolve
    })
    const originalSet = chrome.storage.sync.set.bind(chrome.storage.sync)
    vi.mocked(chrome.storage.sync.set).mockImplementationOnce(async (items) => {
      started()
      await gate
      return originalSet(items)
    })
    const push = pipeline === 'bookmarks' ? pushLocalBookmarks() : pushSettings(DEFAULT_SETTINGS)
    await entered
    const wipe = wipeRemote()
    release()
    await Promise.all([push, wipe])
    expect(await chrome.storage.sync.get(null)).toEqual({})
    expect((await getMeta()).bookmarks.lastPushTs).toBeUndefined()
  },
)
