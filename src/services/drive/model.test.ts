import { describe, expect, it } from 'vitest'
import { fixture } from './testFixtures'
import {
  materialize,
  mergeRecords,
  seedState,
  serializeDocument,
  trackChanges,
  validateDocument,
} from './model'

describe('Drive revision merge', () => {
  it('converges regardless of delivery order and preserves independent offline edits and deletions', () => {
    const base = fixture(),
      seed = seedState('account', base)
    const a = structuredClone(base),
      b = structuredClone(base)
    a.cards[0].title = 'edited on Chrome'
    a.cards = a.cards.filter((c) => c.id !== 'b')
    b.cards[2].description = 'edited on Firefox'
    const left = trackChanges({ ...seed, device: 'chrome' }, base, a)
    const right = trackChanges({ ...seed, device: 'firefox' }, base, b)
    const merged = mergeRecords(left.records, right.records)
    expect(merged).toEqual(mergeRecords(right.records, left.records, seed.records))
    const result = materialize(merged, base)
    expect(result.cards.map((c) => c.id)).toEqual(['a', 'c'])
    expect(result.cards[0].title).toBe('edited on Chrome')
    expect(result.cards[1].description).toBe('edited on Firefox')
    expect(materialize(mergeRecords(merged, seed.records), base).cards).toEqual(result.cards)
  })
  it('resolves same-item concurrency deterministically and advances after observing remote revisions', () => {
    const base = fixture(),
      seed = seedState('account', base)
    const edit = structuredClone(base)
    edit.cards[0].title = 'concurrent'
    const left = trackChanges({ ...seed, device: 'a' }, base, edit)
    const right = trackChanges({ ...seed, device: 'z' }, base, {
      ...base,
      cards: base.cards.slice(1),
    })
    expect(
      materialize(mergeRecords(left.records, right.records), base).cards.some((c) => c.id === 'a'),
    ).toBe(false)
    const restored = trackChanges(
      { ...left, records: mergeRecords(left.records, right.records) },
      { ...base, cards: base.cards.slice(1) },
      edit,
    )
    expect(materialize(restored.records, base).cards[0].title).toBe('concurrent')
    expect(restored.clock).toBe(2)
  })
  it('never uploads native IDs, wallpaper, browser history or arbitrary settings/credentials', () => {
    const base = fixture()
    Object.assign(base.settings!, {
      apiKey: 'secret',
      wallpaper: 'data:private',
      recentIncludeBrowserHistory: true,
    })
    const state = seedState('account', base)
    const serialized = JSON.stringify(state.records)
    expect(serialized).not.toMatch(/secret|native-|wallpaper|recentIncludeBrowserHistory/)
    const rematerialized = materialize(state.records, base)
    expect(rematerialized.cards[0].bookmarkId).toBe('native-a')
    const otherDevice = materialize(state.records, { ...base, cards: [] })
    expect(otherDevice.cards[0].bookmarkId).toBeUndefined()
  })
  it('keeps children visible after concurrent parent removal and breaks category cycles', () => {
    const base = fixture()
    base.categories = [
      { ...base.categories[0], parentId: 'child' },
      { ...base.categories[0], id: 'child', parentId: 'folder' },
    ]
    base.cards[0].categoryId = 'deleted-parent'
    const result = materialize(seedState('account', base).records, base)
    expect(result.categories.some((c) => c.id === 'curio-drive-recovered')).toBe(true)
    expect(result.cards[0].categoryId).toBe('curio-drive-recovered')
    expect(result.categories.filter((c) => c.parentId)).toHaveLength(1)
  })
  it.each(['chrome-extension', 'edge-extension', 'moz-extension'])(
    'round-trips imported %s bookmarks without blocking the snapshot',
    (protocol) => {
      const base = fixture()
      base.cards[0].url = `${protocol}://example-extension/newtab.html`
      const state = seedState('account', base)
      const document = {
        app: 'curio' as const,
        version: 1 as const,
        device: state.device,
        sequence: 1,
        records: state.records,
      }
      const restored = validateDocument(JSON.parse(serializeDocument(document)))
      expect(materialize(restored.records, base).cards).toEqual(base.cards)
    },
  )
  it('rejects future schemas, unsafe content, duplicates, and credentials injected in cloud data', () => {
    const document = {
      app: 'curio',
      version: 1,
      device: 'a',
      sequence: 1,
      records: seedState('account', fixture()).records,
    }
    expect(validateDocument(document)).toEqual(document)
    expect(() => validateDocument({ ...document, version: 2 })).toThrow()
    expect(() =>
      validateDocument({ ...document, records: [...document.records, document.records[0]] }),
    ).toThrow()
    const bad = structuredClone(document)
    Object.assign(bad.records.find((r) => r.kind === 'card')!.value!, {
      url: 'javascript:alert(1)',
    })
    expect(() => validateDocument(bad)).toThrow()
    Object.assign(bad.records.find((r) => r.kind === 'card')!.value!, {
      url: 'https://example.com',
      apiKey: 'secret',
    })
    expect(() => validateDocument(bad)).toThrow()
  })
})
