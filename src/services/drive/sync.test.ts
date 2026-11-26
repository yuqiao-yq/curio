import { beforeEach, expect, it, vi } from 'vitest'
import { localRepo } from '../../repositories/LocalRepository'
import {
  connectDrive,
  confirmDrive,
  disconnectDrive,
  getDriveState,
  pauseDrive,
  previewDrive,
  syncDrive,
} from './sync'
import { DATA_KEYS, DRIVE_AUTH_KEY, DRIVE_STATE_KEY, type DriveDocument } from './model'
import { fixture } from './testFixtures'
import { enableSync, getMeta, KEY_LOCAL_META } from '../SyncService'
import { saveBackup } from '../../repositories/BackupsDB'

const remote = vi.hoisted(() => ({
  docs: new Map<string, DriveDocument>(),
  uploads: [] as string[],
  sequence: 0,
  failAfterUpload: false,
  duringUpload: undefined as (() => Promise<void>) | undefined,
  readError: false,
  account: 'account-a',
}))
vi.mock('./auth', () => ({
  authorize: vi.fn(async (broker: string) => ({
    broker,
    account: remote.account,
    label: 'test@example.com',
    session: 'opaque-secret',
  })),
  brokerOrigin: (s: string) => s,
  getAuth: async () => (await chrome.storage.local.get('curio:drive:auth'))['curio:drive:auth'],
  forgetToken: vi.fn(),
}))
vi.mock('../../repositories/BackupsDB', () => ({ saveBackup: vi.fn(async () => {}) }))
vi.mock('./api', () => ({
  DriveAPI: class {
    async readLatest() {
      if (remote.readError) throw new Error('remote unreadable')
      const latest = new Map<string, DriveDocument>()
      for (const doc of remote.docs.values())
        if (!latest.has(doc.device) || latest.get(doc.device)!.sequence < doc.sequence)
          latest.set(doc.device, doc)
      return { documents: structuredClone([...latest.values()]), files: [] }
    }
    async generateId() {
      return `file-${++remote.sequence}`
    }
    async upload(id: string, doc: DriveDocument) {
      remote.uploads.push(id)
      remote.docs.set(id, structuredClone(doc))
      if (remote.duringUpload) {
        const action = remote.duringUpload
        remote.duringUpload = undefined
        await action()
      }
      if (remote.failAfterUpload) {
        remote.failAfterUpload = false
        throw new Error('lost response')
      }
    }
    async prune() {}
  },
}))
beforeEach(() => {
  remote.docs.clear()
  remote.uploads = []
  remote.sequence = 0
  remote.failAfterUpload = false
  remote.duringUpload = undefined
  remote.readError = false
  remote.account = 'account-a'
  vi.mocked(saveBackup).mockClear()
})
const connect = async () => {
  await connectDrive('https://auth.example.com')
  await confirmDrive(await previewDrive())
}
const snapshot = () => chrome.storage.local.get(null)
const restore = async (data: Record<string, unknown>) => {
  await chrome.storage.local.clear()
  await chrome.storage.local.set(data)
}

