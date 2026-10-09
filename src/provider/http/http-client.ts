// Generic, provider-agnostic HTTP client (ADR-0010 §1, §3). One instance per
// adapter/provider; never exposed via the `Provider` interface (ADR-0003 §2
// — the CLI/core never know HTTP clients exist). Retry/backoff, 401
// refresh-and-retry and rate-limit handling live here; OAuth login (§2) and
// provider-specific endpoints/error tables (§4) are adapter concerns that
// plug in via `refreshToken`/`mapError` (out of scope for issue #8).
import {
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_WAIT_MS,
  DEFAULT_PROACTIVE_REFRESH_WINDOW_MS
} from './constants.ts'
import { backoff, parseRetryAfterMs, type BackoffOptions } from './backoff.ts'
import { RefreshCoordinator } from './refresh-coordinator.ts'
import type { HttpLogEntry, HttpLogger } from './logger.ts'
import {
  AccessRestrictedError,
  AuthRequiredError,
  NotFoundError,
  ProviderError,
  RateLimitError
} from '../../core/provider/errors.ts'

const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_NOT_FOUND = 404
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR_THRESHOLD = 500
const FIRST_ATTEMPT = 0
const ATTEMPT_INCREMENT = 1
const EMPTY_LENGTH = 0

/** The minimal token shape the client reads/writes; `StoredToken` (ADR 0004) satisfies this. */
export interface HttpClientToken {
  accessToken: string
  refreshToken?: string
  expiresAt?: string
}

export interface HttpErrorMapperContext {
  method: string
  path: string
  status: number
  body: unknown
}

/** Lets an adapter plug in its own error table (ADR-0010 §4) without this module knowing about any provider. `undefined` falls back to the generic default for that status. */
export type HttpErrorMapper = (ctx: HttpErrorMapperContext) => Error | undefined

export type HttpRequestInit = Omit<RequestInit, 'method'>

export interface HttpClientOptions<Token extends HttpClientToken = HttpClientToken> {
  loadToken: () => Promise<Token | null>
  /** Persists a refreshed token (ADR-0010 §3: saved before the request is retried). Omit for a client with no refresh support. */
  saveToken?: (token: Token) => Promise<void>
  /** Performs the provider's token-refresh request and returns the new token. Omit for a client with no refresh support. */
  refreshToken?: (token: Token) => Promise<Token>
  mapError?: HttpErrorMapper
  logger?: HttpLogger
  fetchImpl?: typeof fetch
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  maxWaitMs?: number
  proactiveRefreshWindowMs?: number
}

type SendOutcome =
  | { kind: 'response', response: Response }
  | { kind: 'network-error', error: Error, code: string }

type UnauthorizedDecision<Token> =
  | { kind: 'retry', token: Token }
  | { kind: 'throw', error: Error }

type RetryDecision =
  | { kind: 'retry', waitMs: number }
  | { kind: 'throw', error: Error }

