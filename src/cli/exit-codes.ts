import {
  AccessRestrictedError,
  AuthRequiredError,
  NotFoundError,
  ProviderError,
  QuotaExhaustedError,
  RateLimitError,
  UsageError as ProviderUsageError
} from '../core/provider/errors.ts'
import { UsageError as ConfigUsageError } from '../core/config/config.ts'

export const EXIT_CODES = {
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers -- Codes are the public CLI contract.
  success: 0,
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers -- Codes are the public CLI contract.
  error: 1,
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers -- Codes are the public CLI contract.
  usage: 2,
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers -- Codes are the public CLI contract.
  authRequired: 3,
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers -- Codes are the public CLI contract.
  notFound: 4,
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers -- Codes are the public CLI contract.
  rateLimit: 5
} as const

const VALID_EXIT_CODES: readonly number[] = Object.values(EXIT_CODES)
const MILLISECONDS_PER_SECOND = 1000
const EMPTY_FAILURE_COUNT = 0
const PARTIAL_FAILURE_PRIORITY = [
  EXIT_CODES.authRequired,
  EXIT_CODES.rateLimit,
  EXIT_CODES.notFound,
  EXIT_CODES.error
]

export class PartialFailureError extends Error {
  readonly exitCode: number

  constructor (message: string, failures: unknown[]) {
    super(message)
    this.name = 'PartialFailure'
    this.exitCode = getPartialFailureExitCode(failures)
  }
}

export interface ErrorOutput {
  error: {
    type: string
    message: string
    exitCode: number
  }
}

export function getExitCode (error: unknown): number {
  if (error instanceof ProviderError) return error.exitCode
  if (error instanceof ConfigUsageError || error instanceof ProviderUsageError) {
    return EXIT_CODES.usage
  }
  if (error instanceof Error && 'exitCode' in error) {
    const { exitCode } = error
    if (typeof exitCode === 'number' && VALID_EXIT_CODES.includes(exitCode)) return exitCode
  }
  return EXIT_CODES.error
}

export function formatErrorMessage (error: unknown): string {
  if (error instanceof AuthRequiredError) return formatAuthError(error)
  if (error instanceof NotFoundError) {
    return `${error.resourceType} not found: ${error.message}`
  }
  if (error instanceof QuotaExhaustedError) return formatQuotaError(error)
  if (error instanceof RateLimitError) return formatRateLimitError(error)
  if (error instanceof AccessRestrictedError) return `Access restricted: ${error.message}`
  if (error instanceof Error) return error.message
  return String(error)
}

function formatAuthError (error: AuthRequiredError): string {
  if (error.reason === 'revoked' && error.scope === undefined) return error.message
  if (error.scope !== undefined) {
    return `Missing scope '${error.scope}'. Run "sple auth login" to grant ${error.scope}`
  }
  return 'Authentication required. Run "sple auth login" to log in.'
}

function formatQuotaError (error: QuotaExhaustedError): string {
  const reset = error.resetAt === undefined ? '' : ` (resets at ${error.resetAt})`
  return `Quota exhausted: ${error.bucket}${reset}`
}

function formatRateLimitError (error: RateLimitError): string {
  const retry = error.retryAfterMs === undefined
    ? ''
    : ` Retry after ${Math.ceil(error.retryAfterMs / MILLISECONDS_PER_SECOND)}s.`
  return `Rate limited. Please try again later.${retry}`
}

export function formatErrorOutput (error: unknown): ErrorOutput {
  return {
    error: {
      type: error instanceof PartialFailureError
        ? 'PartialFailure'
        : error instanceof Error
          ? error.name
          : 'Error',
      message: formatErrorMessage(error),
      exitCode: getExitCode(error)
    }
  }
}

export function getPartialFailureExitCode (failures: unknown[]): number {
  if (failures.length === EMPTY_FAILURE_COUNT) return EXIT_CODES.error
  return PARTIAL_FAILURE_PRIORITY.find(code =>
    failures.some(failure => getExitCode(failure) === code)
  ) ?? EXIT_CODES.error
}
