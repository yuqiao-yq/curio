import { v4 as uuid } from 'uuid'
import { browser } from 'wxt/browser'
import { getRepository } from '../../repositories'
import { useBookmarkStore } from '../../stores/useBookmarkStore'
import type {
  BookmarkAssignment,
  NewCategoryProposal,
  OrganizePlan,
  PlanReview,
} from '../types'
import type { BookmarkCard, Category, ExportData } from '../../types/bookmark'

/**
 * Plan 应用 / 撤销
 *
 * 应用流程：
 *   1. 调 repository.bulkExport() 拿到全量 snapshot，写入 chrome.storage.local
 *      key 为 `curio:undo-snapshot`（覆盖式，仅保留最新一次）
 *   2. 计算「最终要执行的操作」：根据 review 过滤 plan
 *   3. 创建被接受的 newCategories（生成真实 uuid，记录 tempId → realId 映射）
 *   4. 移动书签（更新 categoryId，重排 order）
 *   5. 删除被接受 + 仍为空的分类
 *   6. 一次性 store.init() 重新拉数据，让 UI 同步
 *
 * 撤销流程（60s 内可触发）：
 *   1. 读取 snapshot
 *   2. repository.bulkImport(snapshot, 'replace') 完全恢复
 *   3. store.init()
 *   4. 删除 snapshot
 */

const SNAPSHOT_KEY = 'curio:undo-snapshot'

interface UndoSnapshot {
  planId: string
  takenAt: number
  data: ExportData
}

// ─── 应用 ───────────────────────────────────────────

export interface ApplyPlanResult {
  /** 实际新建的分类数（可能少于 plan 中的，因为有用户拒绝） */
  newCategoriesCreated: number
  bookmarksMoved: number
  categoriesDeleted: number
}

export async function applyPlan(
  plan: OrganizePlan,
  review: PlanReview,
): Promise<ApplyPlanResult> {
  const repo = getRepository()

  // 1. snapshot
  const data = await repo.bulkExport()
  await browser.storage.local.set({
    [SNAPSHOT_KEY]: {
      planId: plan.id,
      takenAt: Date.now(),
      data,
    } satisfies UndoSnapshot,
  })

  // 2. 过滤 + 准备
  const acceptedNewCategories = plan.newCategories.filter((c) =>
    review.acceptedNewCategoryTempIds.has(c.tempId),
  )
  const acceptedAssignments = plan.assignments.filter((_, i) =>
    review.acceptedAssignments.has(i),
  )
  const acceptedDeletions = plan.deletions.filter((id) =>
    review.acceptedDeletions.has(id),
  )

  // 3. 创建新分类
  const tempIdToRealId = new Map<string, string>()
  const now = Date.now()
  // order 取顶层分类当前最大 + 1 起步
  const allCats = data.categories
  const topMaxOrder = allCats
    .filter((c) => !c.parentId)
    .reduce((max, c) => Math.max(max, c.order), -1)
  const newCats: Category[] = acceptedNewCategories.map((p, idx) => {
    const realId = uuid()
    tempIdToRealId.set(p.tempId, realId)
    return {
      id: realId,
      name: p.name,
      icon: p.icon,
      // 新分类一律放顶层（避免跨层级误操作；用户可后续手动嵌套）
      parentId: undefined,
      order: topMaxOrder + 1 + idx,
      description: p.rationale,
      createdAt: now,
      updatedAt: now,
    }
  })
  if (newCats.length > 0) await repo.saveCategories(newCats)

  // 4. 移动书签
  // 先把所有需要更新的卡片汇总到一个 map（避免对同一卡片多次保存）
  const cardMap = new Map(data.cards.map((c) => [c.id, c]))
  const cardsToSave: BookmarkCard[] = []
  let movedCount = 0
  for (const asn of acceptedAssignments) {
    const card = cardMap.get(asn.bookmarkId)
    if (!card) continue
    const target = resolveTarget(asn, tempIdToRealId)
    if (!target) continue
    if (target === card.categoryId) continue
    const updated = { ...card, categoryId: target, updatedAt: now }
    cardMap.set(card.id, updated)
    cardsToSave.push(updated)
    movedCount++
  }
  // 重排：每个分类下的 order 重新按当前顺序连号（避免跨分类移动后留下空洞）
  if (cardsToSave.length > 0) {
    const grouped = new Map<string, BookmarkCard[]>()
    for (const c of cardMap.values()) {
      const list = grouped.get(c.categoryId) ?? []
      list.push(c)
      grouped.set(c.categoryId, list)
    }
    const reordered: BookmarkCard[] = []
    for (const list of grouped.values()) {
      list.sort((a, b) => a.order - b.order)
      list.forEach((c, i) => {
        if (c.order !== i) {
          reordered.push({ ...c, order: i, updatedAt: now })
        }
      })
    }
    // 只保存真正变化的（order 变 或 categoryId 变）
    const allChanged = new Map<string, BookmarkCard>()
    for (const c of cardsToSave) allChanged.set(c.id, c)
    for (const c of reordered) allChanged.set(c.id, c)
    await repo.saveCards(Array.from(allChanged.values()))
  }

  // 5. 删除空分类（仅在仍为空时才删 —— 防御并发）
  // 重新查一次最新 cards
  const latestCards = await repo.getCards()
  const cardCountByCat = new Map<string, number>()
  for (const c of latestCards) {
    cardCountByCat.set(c.categoryId, (cardCountByCat.get(c.categoryId) ?? 0) + 1)
  }
  const safeDeletions = acceptedDeletions.filter(
    (id) => (cardCountByCat.get(id) ?? 0) === 0,
  )
  if (safeDeletions.length > 0) {
    await repo.deleteCategories(safeDeletions)
  }

  // 6. 重新加载 store
  await useBookmarkStore.getState().init()

  return {
    newCategoriesCreated: newCats.length,
    bookmarksMoved: movedCount,
    categoriesDeleted: safeDeletions.length,
  }
}

