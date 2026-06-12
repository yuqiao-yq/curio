/**
 * legacyMigration 测试（tabit: → curio: 命名空间迁移）
 *
 * 老用户升级时如果这段逻辑写错，数据会完全消失。覆盖：
 *  - chrome.storage.local：tabit:* → curio:*，旧 key 必须删除
 *  - 新 key 已存在时，旧的应被丢弃（新版数据优先）
 *  - localStorage：白名单 key 迁移；新 key 有值时保留新值
 *  - IndexedDB：tabit-pages → curio-pages 全表复制 + schema 重建
 *  - 完成标记 curio:_legacy_migrated_at 写入；第二次启动直接跳过
 *  - 失败时不写标记（下次重试）
 *  - 同进程并发调用复用同一 Promise（inflight）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const FLAG = 'curio:_legacy_migrated_at'

// 模块内有 inflight 单例；每个 test 跑完都 reset，否则跨 test 状态污染
afterEach(async () => {
  await chrome.storage.local.clear()
  if (typeof localStorage !== 'undefined') localStorage.clear()
  await wipeAllIDBs()
  // 重置模块缓存的 inflight Promise：通过重新 import 实现
  vi.resetModules()
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.resetModules()
})

/** 把 fake-indexeddb 中所有 db 都删了（每个 test 之间隔离） */
async function wipeAllIDBs() {
  if (typeof indexedDB === 'undefined') return
  const idb = indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string }>>
  }
  if (typeof idb.databases !== 'function') return
  const dbs = await idb.databases()
  await Promise.all(
    dbs
      .map((d) => d.name)
      .filter(Boolean)
      .map(
        (name) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name as string)
            req.onsuccess = () => resolve()
            req.onerror = () => resolve()
            req.onblocked = () => resolve()
          }),
      ),
  )
}

/** 重新 import 拿一个没有 inflight 缓存的版本 */
async function fresh() {
  vi.resetModules()
  const mod = await import('./legacyMigration')
  return mod.runLegacyMigrationOnce
}

/** 创建一个旧 IndexedDB 库，写入若干行，便于验证迁移后能搬过去 */
function createLegacyDb(
  name: string,
  store: string,
  rows: Array<{ id: string; title: string }>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name, 1)
    open.onupgradeneeded = () => {
      open.result.createObjectStore(store, { keyPath: 'id' }).createIndex('title', 'title')
    }
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(store, 'readwrite')
      const s = tx.objectStore(store)
      rows.forEach((r) => s.put(r))
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
    open.onerror = () => reject(open.error)
  })
}

/** 读取一个 db 某 store 的全部行（用于断言迁移后内容） */
function readAll(name: string, store: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(name)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction(store, 'readonly')
      const req = tx.objectStore(store).getAll()
      req.onsuccess = () => {
        db.close()
        resolve(req.result)
      }
      req.onerror = () => reject(req.error)
    }
    open.onerror = () => reject(open.error)
  })
}

// ─── chrome.storage.local ────────────────────────────

describe('legacyMigration: chrome.storage.local', () => {
  it('tabit:* → curio:*，旧 key 删除', async () => {
    await chrome.storage.local.set({
      'tabit:categories': [{ id: 'c1' }],
      'tabit:cards': [{ id: 'b1' }],
      'tabit:settings': { theme: 'dark' },
      'unrelated:key': 'keep-me',
    })
    const run = await fresh()
    await run()
    const all = await chrome.storage.local.get(null)

    expect(all['curio:categories']).toEqual([{ id: 'c1' }])
    expect(all['curio:cards']).toEqual([{ id: 'b1' }])
    expect(all['curio:settings']).toEqual({ theme: 'dark' })
    // 旧 key 必须删除
    expect(all['tabit:categories']).toBeUndefined()
    expect(all['tabit:cards']).toBeUndefined()
    expect(all['tabit:settings']).toBeUndefined()
    // 无关 key 保留
    expect(all['unrelated:key']).toBe('keep-me')
  })

  it('新 key 已存在时丢弃旧 key（新版数据优先）', async () => {
    await chrome.storage.local.set({
      'tabit:settings': { theme: 'dark', src: 'legacy' },
      'curio:settings': { theme: 'light', src: 'new' },
    })
    const run = await fresh()
    await run()
    const all = await chrome.storage.local.get(null)

    expect(all['curio:settings']).toEqual({ theme: 'light', src: 'new' })
    expect(all['tabit:settings']).toBeUndefined()
  })

  it('完成后写入迁移标记，再调一次直接跳过', async () => {
    await chrome.storage.local.set({ 'tabit:foo': 1 })
    const run = await fresh()
    await run()
    const flag = (await chrome.storage.local.get(FLAG))[FLAG]
    expect(typeof flag).toBe('number')

    // 再放一个旧 key，跑第二次 → 不应被迁移（已跳过）
    await chrome.storage.local.set({ 'tabit:bar': 2 })
    const run2 = await fresh()
    await run2()
    const all = await chrome.storage.local.get(null)
    expect(all['tabit:bar']).toBe(2)
    expect(all['curio:bar']).toBeUndefined()
  })

  it('没有任何旧数据时也走通流程，写下完成标记', async () => {
    const run = await fresh()
    await run()
    const flag = (await chrome.storage.local.get(FLAG))[FLAG]
    expect(typeof flag).toBe('number')
  })
})

