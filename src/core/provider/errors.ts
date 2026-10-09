// Closed error-type set for provider adapters (ADR-0003 §4). Adapters catch
// provider SDK errors and wrap them in exactly one of these types before
// throwing; the CLI maps each type to an exit code and message in one place
// (ADR 0007 §4). Any other error (including a plain runtime error) exits 1.

const EXIT_GENERAL_ERROR = 1
const EXIT_USAGE_ERROR = 2
const EXIT_AUTH_REQUIRED = 3
const EXIT_NOT_FOUND = 4
const EXIT_QUOTA_OR_RATE_LIMIT = 5

/** Base of every provider error. Exit code 1: unexpected status, invalid JSON from the provider, etc. */
export class ProviderError extends Error {
  readonly exitCode: number = EXIT_GENERAL_ERROR
  constructor (message: string) {
    super(message)
    this.name = 'ProviderError'
  }
}

/** Why a call needs (re-)authentication (ADR-0003 §4, incl. missing scope, FR-AUTH-5). */
export type AuthRequiredReason = 'no-token' | 'token-expired' | 'missing-scope' | 'revoked'

/** No token, an expired token, a missing scope, or a revoked grant. Exit code 3. */
export class AuthRequiredError extends ProviderError {
  override readonly exitCode = EXIT_AUTH_REQUIRED
  readonly reason: AuthRequiredReason
  /** Set when `reason === 'missing-scope'`: the first missing scope, in the provider's scope-table order. */
  readonly scope?: string

  constructor (reason: AuthRequiredReason, scope?: string, message?: string) {
    super(message ?? AuthRequiredError.defaultMessage(reason, scope))
    this.name = 'AuthRequiredError'
    this.reason = reason
    if (scope !== undefined) {
      this.scope = scope
    }
  }

  private static defaultMessage (reason: AuthRequiredReason, scope?: string): string {
    if (reason === 'missing-scope') {
      return `Missing required scope: ${scope ?? '(unknown)'}`
    }
    return `Authentication required: ${reason}`
  }
}

/** The kind of resource that could not be found (ADR-0003 §4). */
export type NotFoundResourceType = 'playlist' | 'track' | 'user' | 'other'

/** Unknown ID, or a name with no match. Exit code 4. */
export class NotFoundError extends ProviderError {
  override readonly exitCode = EXIT_NOT_FOUND
  readonly resourceType: NotFoundResourceType

  constructor (resourceType: NotFoundResourceType, message?: string) {
    super(message ?? `${resourceType} not found`)
    this.name = 'NotFoundError'
    this.resourceType = resourceType
  }
}

/** A documented daily quota bucket is exhausted (e.g. YouTube `quotaExceeded`). Exit code 5. */
export class QuotaExhaustedError extends ProviderError {
  override readonly exitCode = EXIT_QUOTA_OR_RATE_LIMIT
  /** `QuotaBucket.id` that was exhausted. */
  readonly bucket: string
  /** ISO 8601 timestamp of the next reset, when known. */
  readonly resetAt?: string

  constructor (bucket: string, resetAt?: string, message?: string) {
    super(message ?? `Quota exhausted for bucket '${bucket}'`)
    this.name = 'QuotaExhaustedError'
    this.bucket = bucket
    if (resetAt !== undefined) {
      this.resetAt = resetAt
    }
  }
}

/** A 429 whose `Retry-After` exceeded the maximum wait, after retries (ADR 0010). Exit code 5. */
export class RateLimitError extends ProviderError {
  override readonly exitCode = EXIT_QUOTA_OR_RATE_LIMIT
  readonly retryAfterMs?: number

  constructor (retryAfterMs?: number, message?: string) {
    super(message ?? 'Rate limited')
    this.name = 'RateLimitError'
    if (retryAfterMs !== undefined) {
      this.retryAfterMs = retryAfterMs
    }
  }
}

/** Why access to a resource is restricted (ADR-0003 §4). */
export type AccessRestrictedReason = 'not-owned' | 'premium-required' | 'region-restricted' | 'other'

/** E.g. a Spotify non-owned playlist (FR-PL-2). Exit code 1. */
export class AccessRestrictedError extends ProviderError {
  override readonly exitCode = EXIT_GENERAL_ERROR
  readonly reason: AccessRestrictedReason

  constructor (reason: AccessRestrictedReason, message?: string) {
    super(message ?? `Access restricted: ${reason}`)
    this.name = 'AccessRestrictedError'
    this.reason = reason
  }
}

/** A command- or provider-level usage error, e.g. `--offset` on a `cursor-forward` provider, or an ambiguous playlist name. Exit code 2. */
export class UsageError extends ProviderError {
  override readonly exitCode = EXIT_USAGE_ERROR

  constructor (message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

/** Maps a provider error instance to its CLI exit code. Any other error (including a plain runtime error) exits 1 (ADR-0003 §4). */
export function exitCodeForError (error: unknown): number {
  if (error instanceof ProviderError) {
    return error.exitCode
  }
  return EXIT_GENERAL_ERROR
}
