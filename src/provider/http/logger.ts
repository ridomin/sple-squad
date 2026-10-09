// Debug/log hook (ADR-0010 §5). No logging framework exists yet in this repo
// (checked: no `debug`/`pino`/`winston` usage under `src/`), so this is a
// minimal pluggable interface an adapter (or test) can wire into whatever
// the CLI eventually adopts (ADR 0007 §6). Headers and bodies are never
// logged; the client only ever constructs the fields below.

/** One attempt at one request: success, a retried failure, or the final failure. */
export interface HttpLogEntry {
  method: string
  /** Path and query string only; the client never logs scheme/host. */
  path: string
  /** HTTP status for a response, or `ERR <code>` for a network error with no response. */
  status: number | string
  durationMs: number
  /** Number of attempts already made before this one (0 for the first attempt). */
  retryCount: number
}

export interface HttpLogger {
  /** Every attempt, including retries and network failures (`sple:http`). */
  attempt?: (entry: HttpLogEntry) => void
  /** Logged in addition to `attempt` when a response triggers a retry (`sple:http:retry`). */
  retry?: (entry: HttpLogEntry) => void
  /** Logged once a request fails for good, after mapping (`sple:http:error`). */
  error?: (entry: HttpLogEntry & { error: unknown }) => void
}
