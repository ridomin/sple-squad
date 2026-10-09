// Generic, provider-agnostic HTTP client (ADR-0010 §1, §3; issue #8). Real
// adapters (Spotify, YouTube Music — #4, #6) configure an instance with
// their own token-refresh request and error mapping; this module never
// imports anything provider-specific.
export * from './constants.ts'
export * from './backoff.ts'
export type { HttpLogEntry, HttpLogger } from './logger.ts'
export * from './http-client.ts'
export * from './token-store-access.ts'