// ─── localStorage ────────────────────────────────────

describe('legacyMigration: localStorage', () => {
  it('白名单 key 迁移', async () => {
    localStorage.setItem('tabit:web-search-engine', 'google')
    localStorage.setItem('tabit:search-history', JSON.stringify(['hi']))
    const run = await fresh()
    await run()

    expect(localStorage.getItem('curio:web-search-engine')).toBe('google')
    expect(localStorage.getItem('curio:search-history')).toBe('["hi"]')
    expect(localStorage.getItem('tabit:web-search-engine')).toBeNull()
    expect(localStorage.getItem('tabit:search-history')).toBeNull()
  })

  it('新 key 已有值时保留新值，仅清掉旧 key', async () => {
    localStorage.setItem('tabit:web-search-engine', 'old-bing')
    localStorage.setItem('curio:web-search-engine', 'new-google')
    const run = await fresh()
    await run()

    expect(localStorage.getItem('curio:web-search-engine')).toBe('new-google')
    expect(localStorage.getItem('tabit:web-search-engine')).toBeNull()
  })

  it('非白名单 tabit: key 不动（保守不动用户其它本地数据）', async () => {
    localStorage.setItem('tabit:something-else', 'untouched')
    const run = await fresh()
    await run()
    expect(localStorage.getItem('tabit:something-else')).toBe('untouched')
  })
})

// ─── IndexedDB ───────────────────────────────────────

describe('legacyMigration: IndexedDB', () => {
  it('tabit-pages → curio-pages 全表复制', async () => {
    await createLegacyDb('tabit-pages', 'pages', [
      { id: 'p1', title: 'Page 1' },
      { id: 'p2', title: 'Page 2' },
    ])
    const run = await fresh()
    await run()

    const rows = (await readAll('curio-pages', 'pages')) as Array<{ id: string; title: string }>
    expect(rows.map((r) => r.id).sort()).toEqual(['p1', 'p2'])
    expect(rows.find((r) => r.id === 'p1')?.title).toBe('Page 1')

    // 旧 db 应被删
    const idb = indexedDB as IDBFactory & {
      databases?: () => Promise<Array<{ name?: string }>>
    }
    const list = await idb.databases!()
    expect(list.map((d) => d.name)).not.toContain('tabit-pages')
    expect(list.map((d) => d.name)).toContain('curio-pages')
  })

  it('新 db 已存在 → 旧库直接删，不覆盖新数据', async () => {
    await createLegacyDb('tabit-pages', 'pages', [{ id: 'old', title: 'Old' }])
    await createLegacyDb('curio-pages', 'pages', [{ id: 'new', title: 'New' }])

    const run = await fresh()
    await run()

    const rows = (await readAll('curio-pages', 'pages')) as Array<{ id: string; title: string }>
    // 应保留新数据，老数据不能渗进来
    expect(rows.map((r) => r.id)).toEqual(['new'])
    expect(rows[0].title).toBe('New')

    const idb = indexedDB as IDBFactory & {
      databases?: () => Promise<Array<{ name?: string }>>
    }
    const list = await idb.databases!()
    expect(list.map((d) => d.name)).not.toContain('tabit-pages')
  })

  it('没有任何旧 db 时不报错', async () => {
    const run = await fresh()
    await expect(run()).resolves.toBeUndefined()
  })
})

// ─── 并发 / 异常 ────────────────────────────────────

describe('legacyMigration: 并发 + 异常', () => {
  it('同一进程内并发调用共享 inflight Promise', async () => {
    await chrome.storage.local.set({ 'tabit:foo': 1 })
    const run = await fresh()
    const p1 = run()
    const p2 = run()
    // 必须是同一个 promise 实例（inflight 复用）
    expect(p1).toBe(p2)
    await Promise.all([p1, p2])
    // 标记只该写一次（值就一个）
    const flag = (await chrome.storage.local.get(FLAG))[FLAG]
    expect(typeof flag).toBe('number')
  })

  it('storage.set 抛错 → 标记不写，下次还能重试', async () => {
    await chrome.storage.local.set({ 'tabit:foo': 1 })

    // 让首次的 storage.local.set 抛错；用 mockImplementation 单次失败
    const setSpy = vi.spyOn(chrome.storage.local, 'set')
    let calls = 0
    setSpy.mockImplementation((items: Record<string, unknown>) => {
      calls++
      // 第 2 次 set 是写迁移结果，故意失败
      if (calls === 1) {
        return Promise.reject(new Error('boom'))
      }
      // 走原实现
      setSpy.mockRestore()
      return chrome.storage.local.set(items)
    })

    const run = await fresh()
    await expect(run()).rejects.toThrow('boom')

    // 标记不应写入
    const all = await chrome.storage.local.get(null)
    expect(all[FLAG]).toBeUndefined()

    // 重试应能成功
    setSpy.mockRestore()
    const run2 = await fresh()
    await run2()
    const all2 = await chrome.storage.local.get(null)
    expect(all2[FLAG]).toBeDefined()
    expect(all2['curio:foo']).toBe(1)
  })
})
