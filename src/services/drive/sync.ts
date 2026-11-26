import { browser } from 'wxt/browser'
import { readLocalDataUnlocked } from '../../repositories/LocalRepository'
import { saveBackup } from '../../repositories/BackupsDB'
import { disableSync } from '../SyncService'
import { BOOKMARK_SYNC_STATE_KEY } from '../bookmarkSyncState'
import { LOCAL_CHANGE_KEY, withStorageLock } from '../storageLock'
import { authorize, brokerOrigin, forgetToken, getAuth } from './auth'
import { DriveAPI } from './api'
import {
  DATA_KEYS,
  DRIVE_AUTH_KEY,
  DRIVE_STATE_KEY,
  DRIVE_STATUS_KEY,
  equal,
  materialize,
  mergeRecords,
  seedState,
  serializeDocument,
  type DriveState,
  type DriveDocument,
} from './model'
import type { ExportData } from '../../types/bookmark'

export interface DriveStatus {
  phase: 'idle' | 'syncing' | 'error'
  lastSync?: number
  error?: string
}
export interface DrivePreview {
  account: string
  local: { cards: number; categories: number }
  cloud: { cards: number; categories: number }
  result: { cards: number; categories: number }
  changed: number
  localFingerprint: string
  remoteFingerprint: string
}
export async function getDriveState(): Promise<DriveState | undefined> {
  return (await browser.storage.local.get(DRIVE_STATE_KEY))[DRIVE_STATE_KEY] as
    | DriveState
    | undefined
}
const fingerprint = (documents: DriveDocument[]) =>
  JSON.stringify(documents.map((d) => `${d.device}:${d.sequence}`).sort())
const counts = (data: ExportData) => ({
  cards: data.cards.length,
  categories: data.categories.length,
})
const dataEqual = (a: ExportData, b: ExportData) =>
  equal(a.cards, b.cards) && equal(a.categories, b.categories) && equal(a.settings, b.settings)
async function status(patch: DriveStatus) {
  const previous = (await browser.storage.local.get(DRIVE_STATUS_KEY))[DRIVE_STATUS_KEY] as
    | DriveStatus
    | undefined
  await browser.storage.local.set({
    [DRIVE_STATUS_KEY]: { ...previous, error: undefined, ...patch },
  })
}

/** Called directly from a user gesture so Firefox/Chromium can request host permissions. */
export async function connectDrive(address: string): Promise<void> {
  const broker = brokerOrigin(address)
  const granted = await browser.permissions.request({
    origins: [`${broker}/*`, 'https://www.googleapis.com/*'],
  })
  if (!granted) throw new Error('需要授权访问登录服务和 Google Drive 才能连接。')
  await withStorageLock('drive-sync', async () => {
    const auth = await authorize(broker)
    await withStorageLock('local-write', async () => {
      const old = await getDriveState()
      const state =
        old?.account === auth.account
          ? { ...old, enabled: false }
          : seedState(auth.account, await readLocalDataUnlocked())
      await browser.storage.local.set({
        [DRIVE_AUTH_KEY]: auth,
        [DRIVE_STATE_KEY]: state,
        [DRIVE_STATUS_KEY]: { phase: 'idle' },
      })
    })
  })
}
export async function previewDrive(): Promise<DrivePreview> {
  return withStorageLock('drive-sync', async () => {
    const auth = await getAuth()
    if (!auth) throw new Error('请先连接 Google Drive。')
    const { documents } = await new DriveAPI(auth).readLatest()
    return withStorageLock('local-write', async () => {
      const state = await getDriveState()
      if (!state || state.account !== auth.account) throw new Error('连接已变化，请重新预览。')
      const local = await readLocalDataUnlocked()
      const remote = mergeRecords(...documents.map((d) => d.records))
      const result = materialize(mergeRecords(state.records, remote), local)
      const merged = new Map(
        mergeRecords(state.records, remote).map((r) => [`${r.kind}:${r.id}`, r]),
      )
      const changed = state.records.filter(
        (r) => !equal(r.value, merged.get(`${r.kind}:${r.id}`)?.value),
      ).length
      return {
        account: auth.account,
        local: counts(local),
        cloud: counts(materialize(remote, local)),
        result: counts(result),
        changed,
        localFingerprint: JSON.stringify(state.records),
        remoteFingerprint: fingerprint(documents),
      }
    })
  })
}
async function applyMerged(state: DriveState, documents: DriveDocument[]): Promise<DriveState> {
  const local = await readLocalDataUnlocked()
  const records = mergeRecords(state.records, ...documents.map((d) => d.records))
  const data = materialize(records, local)
  const next = {
    ...state,
    records,
    clock: records.reduce((max, r) => Math.max(max, r.counter), state.clock),
  }
  const items: Record<string, unknown> = { [DRIVE_STATE_KEY]: next }
  if (!dataEqual(local, data)) {
    await saveBackup(local, 'Google Drive 合并前')
    const revision = crypto.randomUUID()
    Object.assign(items, {
      [DATA_KEYS.categories]: data.categories,
      [DATA_KEYS.cards]: data.cards,
      [DATA_KEYS.settings]: data.settings,
      [BOOKMARK_SYNC_STATE_KEY]: { revision, pending: false },
      [LOCAL_CHANGE_KEY]: { writer: `drive-${revision}`, revision, source: 'drive' },
    })
  }
  await browser.storage.local.set(items)
  return next
}
export async function confirmDrive(preview: DrivePreview): Promise<void> {
  await withStorageLock('drive-sync', () =>
    withStorageLock('sync-provider', async () => {
      const auth = await getAuth()
      if (!auth || auth.account !== preview.account) throw new Error('连接已变化，请重新预览。')
      const { documents } = await new DriveAPI(auth).readLatest()
      if (fingerprint(documents) !== preview.remoteFingerprint)
        throw new Error('云端数据已变化，请重新预览后确认。')
      const current = await getDriveState()
      if (!current || JSON.stringify(current.records) !== preview.localFingerprint)
        throw new Error('本地数据已变化，请重新预览后确认。')
      // Wait for any in-flight browser sync before activating Drive.
      await disableSync()
      await withStorageLock('local-write', async () => {
        const state = await getDriveState()
        if (!state || JSON.stringify(state.records) !== preview.localFingerprint)
          throw new Error('本地数据已变化，请重新预览后确认。')
        await applyMerged({ ...state, enabled: true, dirty: true }, documents)
      })
    }),
  )
  await syncDrive()
}

