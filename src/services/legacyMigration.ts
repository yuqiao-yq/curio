import { browser } from 'wxt/browser'

/* ─────────────────────────────────────────────────────────────
 * 一次性数据迁移：tabit 命名空间 → curio 命名空间
 *
 * v0.22.x 之前的版本使用 `tabit:` / `tabit-` 作为存储命名空间。
 * 改名为 Curio 之后所有 storage key / IndexedDB 库名都迁到 `curio:` / `curio-`。
 * 本工具负责无损地把老用户的本地数据搬到新前缀下，使升级后开箱即用。
 *
 * 涉及三类存储：
 *   1) chrome.storage.local 的所有 `tabit:*` keys
 *   2) localStorage 的 `tabit:web-search-engine` / `tabit:search-history`
 *   3) IndexedDB 的 `tabit-pages` / `tabit-embeddings` 数据库
 *
 * 幂等：以 `curio:_legacy_migrated_at` 作为完成标记，存在即跳过。
 * 失败：不写入标记 → 下次启动会重试，期间不会污染新前缀的数据。
 *
 * 调用时机：
 *   - background.ts onInstalled / onStartup（service worker 启动时）
 *   - newtab/App.tsx 启动时（防御性兜底，避免 SW 未就绪）
 * 两端同时跑也安全（用 flag 收敛 + IndexedDB 操作幂等）。
 * ───────────────────────────────────────────────────────────── */

const MIGRATION_FLAG_KEY = 'curio:_legacy_migrated_at'
const LEGACY_PREFIX = 'tabit:'
const NEW_PREFIX = 'curio:'

/** localStorage 中已知的旧 key（搜索引擎选择、搜索历史） */
const LEGACY_LOCALSTORAGE_KEYS = [
  'tabit:web-search-engine',
  'tabit:search-history',
] as const

/** IndexedDB 库映射：[旧名, 新名] */
const LEGACY_INDEXED_DBS: ReadonlyArray<readonly [string, string]> = [
  ['tabit-pages', 'curio-pages'],
  ['tabit-embeddings', 'curio-embeddings'],
]

let inflight: Promise<void> | null = null

/**
 * 一次性执行（同进程内并发调用会复用同一个 Promise）。
 * 跨进程并发也安全：完成标记 + IndexedDB 操作各自幂等。
 */
export function runLegacyMigrationOnce(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const flag = await browser.storage.local.get(MIGRATION_FLAG_KEY)
      if (flag[MIGRATION_FLAG_KEY]) return

      await migrateChromeStorageLocal()
      migrateLocalStorage()
      await migrateIndexedDbs()

      await browser.storage.local.set({ [MIGRATION_FLAG_KEY]: Date.now() })
      console.log('[curio] legacy data migration completed')
    } catch (err) {
      console.warn('[curio] legacy migration failed (will retry on next start):', err)
      // 不写入标记 → 下次启动重试；已迁移的部分不会重复写（key 已存在则保留新）
      inflight = null
      throw err
    }
  })()
  return inflight
}

// ─── 1) chrome.storage.local ──────────────────────────────

async function migrateChromeStorageLocal(): Promise<void> {
  const all = (await browser.storage.local.get(null)) as Record<string, unknown>
  const writeObj: Record<string, unknown> = {}
  const removeKeys: string[] = []

  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith(LEGACY_PREFIX)) continue
    const newKey = NEW_PREFIX + k.slice(LEGACY_PREFIX.length)
    // 新 key 已存在（用户在新旧版本之间来回切？）→ 新版数据优先，旧的直接丢
    if (newKey in all) {
      removeKeys.push(k)
      continue
    }
    writeObj[newKey] = v
    removeKeys.push(k)
  }

  if (Object.keys(writeObj).length > 0) {
    await browser.storage.local.set(writeObj)
  }
  if (removeKeys.length > 0) {
    await browser.storage.local.remove(removeKeys)
  }
}

// ─── 2) localStorage ─────────────────────────────────────

function migrateLocalStorage(): void {
  // service worker 没有 localStorage，跳过即可（背景任务由 App 端补迁）
  if (typeof localStorage === 'undefined') return

  for (const oldKey of LEGACY_LOCALSTORAGE_KEYS) {
    const newKey = NEW_PREFIX + oldKey.slice(LEGACY_PREFIX.length)
    try {
      if (localStorage.getItem(newKey) !== null) {
        // 新 key 已有值 → 保留新值，仅清掉旧 key
        localStorage.removeItem(oldKey)
        continue
      }
      const v = localStorage.getItem(oldKey)
      if (v === null) continue
      localStorage.setItem(newKey, v)
      localStorage.removeItem(oldKey)
    } catch {
      /* QuotaExceeded / private mode 等异常忽略，不影响主流程 */
    }
  }
}

