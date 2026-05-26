import { getRecentRepository, getRepository } from '../../../repositories'
import type { BookmarkState, StoreGet, StoreSet } from '../types'

/* ──────────────────────────────────────────────────────────────────────
 * 远端 → 本地的整包应用（V1.5 整包 LWW）。
 *
 * 关键约束：
 *   - 不能再触发任何 push（否则形成回声循环）
 *   - 用 repo.bulkImport(mode='replace') 原子重写，保证重启后看到的就是
 *     云端版本
 *   - 同步清理"最近使用"中指向已不存在卡片的脏记录，避免 UI 出现幽灵
 *   - 激活分类若被远端删除 → 回落到第一个顶层分类
 * ────────────────────────────────────────────────────────────────────── */

type SyncSlice = Pick<BookmarkState, 'applyRemoteBookmarks'>

export const createSyncSlice = (
  set: StoreSet,
  get: StoreGet,
): SyncSlice => ({
  async applyRemoteBookmarks(payload) {
    // 内存先替换，UI 立刻刷新；不触发 push 回声
    set({ categories: payload.categories, cards: payload.cards })
    // 持久化到本地仓库：mode='replace' 会原子清空+重写 categories & cards，
    // 不动 settings（与本管线职责一致）
    try {
      await getRepository().bulkImport(
        {
          version: 'sync',
          exportedAt: Date.now(),
          categories: payload.categories,
          cards: payload.cards,
        },
        'replace',
      )
    } catch (err) {
      // 落盘失败不致命：内存已是新版，下次启动会因为 manifest.ts > lastPullTs
      // 而被 bootstrap 重新拉取，幂等。
      console.error('[sync] applyRemoteBookmarks 持久化失败：', err)
    }
    // 同步清理"最近使用"中指向已不存在卡片的脏记录
    const validIds = new Set(payload.cards.map((c) => c.id))
    const nextRecent = get().recentEntries.filter((e) =>
      validIds.has(e.cardId),
    )
    if (nextRecent.length !== get().recentEntries.length) {
      set({ recentEntries: nextRecent })
      void getRecentRepository().saveEntries(nextRecent)
    }
    // 激活分类被远端删了 → 落到第一个顶层分类
    const activeId = get().activeCategoryId
    if (activeId && !payload.categories.some((c) => c.id === activeId)) {
      const firstTop = payload.categories.find((c) => !c.parentId)
      set({
        activeCategoryId: firstTop?.id ?? payload.categories[0]?.id ?? null,
      })
    }
  },
})
