// Checks the closed error-type set and exit-code mapping (ADR-0003 §4).

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AccessRestrictedError,
  AuthRequiredError,
  exitCodeForError,
  NotFoundError,
  ProviderError,
  QuotaExhaustedError,
  RateLimitError,
  UsageError
} from './errors.ts'

test('ProviderError defaults to exit code 1', () => {
  const error = new ProviderError('unexpected status 500')
  assert.equal(error.exitCode, 1)
  assert.equal(error.name, 'ProviderError')
  assert.ok(error instanceof Error)
})

test('AuthRequiredError carries reason and exits 3', () => {
  const error = new AuthRequiredError('token-expired')
  assert.equal(error.exitCode, 3)
  assert.equal(error.reason, 'token-expired')
  assert.equal(error.scope, undefined)
  assert.ok(error instanceof ProviderError)
})

test('AuthRequiredError carries the first missing scope (FR-AUTH-5)', () => {
  const error = new AuthRequiredError('missing-scope', 'playlist-modify-private')
  assert.equal(error.reason, 'missing-scope')
  assert.equal(error.scope, 'playlist-modify-private')
  assert.match(error.message, /playlist-modify-private/v)
})

test('NotFoundError carries resourceType and exits 4', () => {
  const error = new NotFoundError('playlist', 'Unknown playlist ID abc123')
  assert.equal(error.exitCode, 4)
  assert.equal(error.resourceType, 'playlist')
  assert.equal(error.message, 'Unknown playlist ID abc123')
})

test('QuotaExhaustedError carries bucket and optional resetAt, exits 5', () => {
  const error = new QuotaExhaustedError('units', '2026-10-08T00:00:00Z')
  assert.equal(error.exitCode, 5)
  assert.equal(error.bucket, 'units')
  assert.equal(error.resetAt, '2026-10-08T00:00:00Z')
})

test('QuotaExhaustedError resetAt is optional', () => {
  const error = new QuotaExhaustedError('units')
  assert.equal(error.resetAt, undefined)
})

test('RateLimitError carries optional retryAfterMs and exits 5', () => {
  const withRetry = new RateLimitError(30000)
  const withoutRetry = new RateLimitError()
  assert.equal(withRetry.exitCode, 5)
  assert.equal(withRetry.retryAfterMs, 30000)
  assert.equal(withoutRetry.retryAfterMs, undefined)
})

test('AccessRestrictedError carries reason and exits 1', () => {
  const error = new AccessRestrictedError('not-owned')
  assert.equal(error.exitCode, 1)
  assert.equal(error.reason, 'not-owned')
})

test('UsageError exits 2', () => {
  const error = new UsageError('--offset is not supported on a cursor-forward provider')
  assert.equal(error.exitCode, 2)
  assert.ok(error instanceof ProviderError)
})

test('exitCodeForError maps each provider error type to its documented exit code', () => {
  assert.equal(exitCodeForError(new ProviderError('x')), 1)
  assert.equal(exitCodeForError(new AuthRequiredError('no-token')), 3)
  assert.equal(exitCodeForError(new NotFoundError('track')), 4)
  assert.equal(exitCodeForError(new QuotaExhaustedError('units')), 5)
  assert.equal(exitCodeForError(new RateLimitError()), 5)
  assert.equal(exitCodeForError(new AccessRestrictedError('premium-required')), 1)
  assert.equal(exitCodeForError(new UsageError('bad flag')), 2)
})

test('exitCodeForError maps any other error (including a plain Error) to exit 1', () => {
  assert.equal(exitCodeForError(new Error('boom')), 1)
  assert.equal(exitCodeForError('not even an error'), 1)
  assert.equal(exitCodeForError(undefined), 1)
})
