import type { BookmarkCard, Category, ExportData, UserSettings } from '../../types/bookmark'

export const DRIVE_STATE_KEY = 'curio:drive:state'
export const DRIVE_AUTH_KEY = 'curio:drive:auth'
export const DRIVE_STATUS_KEY = 'curio:drive:status'
export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024
export const DATA_KEYS = {
  categories: 'curio:categories',
  cards: 'curio:cards',
  settings: 'curio:settings',
} as const
// Deliberately excludes credentials, browser history, native bookmark IDs and device settings.
export const SETTING_KEYS = [
  'theme',
  'layout',
  'language',
  'cardSize',
  'cardIconSize',
  'cardGlass',
  'cardWidthMode',
  'cardWidthMin',
  'cardWidthMax',
  'cardWidthFixed',
  'cardCustomWidthMin',
  'cardCustomWidthMax',
  'cardCustomHeightMin',
  'cardCustomHeightMax',
  'fontColor',
  'backgroundBlur',
  'subSectionDefaultExpanded',
] as const satisfies readonly (keyof UserSettings)[]
type Kind = 'category' | 'card' | 'setting'
export interface DriveRecord {
  kind: Kind
  id: string
  counter: number
  device: string
  value: Category | BookmarkCard | string | number | boolean | null
}
export interface DriveDocument {
  app: 'curio'
  version: 1
  device: string
  sequence: number
  records: DriveRecord[]
}
export interface DriveState {
  account: string
  device: string
  enabled: boolean
  clock: number
  sequence: number
  records: DriveRecord[]
  dirty: boolean
  // Persist BEFORE creating the file. A timed-out upload can safely retry the same ID/body.
  upload?: { id: string; document: DriveDocument }
}
const categoryKeys = [
  'id',
  'name',
  'icon',
  'color',
  'description',
  'parentId',
  'order',
  'createdAt',
  'updatedAt',
]
const cardKeys = [
  'id',
  'categoryId',
  'title',
  'url',
  'icon',
  'thumbnail',
  'description',
  'tags',
  'order',
  'createdAt',
  'updatedAt',
]
const keyOf = (r: DriveRecord) => `${r.kind}:${r.id}`
const pick = (o: object, keys: string[]) =>
  Object.fromEntries(
    keys
      .filter((k) => (o as Record<string, unknown>)[k] !== undefined)
      .map((k) => [k, (o as Record<string, unknown>)[k]]),
  )
export const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

function dataRecords(data: ExportData): DriveRecord[] {
  return [
    ...data.categories.map((c) => ({
      kind: 'category' as const,
      id: c.id,
      value: pick(c, categoryKeys) as unknown as Category,
    })),
    ...data.cards.map((c) => ({
      kind: 'card' as const,
      id: c.id,
      value: pick(c, cardKeys) as unknown as BookmarkCard,
    })),
    ...SETTING_KEYS.map((id) => ({
      kind: 'setting' as const,
      id,
      value: data.settings?.[id] ?? null,
    })),
  ].map((r) => ({ ...r, counter: 0, device: '' }))
}
export function seedState(account: string, data: ExportData): DriveState {
  return {
    account,
    device: crypto.randomUUID(),
    enabled: false,
    clock: 0,
    sequence: 0,
    records: dataRecords(data),
    dirty: true,
  }
}
// Whole entities use a logical revision. Independent edits survive; concurrent edits to the
// same entity choose a deterministic winner. Tombstones never expire automatically.
function compare(a: DriveRecord, b: DriveRecord): number {
  if (a.counter !== b.counter) return a.counter - b.counter
  if (a.counter === 0) {
    const time = (r: DriveRecord) =>
      typeof r.value === 'object' && r.value ? r.value.updatedAt : 0
    if (time(a) !== time(b)) return time(a) - time(b)
  }
  if (a.device !== b.device) return a.device < b.device ? -1 : 1
  // Seed records can have identical timestamps; stable tie-breaking keeps merge commutative.
  const av = JSON.stringify(a.value),
    bv = JSON.stringify(b.value)
  return av === bv ? 0 : av < bv ? -1 : 1
}
export function mergeRecords(...groups: DriveRecord[][]): DriveRecord[] {
  const map = new Map<string, DriveRecord>()
  for (const r of groups.flat()) {
    const old = map.get(keyOf(r))
    if (!old || compare(r, old) > 0) map.set(keyOf(r), r)
  }
  return [...map.values()].sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0))
}
export function trackChanges(state: DriveState, before: ExportData, after: ExportData): DriveState {
  const previous = new Map(dataRecords(before).map((r) => [keyOf(r), r]))
  const next = new Map(dataRecords(after).map((r) => [keyOf(r), r]))
  const changes: DriveRecord[] = []
  const counter = state.records.reduce((max, r) => Math.max(max, r.counter), state.clock) + 1
  for (const key of new Set([...previous.keys(), ...next.keys()])) {
    if (equal(previous.get(key)?.value, next.get(key)?.value)) continue
    const record = next.get(key) ?? { ...previous.get(key)!, value: null }
    changes.push({ ...record, counter, device: state.device })
  }
  return changes.length
    ? { ...state, clock: counter, records: mergeRecords(state.records, changes), dirty: true }
    : state
}

