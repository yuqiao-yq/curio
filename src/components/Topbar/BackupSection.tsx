import { useEffect, useState } from 'react'
import { getBackup, listBackups, type Backup } from '../../repositories/BackupsDB'
import { getRepository } from '../../repositories'
import { useBookmarkStore, cancelPendingSyncPush } from '../../stores/useBookmarkStore'
import {
  scheduleBookmarksSyncPush,
  scheduleSettingsSyncPush,
  cancelPendingSettingsSave,
} from '../../stores/useBookmarkStore/scheduler'
import { confirmDialog } from '../Dialog'
import { toast } from '../../stores/useToastStore'

export function BackupSection() {
  const [backups, setBackups] = useState<Backup[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    void listBackups()
      .then(setBackups)
      .catch(() => setError('无法读取本地备份'))
  }, [])
  const restore = async (id: string) => {
    if (busy) return
    if (
      !(await confirmDialog({
        title: '恢复此版本？',
        message:
          '将恢复当时的分类、书签和设置。恢复前会自动备份当前数据；开启同步时，恢复结果也会同步。',
        danger: true,
      }))
    )
      return
    setBusy(true)
    try {
      const backup = await getBackup(id)
      if (!backup) throw new Error('备份已过期，请重新打开数据管理')
      cancelPendingSyncPush()
      cancelPendingSettingsSave()
      await getRepository().bulkImport(backup.data, 'replace')
      await useBookmarkStore.getState().init()
      scheduleBookmarksSyncPush()
      scheduleSettingsSyncPush()
      setBackups(await listBackups())
      toast.success('已恢复备份')
    } catch (err) {
      toast.error('恢复失败', err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
      <h3 className="text-sm font-medium">备份与恢复</h3>
      <p className="text-xs text-slate-500">
        保留最近 10
        次删除、导入或覆盖前的数据。仅保存在此浏览器，卸载扩展会删除；重要数据请另行导出。
      </p>
      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}
      {!backups.length && !error && <p className="text-xs text-slate-500">暂无自动备份</p>}
      <ul className="max-h-40 overflow-y-auto space-y-2">
        {backups.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-2 text-xs">
            <span>
              {b.reason} · {new Date(b.createdAt).toLocaleString()}
              <br />
              <span className="text-slate-500">
                {b.data.cards.length} 个书签 · {b.data.categories.length} 个分类
              </span>
            </span>
            <button
              type="button"
              className="text-brand disabled:opacity-50"
              disabled={busy}
              onClick={() => void restore(b.id)}
            >
              恢复
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
