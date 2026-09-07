import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ export: vi.fn(), push: vi.fn() }))
vi.mock('../../repositories', () => ({ getRepository: () => ({ bulkExport: mocks.export }) }))
vi.mock('../../services/SyncService', () => ({
  pushLocalBookmarks: mocks.push,
  pushSettings: vi.fn(),
}))
vi.mock('.', () => ({
  useBookmarkStore: { getState: () => ({ settings: { browserSyncAuto: false } }) },
}))

import { cancelPendingSyncPush, scheduleBookmarksSyncPush } from './scheduler'

beforeEach(() => {
  vi.useFakeTimers()
  mocks.export.mockReset().mockResolvedValue({ categories: [], cards: [] })
  mocks.push.mockReset().mockResolvedValue({ ok: true })
})
afterEach(() => {
  cancelPendingSyncPush()
  vi.useRealTimers()
})

it('暂时失败后按 5、10、20 秒重试，最多重试三次', async () => {
  mocks.push.mockResolvedValue({ ok: false, error: 'network error' })
  scheduleBookmarksSyncPush()
  await vi.advanceTimersByTimeAsync(1500)
  expect(mocks.push).toHaveBeenCalledTimes(1)
  for (const [delay, calls] of [
    [5000, 2],
    [10000, 3],
    [20000, 4],
  ]) {
    await vi.advanceTimersByTimeAsync(delay)
    expect(mocks.push).toHaveBeenCalledTimes(calls)
  }
  await vi.advanceTimersByTimeAsync(60000)
  expect(mocks.push).toHaveBeenCalledTimes(4)
})

it('容量超限不自动重试', async () => {
  mocks.push.mockResolvedValue({ ok: false, quotaHint: true })
  scheduleBookmarksSyncPush()
  await vi.advanceTimersByTimeAsync(60000)
  expect(mocks.push).toHaveBeenCalledTimes(1)
})

it('取消同步后，进行中的失败请求不会重新排队', async () => {
  let complete!: (value: { ok: false; error: string }) => void
  mocks.push.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  scheduleBookmarksSyncPush()
  await vi.advanceTimersByTimeAsync(1500)
  cancelPendingSyncPush()
  complete({ ok: false, error: 'network error' })
  await vi.advanceTimersByTimeAsync(60000)
  expect(mocks.push).toHaveBeenCalledTimes(1)
})

it('检测到两端冲突时保留待同步状态，不自动反复推送', async () => {
  mocks.push.mockResolvedValue({ ok: false, conflict: true })
  scheduleBookmarksSyncPush()
  await vi.advanceTimersByTimeAsync(60000)
  expect(mocks.push).toHaveBeenCalledTimes(1)
})
