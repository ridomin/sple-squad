import { AccessRestrictedError, AuthRequiredError, NotFoundError, ProviderError, RateLimitError } from '../../core/provider/errors.ts'
import { parseRetryAfterMs } from '../http/backoff.ts'

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token'
const SPOTIFY_API_URL = 'https://api.spotify.com/v1'
const SPOTIFY_PREMIUM_URL = 'https://www.spotify.com/premium/'
const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_NOT_FOUND = 404
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR = 500
const EMPTY_LENGTH = 0
const ZERO_SECONDS = 0

export interface SpotifyTokenResponse {
  accessToken: string
  refreshToken?: string
  expiresIn: number
  scopes?: string[]
}

export interface SpotifyIdentity {
  userId: string
  displayName?: string
}

export interface ExchangeAuthorizationCodeOptions {
  code: string
  redirectUri: string
  clientId: string
  verifier: string
  requestedScopes: string[]
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function safeOAuthErrorCode (value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z_]{1,64}$/v.test(value) ? value : undefined
}

async function request (fetchImpl: typeof fetch, url: string, init: RequestInit, failureMessage: string): Promise<Response> {
  try {
    return await fetchImpl(url, init)
  } catch {
    throw new ProviderError(failureMessage)
  }
}

async function parseResponseJson (response: Response, method: string, path: string): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new ProviderError(`Invalid JSON in response to ${method} ${path}`)
  }
}

function hasTokenFields (
  body: Record<string, unknown>
): body is Record<string, unknown> & { access_token: string, expires_in: number } {
  const { access_token: accessToken, expires_in: expiresIn } = body
  if (typeof accessToken !== 'string' || accessToken.length === EMPTY_LENGTH ||
      typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn < ZERO_SECONDS) {
    return false
  }
  return true
}

function parseTokenResponse (body: unknown): SpotifyTokenResponse {
  if (!isRecord(body) || !hasTokenFields(body)) {
    throw new ProviderError('Spotify token response is missing required fields')
  }
  const { access_token: accessToken, expires_in: expiresIn, refresh_token: refreshToken, scope } = body

  const token: SpotifyTokenResponse = { accessToken, expiresIn }
  if (typeof refreshToken === 'string' && refreshToken.length > EMPTY_LENGTH) {
    token.refreshToken = refreshToken
  }
  if (typeof scope === 'string') {
    token.scopes = scope.trim().length === EMPTY_LENGTH ? [] : scope.trim().split(/\s+/v)
  }
  return token
}

async function tokenEndpointError (response: Response): Promise<Error> {
  const body = await readOptionalResponseJson(response)
  const code = isRecord(body) ? safeOAuthErrorCode(body.error) : undefined
  if (code === 'invalid_grant') {
    return new ProviderError('Spotify rejected the authorization code; run "sple auth login" again')
  }
  if (response.status === HTTP_UNAUTHORIZED || code === 'invalid_client' || code === 'unauthorized_client') {
    return new ProviderError(
      'Spotify rejected the client configuration. Check SPLE_SPOTIFY_CLIENT_ID and register the redirect URI http://127.0.0.1/callback in your Spotify app.'
    )
  }
  if (response.status === HTTP_TOO_MANY_REQUESTS) {
    return new RateLimitError(parseRetryAfterMs(response.headers.get('retry-after')) ?? undefined)
  }
  if (response.status >= HTTP_SERVER_ERROR) {
    return new ProviderError('Spotify token endpoint unavailable')
  }
  return new ProviderError(`Spotify token request failed (HTTP ${String(response.status)}${code === undefined ? '' : `, ${code}`})`)
}

async function readOptionalResponseJson (response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/** Exchanges one authorization code with PKCE; Spotify does not use a client secret. */
export async function exchangeAuthorizationCode (
  fetchImpl: typeof fetch,
  options: ExchangeAuthorizationCodeOptions
): Promise<SpotifyTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: options.code,
    redirect_uri: options.redirectUri,
    client_id: options.clientId,
    code_verifier: options.verifier
  })
  const response = await request(fetchImpl, SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  }, 'Spotify token endpoint request failed')
  if (!response.ok) {
    throw await tokenEndpointError(response)
  }
  const parsed = parseTokenResponse(await parseResponseJson(response, 'POST', '/api/token'))
  parsed.scopes ??= [...options.requestedScopes]
  return parsed
}

function premiumRequiredError (): AccessRestrictedError {
  return new AccessRestrictedError(
    'premium-required',
    `Spotify Premium is required for Development Mode apps. Subscribe to Premium and retry login: ${SPOTIFY_PREMIUM_URL}`
  )
}

function mapSpotifyApiError (status: number, body: unknown, retryAfterMs?: number): Error {
  if (status === HTTP_UNAUTHORIZED) {
    return new AuthRequiredError('token-expired')
  }
  if (status === HTTP_FORBIDDEN) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : undefined
    const message = error?.message
    return typeof message === 'string' && /premium/iv.test(message)
      ? premiumRequiredError()
      : new AccessRestrictedError('other')
  }
  if (status === HTTP_NOT_FOUND) {
    return new NotFoundError('other')
  }
  if (status === HTTP_TOO_MANY_REQUESTS) {
    return new RateLimitError(retryAfterMs)
  }
  return new ProviderError(`Spotify API request failed (HTTP ${String(status)})`)
}

/** Gets the Spotify identity after exchange, before the caller persists credentials. */
export async function fetchSpotifyIdentity (fetchImpl: typeof fetch, accessToken: string): Promise<SpotifyIdentity> {
  const response = await request(fetchImpl, `${SPOTIFY_API_URL}/me`, {
    headers: { authorization: `Bearer ${accessToken}` }
  }, 'Spotify API request failed (network error)')
  const body = await parseResponseJson(response, 'GET', '/v1/me')
  if (!response.ok) {
    throw mapSpotifyApiError(
      response.status,
      body,
      parseRetryAfterMs(response.headers.get('retry-after')) ?? undefined
    )
  }
  if (!isRecord(body) || typeof body.id !== 'string' || body.id.length === EMPTY_LENGTH) {
    throw new ProviderError('Spotify identity response is missing the id field')
  }
  const { id, display_name: displayName } = body
  const identity: SpotifyIdentity = { userId: id }
  if (typeof displayName === 'string') {
    identity.displayName = displayName
  }
  return identity
}
