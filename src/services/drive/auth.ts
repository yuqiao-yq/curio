import { browser } from 'wxt/browser'
import { withStorageLock } from '../storageLock'
import { DRIVE_AUTH_KEY } from './model'
import { challenge, randomString } from './crypto'

export interface DriveAuth {
  broker: string
  session: string
  account: string
  label: string
}
let cached: { session: string; token: string; until: number } | undefined
export function brokerOrigin(value: string): string {
  const url = new URL(value.trim())
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error(
      '授权服务需使用 HTTPS 根地址，例如 https://curio-drive-oauth.example.workers.dev',
    )
  return url.origin
}
export const getCallbackURL = () => browser.identity.getRedirectURL()
export async function getAuth(): Promise<DriveAuth | undefined> {
  return (await browser.storage.local.get(DRIVE_AUTH_KEY))[DRIVE_AUTH_KEY] as DriveAuth | undefined
}
async function tokenResponse(
  response: Response,
): Promise<{ accessToken: string; expiresIn: number; session?: string }> {
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Google 授权已过期或被撤销，请重新连接。'
        : '授权服务暂时不可用，请检查配置和网络后重试。',
    )
  const data = await response.json()
  if (
    typeof data.accessToken !== 'string' ||
    typeof data.expiresIn !== 'number' ||
    data.expiresIn <= 0
  )
    throw new Error('授权服务返回了无效凭据。')
  return data
}
export async function authorize(broker: string): Promise<DriveAuth> {
  const verifier = randomString(),
    state = randomString()
  const callback = getCallbackURL()
  const url = new URL(`${broker}/oauth/authorize`)
  url.search = new URLSearchParams({
    redirect_uri: callback,
    state,
    code_challenge: await challenge(verifier),
  }).toString()
  const result = await browser.identity.launchWebAuthFlow({ url: url.href, interactive: true })
  if (!result) throw new Error('登录已取消。')
  const redirected = new URL(result)
  const expected = new URL(callback)
  if (
    redirected.origin !== expected.origin ||
    redirected.pathname !== expected.pathname ||
    redirected.searchParams.get('state') !== state
  )
    throw new Error('登录回调验证失败，请重新连接。')
  if (redirected.searchParams.has('error')) throw new Error('未授予 Google Drive 权限。')
  const code = redirected.searchParams.get('code'),
    ticket = redirected.searchParams.get('ticket')
  if (!code || !ticket) throw new Error('登录未返回授权码。')
  const tokens = await tokenResponse(
    await fetch(`${broker}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, ticket, verifier }),
      signal: AbortSignal.timeout(30_000),
      credentials: 'omit',
      redirect: 'error',
    }),
  )
  if (!tokens.session) throw new Error('授权服务未返回续期凭据。')
  const response = await fetch(
    'https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress,displayName)',
    {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
      signal: AbortSignal.timeout(30_000),
      credentials: 'omit',
      redirect: 'error',
    },
  )
  if (!response.ok) throw new Error('无法读取 Drive 账号。请确认 Google Cloud 已启用 Drive API。')
  const { user } = await response.json()
  if (!user?.permissionId) throw new Error('无法确认 Drive 账号身份。')
  const auth = {
    broker,
    session: tokens.session,
    account: user.permissionId as string,
    label: (user.emailAddress || user.displayName || 'Google Drive') as string,
  }
  cached = {
    session: auth.session,
    token: tokens.accessToken,
    until: Date.now() + Math.min(tokens.expiresIn, 3600) * 1000 - 60_000,
  }
  return auth
}
export async function accessToken(auth: DriveAuth, force = false): Promise<string> {
  return withStorageLock('drive-auth', async () => {
    if (!force && cached?.session === auth.session && cached.until > Date.now()) return cached.token
    const tokens = await tokenResponse(
      await fetch(`${auth.broker}/oauth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${auth.session}` },
        signal: AbortSignal.timeout(30_000),
        credentials: 'omit',
        redirect: 'error',
      }),
    )
    cached = {
      session: auth.session,
      token: tokens.accessToken,
      until: Date.now() + Math.min(tokens.expiresIn, 3600) * 1000 - 60_000,
    }
    return tokens.accessToken
  })
}
export function forgetToken() {
  cached = undefined
}
