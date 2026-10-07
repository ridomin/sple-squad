// Backoff and `Retry-After` math (ADR-0010 §1). Kept free of I/O so tests
// can assert exact values with a fixed `random`/`now`.
import { DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_DELAY_MS, JITTER_MIN, JITTER_SPREAD } from './constants.ts'

export interface BackoffOptions {
  baseDelayMs?: number
  maxDelayMs?: number
  /** Returns a value in `[0, 1)`; overridable so tests can pin the jitter factor. Defaults to `Math.random`. */
  random?: () => number
}

const DOUBLING_BASE = 2

/**
 * `backoff(attempt) = min(baseDelay * 2^attempt * U(0.8, 1.2), maxDelay)`,
 * `attempt` starts at 0.
 */
export function backoff (attempt: number, options: BackoffOptions = {}): number {
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const random = options.random ?? Math.random
  const jitter = JITTER_MIN + (random() * JITTER_SPREAD)
  const raw = baseDelayMs * (DOUBLING_BASE ** attempt) * jitter
  return Math.min(raw, maxDelayMs)
}

const MS_PER_SECOND = 1000
const EMPTY_LENGTH = 0
const ZERO_MS = 0
const DELTA_SECONDS_PATTERN = /^\d+$/v

/**
 * Parses a `Retry-After` header value: a non-negative integer number of
 * delta-seconds, or an HTTP-date. Returns `null` when the header is absent,
 * empty, or unparseable (caller falls back to `backoff(0)`, ADR-0010 §1).
 */
export function parseRetryAfterMs (headerValue: string | null | undefined, now: () => number = Date.now): number | null {
  if (headerValue === null || headerValue === undefined) {
    return null
  }
  const trimmed = headerValue.trim()
  if (trimmed.length === EMPTY_LENGTH) {
    return null
  }

  if (DELTA_SECONDS_PATTERN.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * MS_PER_SECOND
  }

  const dateMs = Date.parse(trimmed)
  if (Number.isNaN(dateMs)) {
    return null
  }
  const deltaMs = dateMs - now()
  return deltaMs > ZERO_MS ? deltaMs : ZERO_MS
}
