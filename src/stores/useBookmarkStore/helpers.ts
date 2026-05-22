import type { Category } from '../../types/bookmark'

/**
 * 标签标准化：trim、过滤空、去重、单个 ≤ 12 字符、整体 ≤ 8 个。
 * 在所有 tag 写入前都过一遍，避免脏数据。
 */
export function normalizeTags(tags: string[] | undefined | null): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const t = raw.trim().slice(0, 12)
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= 8) break
  }
  return out
}

/** BFS 收集所有后代分类 ID（与 LocalRepository 中的逻辑对称） */
export function collectDescendantIds(
  ids: string[],
  allCats: Category[],
): Set<string> {
  const result = new Set(ids)
  const queue = [...ids]
  while (queue.length > 0) {
    const parentId = queue.shift()!
    for (const c of allCats) {
      if (c.parentId === parentId && !result.has(c.id)) {
        result.add(c.id)
        queue.push(c.id)
      }
    }
  }
  return result
}

/** 简易 groupBy：按 keyFn 分桶 */
export function groupBy<T, K>(arr: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of arr) {
    const k = keyFn(item)
    const list = map.get(k)
    if (list) list.push(item)
    else map.set(k, [item])
  }
  return map
}
