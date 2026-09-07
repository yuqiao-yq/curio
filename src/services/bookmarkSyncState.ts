import { browser } from 'wxt/browser'
import { withStorageLock } from './storageLock'

export const BOOKMARK_SYNC_STATE_KEY = 'curio:bookmarks-sync-state'

export interface BookmarkSyncState {
  revision: string
  pending: boolean
}

export class PendingBookmarkChangesError extends Error {
  constructor() {
    super(
      '本地有未同步的书签，远端也有更新。已保留两边数据，请在数据管理中选择推送本机或从云端覆盖。',
    )
  }
}

export async function getBookmarkSyncState(): Promise<BookmarkSyncState | undefined> {
  const state = (await browser.storage.local.get(BOOKMARK_SYNC_STATE_KEY))[
    BOOKMARK_SYNC_STATE_KEY
  ] as BookmarkSyncState | undefined
  if (
    state !== undefined &&
    (!state || typeof state.revision !== 'string' || typeof state.pending !== 'boolean')
  ) {
    throw new Error('本地同步状态无效，已停止自动覆盖，请导出数据后重试')
  }
  return state
}

/** 只确认实际发出的版本；网络请求期间的新编辑仍须保留为待同步。 */
export async function acknowledgeBookmarkSync(revision: string | undefined): Promise<void> {
  if (!revision) return
  await withStorageLock('local-write', async () => {
    const state = await getBookmarkSyncState()
    if (state?.revision === revision) {
      await browser.storage.local.set({ [BOOKMARK_SYNC_STATE_KEY]: { ...state, pending: false } })
    }
  })
}
