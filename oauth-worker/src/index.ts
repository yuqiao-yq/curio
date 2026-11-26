import { base64url, decode64, challenge } from '../../src/services/drive/crypto'

export interface Env {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  SESSION_ENCRYPTION_KEY: string
  PUBLIC_ORIGIN: string
  ALLOWED_REDIRECT_URIS: string
}
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
type Ticket = {
  purpose: 'authorization'
  exp: number
  redirect: string
  state: string
  challenge: string
}
type Session = { purpose: 'session'; exp: number; refreshToken: string }
type Envelope = Ticket | Session
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })
class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
const reject = (message: string, status = 400): never => {
  throw new RequestError(status, message)
}
const allowed = (env: Env, redirect: string) =>
  env.ALLOWED_REDIRECT_URIS.split(',')
    .map((s) => s.trim())
    .includes(redirect)
async function key(env: Env) {
  const bytes = decode64(env.SESSION_ENCRYPTION_KEY)
  if (bytes.length !== 32) throw new Error('invalid key')
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
async function seal(env: Env, value: Envelope): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(env.GOOGLE_CLIENT_ID) },
    await key(env),
    new TextEncoder().encode(JSON.stringify(value)),
  )
  return `${base64url(iv)}.${base64url(new Uint8Array(data))}`
}
async function open(env: Env, value: string, purpose: Envelope['purpose']): Promise<Envelope> {
  try {
    if (value.length > 12_000) return reject('invalid_session', 401)
    const [iv, data, extra] = value.split('.')
    if (!iv || !data || extra) return reject('invalid_session', 401)
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: decode64(iv),
        additionalData: new TextEncoder().encode(env.GOOGLE_CLIENT_ID),
      },
      await key(env),
      decode64(data),
    )
    const result = JSON.parse(new TextDecoder().decode(plain)) as Envelope
    if (result.purpose !== purpose || result.exp < Date.now()) return reject('expired_session', 401)
    return result
  } catch {
    return reject('invalid_session', 401)
  }
}
async function googleToken(env: Env, params: Record<string, string>, fetcher: typeof fetch) {
  const response = await fetcher('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      ...params,
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    const error = (await response.json()) as { error?: string }
    return reject(
      error.error === 'invalid_grant' ? 'reauthorization_required' : 'google_token_failed',
      error.error === 'invalid_grant' ? 401 : 502,
    )
  }
  const data = (await response.json()) as {
    access_token?: string
    expires_in?: number
    refresh_token?: string
    scope?: string
  }
  if (
    !data.access_token ||
    !data.expires_in ||
    (data.scope && !data.scope.split(' ').includes(SCOPE))
  )
    return reject('missing_drive_permission', 401)
  return data
}