export function materialize(records: DriveRecord[], local: ExportData): ExportData {
  const categories: Category[] = [],
    cards: BookmarkCard[] = []
  const settings = { ...local.settings } as UserSettings
  const localCats = new Map(local.categories.map((c) => [c.id, c.bookmarkId]))
  const localCards = new Map(local.cards.map((c) => [c.id, c.bookmarkId]))
  for (const r of records) {
    if (r.kind === 'setting') {
      if (r.value === null) delete (settings as unknown as Record<string, unknown>)[r.id]
      else Object.assign(settings, { [r.id]: r.value })
    } else if (r.value !== null) {
      if (r.kind === 'category')
        categories.push({
          ...(r.value as Category),
          ...(localCats.get(r.id) ? { bookmarkId: localCats.get(r.id) } : {}),
        })
      else
        cards.push({
          ...(r.value as BookmarkCard),
          ...(localCards.get(r.id) ? { bookmarkId: localCards.get(r.id) } : {}),
        })
    }
  }
  const ids = new Map(categories.map((c) => [c.id, c]))
  // Concurrent parent deletion/moves must not hide surviving children or form a cycle.
  for (const c of categories) {
    const visited = new Set([c.id])
    let p = c.parentId
    while (p) {
      if (!ids.has(p) || visited.has(p)) {
        delete c.parentId
        break
      }
      visited.add(p)
      p = ids.get(p)?.parentId
    }
  }
  const orphans = cards.filter((c) => !ids.has(c.categoryId))
  if (orphans.length) {
    const id = 'curio-drive-recovered'
    if (!ids.has(id))
      categories.push({
        id,
        name: '同步恢复的书签',
        icon: '📥',
        order: 0,
        createdAt: 0,
        updatedAt: 0,
      })
    for (const c of orphans) c.categoryId = id
  }
  categories.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  cards.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return { version: '1.0', exportedAt: Date.now(), categories, cards, settings }
}

function validSetting(id: string, value: unknown): boolean {
  if (!(SETTING_KEYS as readonly string[]).includes(id)) return false
  if (value === null) return !['theme', 'layout', 'language', 'cardSize'].includes(id)
  const enums: Record<string, string[]> = {
    theme: ['light', 'dark', 'auto'],
    layout: ['grid', 'list'],
    language: ['zh-CN', 'en'],
    cardSize: ['compact', 'standard', 'custom'],
    cardIconSize: ['small', 'standard'],
    cardWidthMode: ['responsive', 'fluid', 'fixed'],
  }
  if (enums[id]) return typeof value === 'string' && enums[id].includes(value)
  if (['cardGlass', 'subSectionDefaultExpanded'].includes(id)) return typeof value === 'boolean'
  if (id === 'fontColor') return typeof value === 'string' && value.length < 256
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 4096
}
export function validateDocument(raw: unknown): DriveDocument {
  const fail = () => {
    throw new Error('Drive 数据格式损坏或版本不兼容，已停止同步，未覆盖本地数据。')
  }
  if (!raw || typeof raw !== 'object') return fail()
  const d = raw as DriveDocument
  if (
    d.app !== 'curio' ||
    d.version !== 1 ||
    typeof d.device !== 'string' ||
    !d.device ||
    !Number.isSafeInteger(d.sequence) ||
    d.sequence < 1 ||
    !Array.isArray(d.records) ||
    d.records.length > 100_000
  )
    return fail()
  const seen = new Set<string>()
  for (const r of d.records) {
    if (
      !r ||
      !['category', 'card', 'setting'].includes(r.kind) ||
      typeof r.id !== 'string' ||
      !r.id ||
      ['__proto__', 'constructor', 'prototype'].includes(r.id) ||
      !Number.isSafeInteger(r.counter) ||
      r.counter < 0 ||
      typeof r.device !== 'string' ||
      seen.has(keyOf(r))
    )
      return fail()
    seen.add(keyOf(r))
    if (r.kind === 'setting') {
      if (!validSetting(r.id, r.value)) return fail()
      continue
    }
    if (r.value === null) continue
    if (!r.value || typeof r.value !== 'object') return fail()
    const v = r.value as unknown as Record<string, unknown>
    const keys = r.kind === 'card' ? cardKeys : categoryKeys
    if (v.id !== r.id || Object.keys(v).some((k) => !keys.includes(k))) return fail()
    for (const k of ['order', 'createdAt', 'updatedAt'])
      if (typeof v[k] !== 'number' || !Number.isFinite(v[k])) return fail()
    for (const k of keys.filter((k) => !['order', 'createdAt', 'updatedAt', 'tags'].includes(k)))
      if (v[k] !== undefined && typeof v[k] !== 'string') return fail()
    if (r.kind === 'card') {
      if (
        typeof v.title !== 'string' ||
        typeof v.categoryId !== 'string' ||
        typeof v.url !== 'string' ||
        !/^(https?:|ftp:|file:|chrome:|edge:|about:|chrome-extension:|edge-extension:|moz-extension:)/i.test(
          v.url,
        )
      )
        return fail()
      if (
        v.tags !== undefined &&
        (!Array.isArray(v.tags) || v.tags.some((t) => typeof t !== 'string'))
      )
        return fail()
    } else if (typeof v.name !== 'string') return fail()
  }
  return d
}

export function serializeDocument(document: DriveDocument): string {
  validateDocument(document)
  const text = JSON.stringify(document)
  if (new TextEncoder().encode(text).length > MAX_DOCUMENT_BYTES)
    throw new Error('同步快照超过 4 MiB，请减少内嵌缩略图后重试。')
  return text
}