async function finishUpload(api: DriveAPI, state: DriveState): Promise<void> {
  if (!state.upload) return
  await api.upload(state.upload.id, state.upload.document)
  await withStorageLock('local-write', async () => {
    const latest = await getDriveState()
    if (!latest?.upload || latest.upload.id !== state.upload?.id)
      throw new Error('本地上传状态已变化。')
    const { upload, ...rest } = latest
    await browser.storage.local.set({
      [DRIVE_STATE_KEY]: {
        ...rest,
        dirty: !equal(mergeRecords(latest.records), mergeRecords(upload.document.records)),
      },
    })
  })
}
export async function syncDrive(): Promise<void> {
  return withStorageLock('drive-sync', async () => {
    const auth = await getAuth()
    let state = await getDriveState()
    if (!state?.enabled || !auth || state.account !== auth.account) return
    try {
      await status({ phase: 'syncing' })
      const api = new DriveAPI(auth)
      await finishUpload(api, state)
      const { documents, files } = await api.readLatest()
      state = await withStorageLock('local-write', async () =>
        applyMerged((await getDriveState())!, documents),
      )
      if (state.dirty) {
        const id = await api.generateId()
        state = await withStorageLock('local-write', async () => {
          const latest = (await getDriveState())!
          const document: DriveDocument = {
            app: 'curio',
            version: 1,
            device: latest.device,
            sequence: latest.sequence + 1,
            records: mergeRecords(latest.records),
          }
          serializeDocument(document)
          const next = { ...latest, sequence: document.sequence, upload: { id, document } }
          await browser.storage.local.set({ [DRIVE_STATE_KEY]: next })
          return next
        })
        await finishUpload(api, state)
        // Cleanup failure does not invalidate the successfully committed snapshot.
        await api.prune(files, state.device).catch(() => {})
      }
      await status({ phase: 'idle', lastSync: Date.now() })
    } catch (error) {
      await status({
        phase: 'error',
        error: error instanceof Error ? error.message : '同步失败，请稍后重试。',
      })
      throw error
    }
  })
}
export async function pauseDrive(): Promise<void> {
  await withStorageLock('drive-sync', () =>
    withStorageLock('local-write', async () => {
      const state = await getDriveState()
      if (state)
        await browser.storage.local.set({ [DRIVE_STATE_KEY]: { ...state, enabled: false } })
    }),
  )
}
export async function disconnectDrive(): Promise<void> {
  await withStorageLock('drive-sync', () =>
    withStorageLock('local-write', async () => {
      const state = await getDriveState()
      if (state)
        await browser.storage.local.set({ [DRIVE_STATE_KEY]: { ...state, enabled: false } })
      await browser.storage.local.remove([DRIVE_AUTH_KEY, DRIVE_STATUS_KEY])
      forgetToken()
    }),
  )
}
