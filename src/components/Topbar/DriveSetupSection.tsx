import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { toast } from '../../stores/useToastStore'
import { flushSettingsSave } from '../../stores/useBookmarkStore/scheduler'
import { getAuth, getCallbackURL, type DriveAuth } from '../../services/drive/auth'
import {
  DRIVE_AUTH_KEY,
  DRIVE_STATE_KEY,
  DRIVE_STATUS_KEY,
  type DriveState,
} from '../../services/drive/model'
import {
  confirmDrive,
  connectDrive,
  disconnectDrive,
  getDriveState,
  pauseDrive,
  previewDrive,
  syncDrive,
  type DrivePreview,
  type DriveStatus,
} from '../../services/drive/sync'

const BUTTON = 'text-xs text-brand disabled:opacity-50 disabled:cursor-not-allowed'
export function DriveSetupSection() {
  const [auth, setAuth] = useState<DriveAuth>()
  const [state, setState] = useState<DriveState>()
  const [status, setStatus] = useState<DriveStatus>()
  const [address, setAddress] = useState(import.meta.env.VITE_GOOGLE_DRIVE_AUTH_URL ?? '')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<DrivePreview>()
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    const refresh = async () => {
      try {
        const [a, s, meta] = await Promise.all([
          getAuth(),
          getDriveState(),
          browser.storage.local.get(DRIVE_STATUS_KEY),
        ])
        if (!alive) return
        setAuth(a)
        setState(s)
        setStatus(meta[DRIVE_STATUS_KEY] as DriveStatus | undefined)
        if (a) setAddress(a.broker)
      } catch {
        if (alive) setError('读取 Drive 状态失败，请重新打开数据管理。')
      }
    }
    void refresh()
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (
        area === 'local' &&
        [DRIVE_AUTH_KEY, DRIVE_STATE_KEY, DRIVE_STATUS_KEY].some((k) => k in changes)
      )
        void refresh()
    }
    browser.storage.onChanged.addListener(listener)
    return () => {
      alive = false
      browser.storage.onChanged.removeListener(listener)
    }
  }, [])
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请重试。')
    } finally {
      setBusy(false)
    }
  }
  const showPreview = async () => {
    await flushSettingsSave()
    setPreview(await previewDrive())
  }
  const connect = () =>
    run(async () => {
      // Request permissions before the first await to retain the user's gesture in Firefox.
      await connectDrive(address)
      setPreview(undefined)
      await showPreview()
    })
  const disabled = busy
  return (
    <section
      aria-label="Google Drive 同步"
      className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-3"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">Google Drive</h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {!auth
            ? '未连接'
            : state?.enabled
              ? status?.phase === 'syncing'
                ? '正在同步…'
                : '已开启同步'
              : '同步已暂停'}
        </span>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        在 Chrome、Edge 和 Firefox 之间同步书签、分类和样式偏好。数据保存在你自己的 Drive
        应用专属目录，不受浏览器同步的 100 KB 配额限制。
      </p>
      {auth ? (
        <p className="text-xs break-all">已连接：{auth.label}</p>
      ) : (
        <label className="block text-xs">
          授权服务地址
          <input
            aria-label="Google Drive 授权服务地址"
            className="input w-full mt-1"
            type="url"
            value={address}
            disabled={busy}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="https://curio-drive-oauth.example.workers.dev"
            autoComplete="off"
          />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {!auth ? (
          <button
            type="button"
            className={BUTTON}
            disabled={disabled || !address.trim()}
            onClick={() => void connect()}
          >
            连接 Google Drive
          </button>
        ) : (
          <>
            {state?.enabled ? (
              <>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={disabled}
                  onClick={() =>
                    void run(async () => {
                      await flushSettingsSave()
                      await syncDrive()
                    })
                  }
                >
                  立即同步
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={busy}
                  onClick={() => void run(pauseDrive)}
                >
                  暂停同步
                </button>
              </>
            ) : (
              <button
                type="button"
                className={BUTTON}
                disabled={disabled}
                onClick={() => void run(showPreview)}
              >
                预览并开启同步
              </button>
            )}
            <button
              type="button"
              className={BUTTON}
              disabled={disabled}
              onClick={() => void connect()}
            >
              重新登录 / 切换账号
            </button>
            <button
              type="button"
              className={BUTTON}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await disconnectDrive()
                  setPreview(undefined)
                })
              }
            >
              断开连接
            </button>
          </>
        )}
      </div>
      {auth && (
        <p className="text-xs text-slate-500 dark:text-slate-400" role="status">
          {state?.dirty ? '有本地更改等待同步。' : ''}
          {status?.lastSync
            ? `上次同步：${new Date(status.lastSync).toLocaleString()}。`
            : '尚未完成同步。'}
          {state?.enabled
            ? '更改后自动上传，每 2 分钟检查云端更新；离线更改会在恢复联网后重试。'
            : '预览确认后才会上传或合并数据。'}
        </p>
      )}
      {preview && (
        <div
          className="rounded-md bg-slate-100 dark:bg-slate-800 p-3 space-y-2 text-xs"
          aria-label="Drive 合并预览"
        >
          <p className="font-medium">开启同步前确认合并</p>
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>位置</th>
                <th>分类</th>
                <th>书签</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['本机', preview.local],
                  ['云端', preview.cloud],
                  ['合并后', preview.result],
                ] as const
              ).map(([label, counts]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{counts.categories}</td>
                  <td>{counts.cards}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            云端将更新或删除 {preview.changed}{' '}
            个本地条目或偏好。同一条目的并发编辑按版本确定结果；合并前会保存本地备份。
          </p>
          <p>
            确认后暂停浏览器账号同步，并自动同步到当前 Google
            账号。切换账号时，本机保留的数据也会加入本次合并。
          </p>
          <div className="flex gap-4">
            <button
              type="button"
              className={BUTTON}
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  await flushSettingsSave()
                  await confirmDrive(preview)
                  setPreview(undefined)
                  toast.success('Google Drive 同步已开启')
                })
              }
            >
              确认合并并开启
            </button>
            <button
              type="button"
              className={BUTTON}
              disabled={busy}
              onClick={() => setPreview(undefined)}
            >
              取消
            </button>
            <button
              type="button"
              className={BUTTON}
              disabled={disabled}
              onClick={() => void run(showPreview)}
            >
              刷新预览
            </button>
          </div>
        </div>
      )}
      {(error || status?.error) && (
        <p className="text-xs text-red-500" role="alert">
          {error || status?.error}
        </p>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        AI 密钥、浏览记录、壁纸和本机书签关联不会上传。暂停或断开会保留本机与云端数据。
      </p>
      <details className="text-xs space-y-2">
        <summary className="cursor-pointer text-brand">部署与授权配置</summary>
        <p>
          使用 Cloudflare Worker 和 Google Cloud 的 Web 应用 OAuth 客户端。客户端密钥仅配置在 Worker
          Secrets 中。
        </p>
        <p>将此浏览器的回调地址加入 Worker 白名单：</p>
        <code className="block break-all select-all">{getCallbackURL()}</code>
        <p>在各浏览器使用同一授权服务和 Google 账号。仅填写你自己部署或信任的服务地址。</p>
        <a
          className="text-brand"
          target="_blank"
          rel="noreferrer"
          href="https://github.com/yuqiao-yq/curio/blob/main/docs/GOOGLE_DRIVE_SETUP.md"
        >
          查看部署文档
        </a>
      </details>
    </section>
  )
}
