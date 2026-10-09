// Shape and constraint checks for ProviderCapabilities (ADR-0003 §1, §5).
// Pure type-level/value checks, no I/O.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProviderCapabilities, QuotaModel } from './capabilities.ts'

const FAKE_PROVIDER_DEFAULTS: ProviderCapabilities = {
  official: false,
  requiresRiskAcknowledgement: false,
  userSuppliedClientId: true,
  requiresClientSecret: false,
  supportsRefreshToken: true,
  supportsRevocation: true,
  paginationModel: 'offset',
  maxSearchPageSize: 50,
  readPageSize: { playlists: 50, playlistItems: 100, liked: 50 },
  playlistItemsAccess: 'all',
  likedSongs: { read: 'exact', write: false },
  isrcSearchMode: 'none',
  searchReturnsDuration: true,
  musicAwareSearch: false,
  canDeletePlaylist: true,
  supportsCollaborative: true,
  maxTracksPerRequest: 100,
  quotaModel: { kind: 'rate-limited' }
}

test('ADR-0003 §5 fake-provider defaults are assignable to ProviderCapabilities', () => {
  assert.equal(FAKE_PROVIDER_DEFAULTS.readPageSize.playlistItems, 100)
  assert.equal(FAKE_PROVIDER_DEFAULTS.likedSongs.write, false)
})

test('every capability value can be overridden (tests need owned-only, cursor-forward, daily-buckets, …)', () => {
  const spotifyLike: ProviderCapabilities = {
    ...FAKE_PROVIDER_DEFAULTS,
    official: true,
    playlistItemsAccess: 'owned-or-collaborator',
    maxSearchPageSize: 10,
    isrcSearchMode: 'filter',
    canDeletePlaylist: false
  }
  assert.equal(spotifyLike.playlistItemsAccess, 'owned-or-collaborator')
  assert.equal(spotifyLike.maxSearchPageSize, 10)
})

test('QuotaModel supports the daily-buckets shape (YouTube Data API)', () => {
  const quotaModel: QuotaModel = {
    kind: 'daily-buckets',
    buckets: [{ id: 'units', dailyLimit: 10000, resetTimeZone: 'America/Los_Angeles' }],
    costs: {
      search: [{ bucket: 'units', amount: 100, per: 'call' }],
      getPlaylistItems: [{ bucket: 'units', amount: 1, per: 'page', pageSize: 50 }]
    }
  }
  assert.equal(quotaModel.kind, 'daily-buckets')
  assert.equal(quotaModel.buckets.length, 1)
  assert.equal(quotaModel.costs.search?.[0]?.amount, 100)
})

test('QuotaModel supports rate-limited and undocumented shapes', () => {
  const rateLimited: QuotaModel = { kind: 'rate-limited' }
  const undocumented: QuotaModel = { kind: 'undocumented', minDelayMs: 500, maxBatch: 10 }
  assert.equal(rateLimited.kind, 'rate-limited')
  assert.equal(undocumented.kind, 'undocumented')
})

test("likedSongs.write is the literal type false (writing likes is out of scope)", () => {
  const capabilities: ProviderCapabilities = { ...FAKE_PROVIDER_DEFAULTS, likedSongs: { read: 'approximate', write: false, readCap: 5000 } }
  assert.equal(capabilities.likedSongs.write, false)
  assert.equal(capabilities.likedSongs.readCap, 5000)
})