async function defaultSleep (ms: number): Promise<void> {
  // eslint-disable-next-line promise/avoid-new -- wraps the callback-style setTimeout API
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function buildHeaders (initHeaders: RequestInit['headers'], token: HttpClientToken | null): Headers {
  const headers = new Headers(initHeaders)
  if (token !== null && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token.accessToken}`)
  }
  return headers
}

function pathOf (url: string | URL): string {
  const parsed = typeof url === 'string' ? new URL(url) : url
  return `${parsed.pathname}${parsed.search}`
}

const UNKNOWN_NETWORK_ERROR_CODE = 'NETWORK_ERROR'

/** Reads `.code` off a network error, following `.cause` (undici wraps fetch failures in a `TypeError` whose `cause` carries the real `ECONNREFUSED`/`ENOTFOUND`/etc). */
function networkErrorCode (value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    if ('code' in value && typeof value.code === 'string') {
      return value.code
    }
    if ('cause' in value) {
      return networkErrorCode(value.cause)
    }
  }
  return UNKNOWN_NETWORK_ERROR_CODE
}

async function readTextOrNull (response: Response): Promise<string | null> {
  try {
    return await response.text()
  } catch {
    return null
  }
}

async function readBody (response: Response): Promise<unknown> {
  const text = await readTextOrNull(response)
  if (text === null || text.length === EMPTY_LENGTH) {
    return undefined
  }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function defaultMappedError (status: number, attempt: number): Error {
  if (status >= HTTP_SERVER_ERROR_THRESHOLD) {
    return new ProviderError(`Service unavailable (HTTP ${status}) after ${attempt} retries`)
  }
  if (status === HTTP_NOT_FOUND) {
    return new NotFoundError('other')
  }
  if (status === HTTP_FORBIDDEN) {
    return new AccessRestrictedError('other')
  }
  return new ProviderError(`HTTP request failed (HTTP ${status})`)
}

/**
 * Per-adapter HTTP client. Generic over `Token`; adapters plug in their own
 * token persistence (`loadToken`/`saveToken`), refresh request and error
 * mapping. See `./token-store-access.ts` for a ready-made `loadToken`/
 * `saveToken` pair backed by `core/config/token-store.ts`.
 */
export class HttpClient<Token extends HttpClientToken = HttpClientToken> {
  private readonly options: HttpClientOptions<Token>
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly maxRetries: number
  private readonly maxWaitMs: number
  private readonly proactiveRefreshWindowMs: number
  private readonly backoffOptions: BackoffOptions
  private readonly refreshCoordinator = new RefreshCoordinator<Token>()

  constructor (options: HttpClientOptions<Token>) {
    this.options = options
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS
    this.proactiveRefreshWindowMs = options.proactiveRefreshWindowMs ?? DEFAULT_PROACTIVE_REFRESH_WINDOW_MS
    this.backoffOptions = {
      baseDelayMs: options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
      maxDelayMs: options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
      random: options.random ?? Math.random
    }
  }

  /** Sends one logical request: proactive refresh, then send-with-retry per ADR-0010 §1. */
  async request (method: string, url: string | URL, init: HttpRequestInit = {}): Promise<Response> {
    const loaded = await this.options.loadToken()
    const token = await this.maybeProactivelyRefresh(loaded)
    return await this.sendWithRetry(method, url, init, token)
  }

  private async maybeProactivelyRefresh (token: Token | null): Promise<Token | null> {
    if (token === null || this.options.refreshToken === undefined) {
      return token
    }
    if (!this.isWithinProactiveWindow(token.expiresAt)) {
      return token
    }
    return await this.doRefresh(token)
  }

  private isWithinProactiveWindow (expiresAt: string | undefined): boolean {
    if (expiresAt === undefined) {
      return false
    }
    const expiresMs = Date.parse(expiresAt)
    if (Number.isNaN(expiresMs)) {
      return false
    }
    return expiresMs - this.now() < this.proactiveRefreshWindowMs
  }

  private async doRefresh (token: Token): Promise<Token> {
    return await this.refreshCoordinator.refresh(token, async (toRefresh) => {
      if (toRefresh.refreshToken === undefined || this.options.refreshToken === undefined) {
        throw new AuthRequiredError('token-expired')
      }
      const refreshed = await this.options.refreshToken(toRefresh)
      if (this.options.saveToken !== undefined) {
        await this.options.saveToken(refreshed)
      }
      return refreshed
    })
  }

  private async sendOnce (method: string, url: string | URL, init: HttpRequestInit, headers: Headers): Promise<SendOutcome> {
    try {
      const response = await this.fetchImpl(url, { ...init, method, headers })
      return { kind: 'response', response }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      const code = networkErrorCode(err)
      return { kind: 'network-error', error, code }
    }
  }

  private async handleUnauthorized (
    usedToken: Token | null,
    authRetried: boolean,
    method: string,
    path: string
  ): Promise<UnauthorizedDecision<Token>> {
    if (authRetried || usedToken === null) {
      return { kind: 'throw', error: new AuthRequiredError('no-token') }
    }

    const reloaded = await this.options.loadToken()
    if (reloaded !== null && reloaded.accessToken !== usedToken.accessToken) {
      return { kind: 'retry', token: reloaded }
    }
    if (this.options.refreshToken === undefined) {
      return { kind: 'throw', error: new AuthRequiredError('no-token') }
    }

    try {
      const refreshed = await this.doRefresh(usedToken)
      return { kind: 'retry', token: refreshed }
    } catch (err) {
      if (err instanceof ProviderError) {
        return { kind: 'throw', error: err }
      }
      const mapped = this.options.mapError?.({ method, path, status: HTTP_UNAUTHORIZED, body: undefined })
      return { kind: 'throw', error: mapped ?? new AuthRequiredError('no-token') }
    }
  }

  private decideRateLimit (response: Response, attempt: number): RetryDecision {
    const header = response.headers.get('retry-after')
    const parsed = parseRetryAfterMs(header, this.now)
    const waitMs = parsed ?? backoff(FIRST_ATTEMPT, this.backoffOptions)
    if (waitMs > this.maxWaitMs) {
      return { kind: 'throw', error: new RateLimitError(waitMs) }
    }
    if (attempt < this.maxRetries) {
      return { kind: 'retry', waitMs }
    }
    return { kind: 'throw', error: new RateLimitError(waitMs) }
  }

  private decideServerErrorWaitMs (response: Response, attempt: number): number {
    const parsed = parseRetryAfterMs(response.headers.get('retry-after'), this.now)
    if (parsed !== null) {
      return Math.min(parsed, this.maxWaitMs)
    }
    return backoff(attempt, this.backoffOptions)
  }

  private async mapFinalError (response: Response, method: string, path: string, attempt: number): Promise<Error> {
    const body = await readBody(response)
    const mapped = this.options.mapError?.({ method, path, status: response.status, body })
    return mapped ?? defaultMappedError(response.status, attempt)
  }

  private decideNetworkRetry (attempt: number, networkError: Error): RetryDecision {
    if (attempt >= this.maxRetries) {
      return { kind: 'throw', error: networkError }
    }
    return { kind: 'retry', waitMs: backoff(attempt, this.backoffOptions) }
  }

  private async decideGeneralRetry (response: Response, attempt: number, method: string, path: string): Promise<RetryDecision> {
    if (response.status >= HTTP_SERVER_ERROR_THRESHOLD && attempt < this.maxRetries) {
      return { kind: 'retry', waitMs: this.decideServerErrorWaitMs(response, attempt) }
    }
    const error = await this.mapFinalError(response, method, path, attempt)
    return { kind: 'throw', error }
  }

  /** Picks the retry/throw decision for a non-401 outcome (network error, 429 or other non-2xx, including 5xx). */
  private async decideRetry (outcome: SendOutcome, attempt: number, method: string, path: string): Promise<RetryDecision> {
    if (outcome.kind === 'network-error') {
      return this.decideNetworkRetry(attempt, outcome.error)
    }
    if (outcome.response.status === HTTP_TOO_MANY_REQUESTS) {
      return this.decideRateLimit(outcome.response, attempt)
    }
    return await this.decideGeneralRetry(outcome.response, attempt, method, path)
  }

  private logAttempt (entry: HttpLogEntry): void {
    this.options.logger?.attempt?.(entry)
  }

  private logRetry (entry: HttpLogEntry): void {
    this.options.logger?.retry?.(entry)
  }

  private logError (entry: HttpLogEntry & { error: unknown }): void {
    this.options.logger?.error?.(entry)
  }

  private async sendWithRetry (
    method: string,
    url: string | URL,
    init: HttpRequestInit,
    initialToken: Token | null
  ): Promise<Response> {
    const path = pathOf(url)
    let usedToken = initialToken
    let attempt = FIRST_ATTEMPT
    let authRetried = false

    while (true) {
      const headers = buildHeaders(init.headers, usedToken)
      const attemptStart = this.now()
      // eslint-disable-next-line no-await-in-loop -- one HTTP attempt must finish before deciding the next retry
      const outcome = await this.sendOnce(method, url, init, headers)
      const durationMs = this.now() - attemptStart
      const status = outcome.kind === 'network-error' ? `ERR ${outcome.code}` : outcome.response.status
      const logBase = { method, path, retryCount: attempt, status, durationMs }
      this.logAttempt(logBase)

      if (outcome.kind === 'response' && outcome.response.ok) {
        return outcome.response
      }

      if (outcome.kind === 'response' && outcome.response.status === HTTP_UNAUTHORIZED) {
        // eslint-disable-next-line no-await-in-loop -- the 401 reload/refresh must complete before retrying
        const decision = await this.handleUnauthorized(usedToken, authRetried, method, path)
        if (decision.kind === 'throw') {
          this.logError({ ...logBase, error: decision.error })
          throw decision.error
        }
        const { token } = decision
        usedToken = token
        authRetried = true
        this.logRetry(logBase)
        continue
      }

      // eslint-disable-next-line no-await-in-loop -- this attempt's retry/throw decision must be made before sleeping
      const retryDecision = await this.decideRetry(outcome, attempt, method, path)
      if (retryDecision.kind === 'throw') {
        this.logError({ ...logBase, error: retryDecision.error })
        throw retryDecision.error
      }
      this.logRetry(logBase)
      // eslint-disable-next-line no-await-in-loop -- backoff/Retry-After sleep must happen before the next attempt
      await this.sleep(retryDecision.waitMs)
      attempt += ATTEMPT_INCREMENT
    }
  }
}
