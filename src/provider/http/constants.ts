// Constants from ADR-0010 §1 (HTTP client retry/backoff/refresh timing).
// All are overridable per `HttpClient` instance (tests use smaller values so
// suites run fast); these are the production defaults.

/** Max retries after the first attempt: at most 4 attempts per request. */
export const DEFAULT_MAX_RETRIES = 3

/** `backoff(attempt)` base, in ms, before jitter and doubling. */
export const DEFAULT_BASE_DELAY_MS = 100

/** Ceiling for any single computed backoff sleep, in ms. */
export const DEFAULT_MAX_DELAY_MS = 10_000

/** Longest `Retry-After` the client will sleep before giving up, in ms. */
export const DEFAULT_MAX_WAIT_MS = 120_000

/** Refresh proactively when the token expires within this many ms. */
export const DEFAULT_PROACTIVE_REFRESH_WINDOW_MS = 60_000

/** `U(0.8, 1.2)` jitter bounds (±20 %) applied to `backoff(attempt)`. */
export const JITTER_MIN = 0.8
export const JITTER_SPREAD = 0.4
