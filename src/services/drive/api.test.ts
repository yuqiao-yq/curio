import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DriveAPI } from './api'
import { seedState, type DriveDocument } from './model'
import { fixture } from './testFixtures'
import { accessToken } from './auth'

vi.mock('./auth', () => ({ accessToken: vi.fn(async () => 'access-token') }))
const api = () =>
  new DriveAPI({
    broker: 'https://auth.example.com',
    account: 'a',
    session: 'opaque-session',
    label: 'me',
  })
const document = (device = 'a', sequence = 1): DriveDocument => ({
  app: 'curio',
  version: 1,
  device,
  sequence,
  records: seedState('account', fixture()).records,
})
const file = (id: string, device: string, sequence: number) => ({
  id,
  appProperties: { app: 'curio', version: '1', device, sequence: String(sequence) },
})
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
beforeEach(() => vi.mocked(accessToken).mockClear())
afterEach(() => vi.unstubAllGlobals())
it('reads all pages, only the newest version of each device, and fails on any incomplete read', async () => {
  const fetched: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(url)
      if (url.includes('/files?')) {
        expect(url).toContain('spaces=appDataFolder')
        return url.includes('pageToken=next')
          ? json({ files: [file('a2', 'a', 2)] })
          : json({ files: [file('a1', 'a', 1), file('b1', 'b', 1)], nextPageToken: 'next' })
      }
      return url.includes('/a2?') ? json(document('a', 2)) : json(document('b', 1))
    }),
  )
  expect((await api().readLatest()).documents).toHaveLength(2)
  expect(fetched.some((u) => u.includes('/a1?'))).toBe(false)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url.includes('/files?') ? json({ files: [file('broken', 'a', 1)] }) : json({}, 404),
    ),
  )
  await expect(api().readLatest()).rejects.toThrow('404')
})
it('retries a 401 once using refreshed auth and reports remaining errors', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({}, 401))
    .mockResolvedValueOnce(json({ ids: ['new-id'] }))
  vi.stubGlobal('fetch', fetcher)
  expect(await api().generateId()).toBe('new-id')
  expect(vi.mocked(accessToken).mock.calls[1][1]).toBe(true)
  expect(fetcher.mock.calls[0][0]).toContain('space=appDataFolder')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({}, 403)),
  )
  await expect(api().list()).rejects.toThrow('403')
})
it('creates immutable appdata files and validates an uncertain upload before acknowledging 409', async () => {
  const doc = document()
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-token')
    if (url.includes('/upload/')) {
      expect(init?.method).toBe('POST')
      expect(init?.body).toContain('"parents":["appDataFolder"]')
      expect(init?.body).not.toContain('opaque-session')
      expect(init?.body).not.toContain('native-a')
      return json({}, 409)
    }
    return json(doc)
  })
  vi.stubGlobal('fetch', fetcher)
  await expect(api().upload('fixed-id', doc)).resolves.toBeUndefined()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (url.includes('/upload/') ? json({}, 409) : json(document('b')))),
  )
  await expect(api().upload('fixed-id', doc)).rejects.toThrow('版本冲突')
})
it('does not silently skip unknown schema files and never deletes other devices', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      json({
        files: [
          {
            ...file('future', 'a', 1),
            appProperties: { app: 'curio', version: '2', device: 'a', sequence: '1' },
          },
        ],
      }),
    ),
  )
  await expect(api().readLatest()).rejects.toThrow('不兼容')
  const fetcher = vi.fn(async (_url: string) => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetcher)
  await api().prune(
    [...Array.from({ length: 5 }, (_, i) => file(`a${i + 1}`, 'a', i + 1)), file('b1', 'b', 1)],
    'a',
  )
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(fetcher.mock.calls.map((c) => String(c[0]))).toEqual(
    expect.arrayContaining([
      'https://www.googleapis.com/drive/v3/files/a1',
      'https://www.googleapis.com/drive/v3/files/a2',
    ]),
  )
})
it('rejects incomplete Drive searches instead of treating missing files as deleted', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ files: [], incompleteSearch: true })),
  )
  await expect(api().readLatest()).rejects.toThrow('无法完整读取')
})
