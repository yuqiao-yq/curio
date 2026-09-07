import Dexie from 'dexie'
import type { ExportData } from '../types/bookmark'

export interface Backup {
  id: string
  createdAt: number
  reason: string
  data: ExportData
}

async function withBackups<T>(action: (table: Dexie.Table<Backup, string>) => Promise<T>) {
  const db = new Dexie('curio-backups')
  db.version(1).stores({ backups: 'id, createdAt' })
  try {
    return await action(db.table<Backup, string>('backups'))
  } finally {
    db.close()
  }
}

/** 调用方持有本地写锁；备份失败必须阻止破坏性操作。只包含书签数据，不含 AI 密钥。 */
export async function saveBackup(data: ExportData, reason: string): Promise<void> {
  if (!data.cards.length && !data.categories.length) return
  await withBackups(async (table) => {
    const last = await table.orderBy('createdAt').last()
    await table.add({
      id: crypto.randomUUID(),
      createdAt: Math.max(Date.now(), (last?.createdAt ?? 0) + 1),
      reason,
      data,
    })
    const expired = await table.orderBy('createdAt').reverse().offset(10).primaryKeys()
    await table.bulkDelete(expired)
  })
}

export function listBackups(): Promise<Backup[]> {
  return withBackups((table) => table.orderBy('createdAt').reverse().toArray())
}

export function getBackup(id: string): Promise<Backup | undefined> {
  return withBackups((table) => table.get(id))
}
