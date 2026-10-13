import { createHash, randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { ProviderError, UsageError } from '../../core/provider/errors.ts'
import { saveTokens } from '../../core/config/token-store.ts'
import type { StoredToken } from '../../core/config/types.ts'
import { openSystemBrowser } from './browser.ts'
import type { LoopbackListener, SpotifyLoginDependencies, SpotifyLoginOptions, SpotifyLoginResult } from './auth-types.ts'
import { createLoopbackListener } from './loopback.ts'
import { exchangeAuthorizationCode, fetchSpotifyIdentity, type SpotifyIdentity, type SpotifyTokenResponse } from './oauth.ts'

const REGISTERED_REDIRECT_URI = 'http://127.0.0.1/callback'
const RANDOM_BYTES_LENGTH = 32
const EMPTY_LENGTH = 0
const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const DEFAULT_TIMEOUT_MINUTES = 10
const DEFAULT_CALLBACK_TIMEOUT_MS = DEFAULT_TIMEOUT_MINUTES * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND
const DEFAULT_SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',
  'playlist-modify-public',
  'playlist-modify-private'
]

interface AuthorizationUrlOptions {
  clientId: string
  redirectUri: string
  state: string
  verifier: string
  scopes: string[]
}

interface AuthorizationContext {
  authorizationUrl: string
  redirectUri: string
  listener?: LoopbackListener
}

interface PrepareAuthorizationOptions {
  clientId: string
  mode: NonNullable<SpotifyLoginOptions['mode']>
  state: string
  verifier: string
  scopes: string[]
}

interface AuthorizationCodeOptions {
  mode: NonNullable<SpotifyLoginOptions['mode']>
  context: AuthorizationContext
  state: string
  dependencies: SpotifyLoginDependencies
  report: (message: string) => void
}

interface CompleteAuthorizationOptions {
  options: SpotifyLoginOptions
  context: AuthorizationContext
  verifier: string
  scopes: string[]
  code: string
  dependencies: SpotifyLoginDependencies
}

interface RunAuthorizationOptions extends Omit<CompleteAuthorizationOptions, 'code'> {
  state: string
}

function defaultWriteStderr (message: string): void {
  process.stderr.write(`${message}\n`)
}

function verifierValue (): string {
  return randomBytes(RANDOM_BYTES_LENGTH).toString('base64url')
}

function stateValue (): string {
  return randomBytes(RANDOM_BYTES_LENGTH).toString('hex')
}