function resolveTarget(
  asn: BookmarkAssignment,
  tempIdToRealId: Map<string, string>,
): string | null {
  if (asn.targetCategoryId) return asn.targetCategoryId
  if (asn.targetTempId) {
    return tempIdToRealId.get(asn.targetTempId) ?? null
  }
  return null
}

// ─── 撤销 ───────────────────────────────────────────

/** 是否有可用的撤销 snapshot */
export async function hasUndoSnapshot(): Promise<boolean> {
  const result = await browser.storage.local.get(SNAPSHOT_KEY)
  return !!result[SNAPSHOT_KEY]
}

/** 应用撤销：把 snapshot 全量 replace 回去 */
export async function undoPlan(): Promise<{ ok: boolean; message?: string }> {
  const result = await browser.storage.local.get(SNAPSHOT_KEY)
  const snap = result[SNAPSHOT_KEY] as UndoSnapshot | undefined
  if (!snap) {
    return { ok: false, message: '没有可撤销的整理记录' }
  }
  try {
    await getRepository().bulkImport(snap.data, 'replace')
    await useBookmarkStore.getState().init()
    await browser.storage.local.remove(SNAPSHOT_KEY)
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

/** 主动放弃撤销机会 */
export async function clearUndoSnapshot(): Promise<void> {
  await browser.storage.local.remove(SNAPSHOT_KEY)
}

// ─── 默认 review：全部接受 ───────────────────────────

export function makeAcceptAllReview(plan: OrganizePlan): PlanReview {
  return {
    acceptedNewCategoryTempIds: new Set(plan.newCategories.map((c) => c.tempId)),
    acceptedAssignments: new Set(plan.assignments.map((_, i) => i)),
    acceptedDeletions: new Set(plan.deletions),
  }
}

// ─── 计算 plan 给 UI 显示的统计数 ─────────────────────

export function summarizePlan(plan: OrganizePlan, review: PlanReview) {
  const newCats = plan.newCategories.filter((c) =>
    review.acceptedNewCategoryTempIds.has(c.tempId),
  ).length
  const moves = plan.assignments.filter((_, i) =>
    review.acceptedAssignments.has(i),
  ).length
  const deletes = plan.deletions.filter((id) =>
    review.acceptedDeletions.has(id),
  ).length
  return { newCategories: newCats, moves, deletions: deletes }
}

/** 给 UI 计算"未保留任何分组的提议"等防御性数据 */
export type { NewCategoryProposal }
