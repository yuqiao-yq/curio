import { commitReceivedBookmarks } from '../../../services/SyncService'
import { getRecentRepository, getRepository } from '../../../repositories'
import type { BookmarkState, StoreGet, StoreSet } from '../types'

/* ──────────────────────────────────────────────────────────────────────
 * 远端 → 本地的整包应用（V1.5 整包 LWW）。
 *
 * 关键约束：
 *   - 不能再触发任何 push（否则形成回声循环）
 *   - 用 repo.bulkImport(mode='replace') 在本地写锁内备份，再整包保存
 *   - 同步清理"最近使用"中指向已不存在卡片的脏记录，避免 UI 出现幽灵
 *   - 激活分类若被远端删除 → 回落到第一个顶层分类
 * ────────────────────────────────────────────────────────────────────── */

type SyncSlice = Pick<BookmarkState, 'applyRemoteBookmarks'>

export const createSyncSlice = (set: StoreSet, get: StoreGet): SyncSlice => ({
  async applyRemoteBookmarks(payload, ts, force = false) {
    if (!(await commitReceivedBookmarks(payload, ts, force))) return
    // 提交后再读取当前快照，保留提交期间其它页面刚写入的本地修改。
    const snapshot = await getRepository().bulkExport()
    set({ categories: snapshot.categories, cards: snapshot.cards })
    // 同步清理"最近使用"中指向已不存在卡片的脏记录
    const validIds = new Set(snapshot.cards.map((c) => c.id))
    const nextRecent = get().recentEntries.filter((e) => validIds.has(e.cardId))
    if (nextRecent.length !== get().recentEntries.length) {
      set({ recentEntries: nextRecent })
      void getRecentRepository().saveEntries(nextRecent)
    }
    // 激活分类被远端删了 → 落到第一个顶层分类
    const activeId = get().activeCategoryId
    if (activeId && !snapshot.categories.some((c) => c.id === activeId)) {
      const firstTop = snapshot.categories.find((c) => !c.parentId)
      set({
        activeCategoryId: firstTop?.id ?? snapshot.categories[0]?.id ?? null,
      })
    }
  },
})