it('does not upload or overwrite before preview confirmation; stale previews cannot apply', async () => {
  await localRepo.bulkImport(fixture(), 'replace')
  await connectDrive('https://auth.example.com')
  const preview = await previewDrive()
  expect(remote.docs.size).toBe(0)
  expect((await localRepo.getCards()).length).toBe(3)
  await localRepo.deleteCard('a')
  await expect(confirmDrive(preview)).rejects.toThrow('本地数据已变化')
  expect(remote.docs.size).toBe(0)
  expect((await getDriveState())?.enabled).toBe(false)
})
it('merges two independently edited devices and keeps offline deletions after reconnect', async () => {
  await localRepo.bulkImport(fixture(), 'replace')
  await connect()
  let chromeDevice = await snapshot()
  await chrome.storage.local.clear()
  await connect()
  let firefoxDevice = await snapshot()
  await restore(chromeDevice)
  await localRepo.saveCard({ ...(await localRepo.getCards())[0], title: 'Chrome edit' })
  await localRepo.deleteCard('b')
  chromeDevice = await snapshot()
  await restore(firefoxDevice)
  await localRepo.saveCard({
    ...(await localRepo.getCards()).find((c) => c.id === 'c')!,
    description: 'Firefox edit',
  })
  await syncDrive()
  firefoxDevice = await snapshot()
  await restore(chromeDevice)
  await syncDrive()
  chromeDevice = await snapshot()
  expect((await localRepo.getCards()).map((c) => c.id)).toEqual(['a', 'c'])
  expect((await localRepo.getCards())[1].description).toBe('Firefox edit')
  await restore(firefoxDevice)
  await syncDrive()
  expect((await localRepo.getCards()).map((c) => c.id)).toEqual(['a', 'c'])
  expect((await localRepo.getCards())[0].title).toBe('Chrome edit')
  expect(saveBackup).toHaveBeenCalled()
  await restore(chromeDevice)
  await syncDrive()
  expect((await localRepo.getCards()).some((c) => c.id === 'b')).toBe(false)
})
it('retries uncertain uploads with the persisted file ID and keeps edits made during upload pending', async () => {
  await localRepo.bulkImport(fixture(), 'replace')
  await connect()
  await localRepo.deleteCard('b')
  remote.failAfterUpload = true
  await expect(syncDrive()).rejects.toThrow('lost response')
  const pending = (await getDriveState())!.upload!
  expect(pending).toBeDefined()
  remote.duringUpload = () =>
    localRepo.saveCard({ ...fixture().cards[0], title: 'edit while sending' })
  await syncDrive()
  expect(remote.uploads.filter((id) => id === pending.id)).toHaveLength(2)
  expect((await localRepo.getCards())[0].title).toBe('edit while sending')
  expect((await getDriveState())!.upload).toBeUndefined()
  expect((await getDriveState())!.dirty).toBe(false)
})
it('never applies a partial cloud read and retains local pending changes on network failure', async () => {
  await localRepo.bulkImport(fixture(), 'replace')
  await connect()
  await localRepo.deleteCard('b')
  const before = await localRepo.bulkExport()
  remote.readError = true
  await expect(syncDrive()).rejects.toThrow('remote unreadable')
  expect(await localRepo.getCards()).toEqual(before.cards)
  expect((await getDriveState())!.dirty).toBe(true)
  remote.readError = false
  await syncDrive()
  expect((await getDriveState())!.dirty).toBe(false)
})
it('pauses the browser provider, blocks simultaneous enablement, and preserves cloud/local data on disconnect', async () => {
  await chrome.storage.local.set({
    [KEY_LOCAL_META]: { enabled: true, settings: {}, bookmarks: {} },
  })
  await localRepo.bulkImport(fixture(), 'replace')
  await connect()
  expect((await getMeta()).enabled).toBe(false)
  const data = await localRepo.bulkExport()
  expect((await enableSync(data.settings!, data.categories, data.cards)).ok).toBe(false)
  const uploaded = remote.docs.size
  await pauseDrive()
  await localRepo.deleteCard('a')
  await syncDrive()
  expect(remote.docs.size).toBe(uploaded)
  await disconnectDrive()
  expect((await chrome.storage.local.get(DRIVE_AUTH_KEY))[DRIVE_AUTH_KEY]).toBeUndefined()
  expect((await chrome.storage.local.get(DATA_KEYS.cards))[DATA_KEYS.cards]).toHaveLength(2)
  expect(remote.docs.size).toBe(uploaded)
})
it('switching accounts requires a new preview and never sends the previous pending upload', async () => {
  await localRepo.bulkImport(fixture(), 'replace')
  await connect()
  await localRepo.deleteCard('a')
  remote.failAfterUpload = true
  await expect(syncDrive()).rejects.toThrow()
  const previous = (await getDriveState())!
  remote.account = 'another-account'
  await connectDrive('https://auth.example.com')
  const next = (await chrome.storage.local.get(DRIVE_STATE_KEY))[DRIVE_STATE_KEY]
  expect(next.account).toBe('another-account')
  expect(next.device).not.toBe(previous.device)
  expect(next.upload).toBeUndefined()
  expect(next.enabled).toBe(false)
  const before = remote.uploads.length
  await syncDrive()
  expect(remote.uploads.length).toBe(before)
})
it('retains new changes made during a successful upload for the next synchronization', async () => {
  await localRepo.bulkImport(fixture(), 'replace')
  await connect()
  await localRepo.deleteCard('b')
  remote.duringUpload = () =>
    localRepo.saveCard({ ...fixture().cards[0], title: 'new edit during upload' })
  await syncDrive()
  expect((await getDriveState())!.dirty).toBe(true)
  expect((await localRepo.getCards())[0].title).toBe('new edit during upload')
  await syncDrive()
  expect((await getDriveState())!.dirty).toBe(false)
})
it('an oversized snapshot can recover after removing the large image; it does not poison pending retries', async () => {
  await localRepo.bulkImport(fixture(), 'replace')
  await connect()
  await localRepo.saveCard({ ...fixture().cards[0], thumbnail: 'x'.repeat(4 * 1024 * 1024) })
  await expect(syncDrive()).rejects.toThrow('4 MiB')
  expect((await getDriveState())!.upload).toBeUndefined()
  expect((await getDriveState())!.dirty).toBe(true)
  await localRepo.saveCard({ ...fixture().cards[0], title: 'smaller' })
  await syncDrive()
  expect((await getDriveState())!.dirty).toBe(false)
})