export async function handleRequest(
  request: Request,
  env: Env,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  let response: Response
  try {
    const url = new URL(request.url)
    if (
      !env.GOOGLE_CLIENT_ID ||
      !env.GOOGLE_CLIENT_SECRET ||
      !env.SESSION_ENCRYPTION_KEY ||
      !env.ALLOWED_REDIRECT_URIS ||
      new URL(env.PUBLIC_ORIGIN).origin !== env.PUBLIC_ORIGIN ||
      !env.PUBLIC_ORIGIN.startsWith('https://')
    )
      return json({ error: 'service_not_configured' }, 503)
    if (url.origin !== env.PUBLIC_ORIGIN) return json({ error: 'invalid_origin' }, 400)
    const callback = `${env.PUBLIC_ORIGIN}/oauth/callback`
    if (request.method === 'OPTIONS') response = new Response(null, { status: 204 })
    else if (request.method === 'GET' && url.pathname === '/health')
      response = json({ ok: true, service: 'curio-drive-oauth', version: 1 })
    else if (request.method === 'GET' && url.pathname === '/oauth/authorize') {
      const redirect = url.searchParams.get('redirect_uri') ?? ''
      const state = url.searchParams.get('state') ?? ''
      const pkce = url.searchParams.get('code_challenge') ?? ''
      if (
        !allowed(env, redirect) ||
        !/^[A-Za-z0-9_-]{43}$/.test(state) ||
        !/^[A-Za-z0-9_-]{43}$/.test(pkce)
      )
        return reject('invalid_authorization_request')
      const ticket = await seal(env, {
        purpose: 'authorization',
        exp: Date.now() + 10 * 60_000,
        redirect,
        state,
        challenge: pkce,
      })
      const target = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      target.search = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: callback,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent select_account',
        state: ticket,
        code_challenge: pkce,
        code_challenge_method: 'S256',
      }).toString()
      response = new Response(null, { status: 302, headers: { Location: target.href } })
    } else if (request.method === 'GET' && url.pathname === '/oauth/callback') {
      const ticket = url.searchParams.get('state') ?? ''
      const payload = (await open(env, ticket, 'authorization')) as Ticket
      if (!allowed(env, payload.redirect)) return reject('redirect_not_allowed')
      const target = new URL(payload.redirect)
      target.searchParams.set('state', payload.state)
      if (url.searchParams.has('error')) target.searchParams.set('error', 'authorization_denied')
      else {
        const code = url.searchParams.get('code')
        if (!code || code.length > 4096) return reject('missing_code')
        target.searchParams.set('code', code)
        target.searchParams.set('ticket', ticket)
      }
      response = new Response(null, { status: 302, headers: { Location: target.href } })
    } else if (request.method === 'POST' && url.pathname === '/oauth/token') {
      const bodyText = await request.text()
      if (bodyText.length > 20_000) return reject('request_too_large', 413)
      const body = JSON.parse(bodyText) as { ticket: string; code: string; verifier: string }
      if (
        typeof body.ticket !== 'string' ||
        typeof body.code !== 'string' ||
        typeof body.verifier !== 'string' ||
        !/^[A-Za-z0-9_-]{43,128}$/.test(body.verifier)
      )
        return reject('invalid_token_request')
      const ticket = (await open(env, body.ticket, 'authorization')) as Ticket
      if (!allowed(env, ticket.redirect) || (await challenge(body.verifier)) !== ticket.challenge)
        return reject('invalid_verifier')
      const token = await googleToken(
        env,
        {
          grant_type: 'authorization_code',
          code: body.code,
          redirect_uri: callback,
          code_verifier: body.verifier,
        },
        fetcher,
      )
      if (!token.refresh_token) return reject('offline_access_required', 401)
      const session = await seal(env, {
        purpose: 'session',
        exp: Date.now() + 180 * 86400_000,
        refreshToken: token.refresh_token,
      })
      response = json({ accessToken: token.access_token, expiresIn: token.expires_in, session })
    } else if (request.method === 'POST' && url.pathname === '/oauth/refresh') {
      const bearer = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? ''
      const session = (await open(env, bearer, 'session')) as Session
      const token = await googleToken(
        env,
        { grant_type: 'refresh_token', refresh_token: session.refreshToken },
        fetcher,
      )
      response = json({ accessToken: token.access_token, expiresIn: token.expires_in })
    } else response = json({ error: 'not_found' }, 404)
  } catch (error) {
    // Never log request URLs, Google responses, codes or tokens.
    response = json(
      { error: error instanceof RequestError ? error.message : 'authorization_service_error' },
      error instanceof RequestError ? error.status : 502,
    )
  }
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  const origin = request.headers.get('Origin') ?? ''
  // Extension origins have no ambient cookies. The refresh endpoint requires an opaque bearer.
  if (/^(chrome-extension|moz-extension):\/\/[a-zA-Z0-9-]+$/.test(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Vary', 'Origin')
    response.headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  }
  return response
}
export default { fetch: (request: Request, env: Env) => handleRequest(request, env) }
