// Pure backoff/`Retry-After` math (ADR-0010 §1): exact-value assertions with
// a pinned `random`/`now` so the suite is deterministic.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { backoff, parseRetryAfterMs } from './backoff.ts'

const FIXED_RANDOM_LOW = 0 // U(0.8, 1.2) -> 0.8
const FIXED_RANDOM_MID = 0.5 // U(0.8, 1.2) -> 1.0
const FIXED_RANDOM_HIGH = 1 // U(0.8, 1.2) -> 1.2

test('backoff(0) with jitter at the low end is baseDelay * 0.8', () => {
  const ms = backoff(0, { baseDelayMs: 100, maxDelayMs: 10_000, random: () => FIXED_RANDOM_LOW })
  assert.equal(ms, 80)
})

test('backoff(1) doubles the base before jitter', () => {
  const ms = backoff(1, { baseDelayMs: 100, maxDelayMs: 10_000, random: () => FIXED_RANDOM_MID })
  assert.equal(ms, 200)
})

test('backoff(3) with jitter at the high end is baseDelay * 8 * 1.2', () => {
  const ms = backoff(3, { baseDelayMs: 100, maxDelayMs: 10_000, random: () => FIXED_RANDOM_HIGH })
  assert.ok(Math.abs(ms - 960) < 1e-9, `expected ~960, got ${ms}`)
})

test('backoff is capped at maxDelay', () => {
  const ms = backoff(10, { baseDelayMs: 100, maxDelayMs: 10_000, random: () => FIXED_RANDOM_HIGH })
  assert.equal(ms, 10_000)
})

test('parseRetryAfterMs reads delta-seconds', () => {
  assert.equal(parseRetryAfterMs('5'), 5000)
  assert.equal(parseRetryAfterMs('0'), 0)
})

test('parseRetryAfterMs reads an HTTP-date relative to now', () => {
  const now = (): number => Date.parse('2026-01-01T00:00:00Z')
  const header = new Date(now() + 30_000).toUTCString()
  assert.equal(parseRetryAfterMs(header, now), 30_000)
})

test('parseRetryAfterMs floors a past HTTP-date at 0', () => {
  const now = (): number => Date.parse('2026-01-01T00:00:00Z')
  const header = new Date(now() - 30_000).toUTCString()
  assert.equal(parseRetryAfterMs(header, now), 0)
})

test('parseRetryAfterMs returns null for a missing header', () => {
  assert.equal(parseRetryAfterMs(null), null)
  assert.equal(parseRetryAfterMs(undefined), null)
})

test('parseRetryAfterMs returns null for an unparseable header', () => {
  assert.equal(parseRetryAfterMs('not-a-valid-value'), null)
  assert.equal(parseRetryAfterMs(''), null)
})
