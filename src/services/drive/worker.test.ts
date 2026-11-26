import { webcrypto } from 'node:crypto'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { handleRequest, type Env } from '../../../oauth-worker/src/index'
import { challenge, randomString } from './crypto'

const env: Env = {
  PUBLIC_ORIGIN: 'https://auth.example.com',
  GOOGLE_CLIENT_ID: 'public.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'server-only-secret',
  SESSION_ENCRYPTION_KEY: 'A'.repeat(43),
  ALLOWED_REDIRECT_URIS: 'https://abc.chromiumapp.org/,https://firefox.extensions.allizom.org/',
}
const scope = 'https://www.googleapis.com/auth/drive.appdata'
beforeEach(() => vi.stubGlobal('crypto', webcrypto))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
async function authorize(redirect = 'https://abc.chromiumapp.org/') {
  const verifier = randomString(),
    state = randomString()
  const params = new URLSearchParams({
    redirect_uri: redirect,
    state,
    code_challenge: await challenge(verifier),
  })
  const start = await handleRequest(
    new Request(`${env.PUBLIC_ORIGIN}/oauth/authorize?${params}`),
    env,
  )
  return { start, verifier, state }
}
async function callback() {
  const { start, verifier, state } = await authorize()
  const google = new URL(start.headers.get('Location')!)
  const ticket = google.searchParams.get('state')!
  const result = await handleRequest(
    new Request(
      `${env.PUBLIC_ORIGIN}/oauth/callback?${new URLSearchParams({ state: ticket, code: 'google-code' })}`,
    ),
    env,
  )
  return { result, verifier, state, ticket, google }
}
it('uses the same offline appdata flow for Chrome/Edge and Firefox, rejecting unlisted callbacks', async () => {
  expect((await authorize()).start.status).toBe(302)
  expect((await authorize('https://firefox.extensions.allizom.org/')).start.status).toBe(302)
  expect((await authorize('https://attacker.example/')).start.status).toBe(400)
  const { google } = await callback()
  expect(google.searchParams.get('scope')).toBe(scope)
  expect(google.searchParams.get('access_type')).toBe('offline')
  expect(google.searchParams.get('code_challenge_method')).toBe('S256')
  expect(google.searchParams.get('redirect_uri')).toBe(`${env.PUBLIC_ORIGIN}/oauth/callback`)
  expect(google.href).not.toContain(env.GOOGLE_CLIENT_SECRET)
})
it('requires PKCE and keeps raw refresh tokens and the client secret out of the browser response', async () => {
  const { result, verifier, state, ticket } = await callback()
  const redirect = new URL(result.headers.get('Location')!)
  expect(redirect.searchParams.get('state')).toBe(state)
  expect(redirect.searchParams.has('access_token')).toBe(false)
  const google = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          access_token: 'access',
          expires_in: 3600,
          refresh_token: 'raw-refresh',
          scope,
        }),
      ),
  )
  const exchange = (v: string) =>
    handleRequest(
      new Request(`${env.PUBLIC_ORIGIN}/oauth/token`, {
        method: 'POST',
        body: JSON.stringify({ ticket, code: 'google-code', verifier: v }),
      }),
      env,
      google,
    )
  expect((await exchange(randomString())).status).toBe(400)
  expect(google).not.toHaveBeenCalled()
  const response = await exchange(verifier)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  const text = await response.text()
  expect(text).not.toMatch(/raw-refresh|server-only-secret/)
  const session = JSON.parse(text).session
  const refresh = await handleRequest(
    new Request(`${env.PUBLIC_ORIGIN}/oauth/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session}` },
    }),
    env,
    google,
  )
  expect(refresh.status).toBe(200)
  expect(google.mock.calls).toHaveLength(2)
  const noToken = await handleRequest(
    new Request(`${env.PUBLIC_ORIGIN}/oauth/refresh`, { method: 'POST' }),
    env,
    google,
  )
  expect(noToken.status).toBe(401)
})
it('rejects tampered and expired authorization tickets before contacting Google', async () => {
  const { ticket } = await callback()
  const request = (value: string) =>
    new Request(`${env.PUBLIC_ORIGIN}/oauth/callback?state=${encodeURIComponent(value)}&code=code`)
  expect(
    (await handleRequest(request(`${ticket.slice(0, 5)}X${ticket.slice(6)}`), env)).status,
  ).toBe(401)
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000)
  expect((await handleRequest(request(ticket), env)).status).toBe(401)
  vi.restoreAllMocks()
})
it('reports revoked refresh grants without leaking provider responses', async () => {
  const { ticket, verifier } = await callback()
  const token = await handleRequest(
    new Request(`${env.PUBLIC_ORIGIN}/oauth/token`, {
      method: 'POST',
      body: JSON.stringify({ ticket, verifier, code: 'one-time' }),
    }),
    env,
    async () =>
      new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'private detail' }),
        { status: 400 },
      ),
  )
  expect(token.status).toBe(401)
  expect(await token.json()).toEqual({ error: 'reauthorization_required' })
})