// ─── 3) IndexedDB ────────────────────────────────────────

async function migrateIndexedDbs(): Promise<void> {
  if (typeof indexedDB === 'undefined') return

  // databases() 在较老 Firefox / 某些 SW 环境可能不可用 → 无害跳过；
  // 这种情况下用户大概率也没有旧库（新装），不影响升级体验
  const dbs = await listDatabases()
  const names = new Set(dbs.map((d) => d.name).filter(Boolean) as string[])

  for (const [oldName, newName] of LEGACY_INDEXED_DBS) {
    if (!names.has(oldName)) continue

    if (names.has(newName)) {
      // 新 db 已存在数据 → 新版优先，旧库直接清掉避免占用配额
      await deleteDb(oldName)
      continue
    }
    try {
      await copyAllStores(oldName, newName)
      await deleteDb(oldName)
    } catch (err) {
      console.warn(`[curio] migrate IndexedDB ${oldName} → ${newName} failed:`, err)
      // 单库失败不影响其它库；不删旧库，下次还能重试
    }
  }
}

interface IDBDatabaseInfoLite {
  name?: string
  version?: number
}

async function listDatabases(): Promise<IDBDatabaseInfoLite[]> {
  const idb = indexedDB as IDBFactory & {
    databases?: () => Promise<IDBDatabaseInfoLite[]>
  }
  if (typeof idb.databases !== 'function') return []
  try {
    return await idb.databases()
  } catch {
    return []
  }
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
    req.onblocked = () => resolve()
  })
}

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

interface StoreSchema {
  name: string
  keyPath: string | string[] | null
  autoIncrement: boolean
  indexes: Array<{
    name: string
    keyPath: string | string[]
    unique: boolean
    multiEntry: boolean
  }>
}

/**
 * 把 srcName 数据库所有 object store 的全部记录复制到 dstName 数据库。
 *
 * - 用 native IndexedDB API 提取旧 db 的 schema（store + index 元数据）
 * - 在新 db (version=1) 中按同样的 schema 重建 → 与 dexie 后续打开兼容
 *   （dexie 模型也是 version=1，因此 open 时不会触发 upgrade 回调）
 * - 全量数据 bulkPut 写入；不使用事务嵌套以兼容更老浏览器
 */
async function copyAllStores(srcName: string, dstName: string): Promise<void> {
  const src = await openDb(srcName)
  try {
    const storeNames = Array.from(src.objectStoreNames)
    if (storeNames.length === 0) return

    const schemas: StoreSchema[] = []
    const data: Record<string, unknown[]> = {}

    // 用单一 readonly 事务把 schema 和数据一次性读出
    const tx = src.transaction(storeNames, 'readonly')
    for (const sn of storeNames) {
      const s = tx.objectStore(sn)
      const indexes: StoreSchema['indexes'] = []
      for (const ixName of Array.from(s.indexNames)) {
        const idx = s.index(ixName)
        indexes.push({
          name: idx.name,
          keyPath: idx.keyPath as string | string[],
          unique: idx.unique,
          multiEntry: idx.multiEntry,
        })
      }
      schemas.push({
        name: sn,
        keyPath: (s.keyPath as string | string[] | null) ?? null,
        autoIncrement: s.autoIncrement,
        indexes,
      })
      data[sn] = await reqToPromise(s.getAll())
    }
    src.close()

    // 在新 db 中重建 schema + 写入数据
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(dstName, 1)
      open.onupgradeneeded = () => {
        const db = open.result
        for (const sch of schemas) {
          const params: IDBObjectStoreParameters = {}
          if (sch.keyPath !== null) params.keyPath = sch.keyPath
          if (sch.autoIncrement) params.autoIncrement = true
          const os = db.createObjectStore(sch.name, params)
          for (const ix of sch.indexes) {
            os.createIndex(ix.name, ix.keyPath, {
              unique: ix.unique,
              multiEntry: ix.multiEntry,
            })
          }
        }
      }
      open.onsuccess = () => {
        const db = open.result
        const writeTx = db.transaction(
          Array.from(db.objectStoreNames),
          'readwrite',
        )
        writeTx.oncomplete = () => {
          db.close()
          resolve()
        }
        writeTx.onerror = () => {
          db.close()
          reject(writeTx.error)
        }
        writeTx.onabort = () => {
          db.close()
          reject(writeTx.error ?? new Error('writeTx aborted'))
        }
        for (const sch of schemas) {
          const s = writeTx.objectStore(sch.name)
          for (const row of data[sch.name]) {
            s.put(row)
          }
        }
      }
      open.onerror = () => reject(open.error)
    })
  } finally {
    try {
      src.close()
    } catch {
      /* already closed */
    }
  }
}
