import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { browser } from 'wxt/browser'
import { accessToken, authorize, brokerOrigin, forgetToken } from './auth'
import { challenge } from './crypto'

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  forgetToken()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it.each(['chrome', 'edge', 'firefox'])(
  'uses portable identity callbacks and PKCE for %s',
  async (browserName) => {
    const callback =
      browserName === 'firefox'
        ? 'https://fixed-id.extensions.allizom.org/'
        : `https://${browserName}-id.chromiumapp.org/`
    vi.mocked(browser.identity.getRedirectURL).mockReturnValue(callback)
    let initial: URL
    vi.mocked(browser.identity.launchWebAuthFlow).mockImplementation(async (options) => {
      initial = new URL(options.url)
      expect(initial.searchParams.get('redirect_uri')).toBe(callback)
      return `${callback}?${new URLSearchParams({ state: initial.searchParams.get('state')!, code: 'code', ticket: 'ticket' })}`
    })
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/oauth/token')) {
        const body = JSON.parse(init!.body as string)
        expect(await challenge(body.verifier)).toBe(initial!.searchParams.get('code_challenge'))
        expect(body).not.toHaveProperty('client_secret')
        return new Response(
          JSON.stringify({
            accessToken: 'short-access',
            expiresIn: 3600,
            session: 'encrypted-envelope',
          }),
        )
      }
      expect(String(url)).toContain('drive/v3/about')
      return new Response(
        JSON.stringify({ user: { permissionId: 'account', emailAddress: 'me@example.com' } }),
      )
    })
    vi.stubGlobal('fetch', fetcher)
    const auth = await authorize('https://auth.example.com')
    expect(auth.account).toBe('account')
    expect(await accessToken(auth)).toBe('short-access')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(await browser.storage.local.get(null)).toEqual({}) // caller persists only after successful account validation
  },
)
it('rejects callback origin/state mismatch without exchanging credentials', async () => {
  vi.mocked(browser.identity.getRedirectURL).mockReturnValue('https://test.chromiumapp.org/')
  vi.mocked(browser.identity.launchWebAuthFlow).mockImplementation(
    async () => 'https://evil.example/?state=wrong&code=code',
  )
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  await expect(authorize('https://auth.example.com')).rejects.toThrow('回调验证失败')
  expect(fetcher).not.toHaveBeenCalled()
})
it('refreshes with the opaque bearer, never persisting access tokens; handles revocation', async () => {
  const auth = {
    broker: 'https://auth.example.com',
    account: 'a',
    label: 'me',
    session: 'opaque-envelope',
  }
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(init?.headers).toEqual({ Authorization: 'Bearer opaque-envelope' })
    return new Response(JSON.stringify({ accessToken: 'fresh-access', expiresIn: 3600 }))
  })
  vi.stubGlobal('fetch', fetcher)
  expect(await accessToken(auth)).toBe('fresh-access')
  expect(await browser.storage.local.get(null)).toEqual({})
  fetcher.mockResolvedValue(new Response('{}', { status: 401 }))
  await expect(accessToken(auth, true)).rejects.toThrow('授权已过期或被撤销')
})
it('accepts only HTTPS service origins without credentials, paths or query parameters', () => {
  expect(brokerOrigin('https://auth.example.com/')).toBe('https://auth.example.com')
  for (const value of [
    'http://auth.example.com',
    'https://user:secret@auth.example.com',
    'https://auth.example.com/path',
    'https://auth.example.com?token=secret',
  ])
    expect(() => brokerOrigin(value)).toThrow()
})