function authorizationUrl (options: AuthorizationUrlOptions): string {
  const challenge = createHash('sha256').update(options.verifier).digest('base64url')
  const url = new URL('https://accounts.spotify.com/authorize')
  url.searchParams.set('client_id', options.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', options.state)
  url.searchParams.set('scope', options.scopes.join(' '))
  url.searchParams.set('redirect_uri', options.redirectUri)
  return url.toString()
}

async function prepareAuthorization (options: PrepareAuthorizationOptions): Promise<AuthorizationContext> {
  const { clientId, mode, state, verifier, scopes } = options
  const listener = mode === 'manual' ? undefined : await createLoopbackListener(state)
  const redirectUri = listener?.redirectUri ?? REGISTERED_REDIRECT_URI
  return {
    authorizationUrl: authorizationUrl({ clientId, redirectUri, state, verifier, scopes }),
    redirectUri,
    ...(listener === undefined ? {} : { listener })
  }
}

async function readStdinLine (): Promise<string | null> {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
  try {
    const iterator = input[Symbol.asyncIterator]()
    const result = await iterator.next()
    return result.done === true ? null : result.value
  } finally {
    input.close()
  }
}

function parseManualRedirect (line: string | null, expectedState: string): string {
  if (line === null) {
    throw new ProviderError('No redirect URL received (stdin closed)')
  }
  const redirect = parseUrl(line.trim())
  if (redirect === null) {
    throw new ProviderError('Invalid redirect URL')
  }
  if (redirect.searchParams.get('state') !== expectedState) {
    throw new ProviderError('State validation failed')
  }
  const oauthError = redirect.searchParams.get('error')
  if (oauthError !== null) {
    const safeError = /^[a-z_]{1,64}$/v.test(oauthError) ? oauthError : 'unknown'
    throw new ProviderError(`OAuth error: ${safeError}`)
  }
  const code = redirect.searchParams.get('code')
  if (code === null || code.length === EMPTY_LENGTH) {
    throw new ProviderError('Authorization redirect did not include a code')
  }
  return code
}

function parseUrl (value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

async function waitForLoopbackCode (
  listener: LoopbackListener,
  timeoutMs: number
): Promise<string> {
  const timeoutController = new AbortController()
  try {
    const timeout = delay(timeoutMs, undefined, { signal: timeoutController.signal })
      .then(() => { throw new ProviderError('OAuth redirect timeout (10 minutes)') })
    return await Promise.race([listener.waitForCode(), timeout])
  } finally {
    timeoutController.abort()
  }
}

async function authorizationCode (options: AuthorizationCodeOptions): Promise<string> {
  const { mode, context, state, dependencies, report } = options
  if (mode === 'manual') {
    report('After authorizing, paste the redirected URL here:')
    return parseManualRedirect(await (dependencies.readLine ?? readStdinLine)(), state)
  }

  if (mode === 'loopback') {
    try {
      await (dependencies.openBrowser ?? openSystemBrowser)(context.authorizationUrl)
    } catch {
      report('Warning: Could not open a browser. Open the authorization URL manually.')
    }
  }
  report('Waiting for authorization...')
  if (context.listener === undefined) {
    throw new ProviderError('Spotify authorization listener was not initialized')
  }
  return await waitForLoopbackCode(
    context.listener,
    dependencies.callbackTimeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS
  )
}

function storedToken (
  token: SpotifyTokenResponse,
  identity: SpotifyIdentity,
  scopes: string[],
  now: () => number
): StoredToken {
  const { accessToken, expiresIn, refreshToken } = token
  const { userId, displayName } = identity
  const timestamp = now()
  const stored: StoredToken = {
    accessToken,
    expiresAt: new Date(timestamp + expiresIn * MILLISECONDS_PER_SECOND).toISOString(),
    scopes: token.scopes ?? [...scopes],
    userId,
    grantedAt: new Date(timestamp).toISOString()
  }
  if (refreshToken !== undefined) {
    stored.refreshToken = refreshToken
  }
  if (displayName !== undefined) {
    stored.displayName = displayName
  }
  return stored
}

async function completeAuthorization (completion: CompleteAuthorizationOptions): Promise<SpotifyLoginResult> {
  const { options, context, verifier, scopes, code, dependencies } = completion
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const { clientId } = options
  const token = await exchangeAuthorizationCode(fetchImpl, {
    code,
    redirectUri: context.redirectUri,
    clientId: clientId.trim(),
    verifier,
    requestedScopes: scopes
  })
  const identity = await fetchSpotifyIdentity(fetchImpl, token.accessToken)
  const stored = storedToken(token, identity, scopes, dependencies.now ?? Date.now)
  const saveToken = dependencies.saveToken ?? (async (value: StoredToken) => {
    await saveTokens('spotify', value, dependencies.tokenStoreOptions)
  })
  await saveToken(stored)

  const { userId, displayName } = identity
  const result: SpotifyLoginResult = {
    userId,
    scopes: stored.scopes
  }
  if (displayName !== undefined) {
    result.displayName = displayName
  }
  const { expiresAt } = stored
  if (expiresAt !== undefined) {
    result.expiresAt = expiresAt
  }
  return result
}

async function runAuthorization (runOptions: RunAuthorizationOptions): Promise<SpotifyLoginResult> {
  const { options, context, verifier, state, scopes, dependencies } = runOptions
  const report = dependencies.writeStderr ?? defaultWriteStderr
  report('Open this URL in your browser to authorize sple:')
  report(context.authorizationUrl)
  const code = await authorizationCode({
    mode: options.mode ?? 'loopback',
    context,
    state,
    dependencies,
    report
  })
  return await completeAuthorization({ options, context, verifier, scopes, code, dependencies })
}

/** Runs Spotify Authorization Code + PKCE and persists the token only after `/v1/me` succeeds. */
export async function loginSpotify (
  options: SpotifyLoginOptions,
  dependencies: SpotifyLoginDependencies = {}
): Promise<SpotifyLoginResult> {
  if (options.clientId.trim().length === EMPTY_LENGTH) {
    throw new UsageError('Missing Spotify Client ID. Set SPLE_SPOTIFY_CLIENT_ID in your environment or .env file.')
  }

  const { clientId } = options
  const mode = options.mode ?? 'loopback'
  const scopes = options.scopes ?? DEFAULT_SCOPES
  const verifier = verifierValue()
  const state = stateValue()
  const context = await prepareAuthorization({ clientId: clientId.trim(), mode, state, verifier, scopes })
  try {
    return await runAuthorization({ options, context, verifier, state, scopes, dependencies })
  } finally {
    await context.listener?.close()
  }
}
