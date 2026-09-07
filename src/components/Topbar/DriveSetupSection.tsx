import { useState } from 'react'
import { browser } from 'wxt/browser'
import { toast } from '../../stores/useToastStore'

/** 开发者配置入口；没有 OAuth 客户端时不把规划中的同步显示成已连接。 */
export function DriveSetupSection() {
  const manifest = browser.runtime.getManifest()
  const configuredId = manifest.oauth2?.client_id ?? ''
  const [clientId, setClientId] = useState(configuredId)
  const valid = /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(clientId.trim())
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`GOOGLE_DRIVE_CLIENT_ID=${clientId.trim()} pnpm build`)
      toast.success('已复制构建命令', '在项目目录执行后，重新加载扩展使配置生效')
    } catch {
      toast.error('复制失败', '请手动复制客户端 ID')
    }
  }
  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
      <h3 className="text-sm font-medium">Google Drive 同步准备</h3>
      <p className="text-xs text-slate-500">
        {configuredId
          ? '已配置客户端，授权与跨设备同步尚未开放。'
          : '尚未配置 Google OAuth 客户端。'}{' '}
        数据将存放在你自己的 Drive 应用专用目录。
      </p>
      <details className="text-xs space-y-2">
        <summary className="cursor-pointer text-brand">开发者配置</summary>
        <label className="block">
          公开客户端 ID
          <input
            aria-label="Google Drive 客户端 ID"
            className="input w-full mt-1"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="…apps.googleusercontent.com"
            autoComplete="off"
          />
        </label>
        <p className="text-slate-500">
          使用 Google Cloud 的 Chrome 扩展客户端；扩展 ID：
          <code className="break-all">{browser.runtime.id}</code>。只需要客户端
          ID，请勿输入客户端密钥。
        </p>
        <button
          type="button"
          className="text-brand disabled:opacity-50"
          disabled={!valid}
          onClick={() => void copy()}
        >
          复制配置构建命令
        </button>
        <p className="text-slate-500">
          完整步骤见项目文档 docs/GOOGLE_DRIVE_SETUP.md。Firefox 跨浏览器授权方案仍待联调。
        </p>
      </details>
    </section>
  )
}
