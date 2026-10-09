// End-to-end tests for the in-memory `fake` provider (ADR-0003 §3.1, §5;
// PRV-6). Exercises every `Provider` member against seed fixtures: no
// network, no real auth.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { FakeProviderFixtures } from './fixtures.ts'
import { createFakeProvider, DEFAULT_FAKE_CAPABILITIES } from './fake-provider.ts'
import { AccessRestrictedError, NotFoundError } from '../errors.ts'

function at<T> (items: readonly T[], index: number): T {
  const { [index]: item } = items
  assert.ok(item !== undefined, `expected an item at index ${index}`)
  return item
}

const BASE_FIXTURES: FakeProviderFixtures = {
  user: { id: 'me', displayName: 'Me' },
  catalog: [
    { id: '1', title: 'Song One', artists: ['Artist A'], album: 'Album X', durationMs: 180000, isrc: 'USRC17607839' },
    { id: '2', title: 'Song Two', artists: ['Artist B'], album: 'Album X', durationMs: 200000 },
    { id: '3', title: 'Other Track', artists: ['Artist A', 'Artist C'], album: 'Album Y' }
  ],
  playlists: [
    {
      id: '1',
      name: 'My Playlist',
      owner: { id: 'me', displayName: 'Me' },
      owned: true,
      trackIds: ['1', '2']
    },
    {
      id: '2',
      name: 'Followed Playlist',
      owner: { id: 'someone-else' },
      owned: false,
      itemsReadable: false,
      trackIds: ['3']
    }
  ],
  liked: ['2', '3']
}

function freshFixtures (): FakeProviderFixtures {
  return structuredClone(BASE_FIXTURES)
}

describe('fake provider: identity and capabilities (ADR-0003 §5)', () => {
  it('declares id, displayName and the §5 default capabilities', () => {
    const provider = createFakeProvider()
    assert.equal(provider.id, 'fake')
    assert.equal(provider.displayName, 'Fake Provider')
    assert.deepEqual(provider.capabilities, DEFAULT_FAKE_CAPABILITIES)
  })

  it('merges capability overrides over the defaults (owned-only, cursor-forward, daily-buckets, …)', () => {
    const provider = createFakeProvider({
      capabilities: {
        playlistItemsAccess: 'owned-only',
        paginationModel: 'cursor-forward',
        quotaModel: { kind: 'daily-buckets', buckets: [{ id: 'units', dailyLimit: 10000, resetTimeZone: 'UTC' }], costs: {} }
      }
    })
    assert.equal(provider.capabilities.playlistItemsAccess, 'owned-only')
    assert.equal(provider.capabilities.paginationModel, 'cursor-forward')
    assert.equal(provider.capabilities.quotaModel.kind, 'daily-buckets')
    // Un-overridden fields keep their default.
    assert.equal(provider.capabilities.canDeletePlaylist, true)
  })

  it('accepts a custom display name', () => {
    const provider = createFakeProvider({ displayName: 'Test Double' })
    assert.equal(provider.displayName, 'Test Double')
  })
})

describe('fake provider: auth', () => {
  it('starts logged out', async () => {
    const provider = createFakeProvider()
    const status = await provider.auth.status()
    assert.equal(status.loggedIn, false)
    assert.deepEqual(status.scopes, [])
  })

  it('login reports loggedIn, the seeded user and the requested scopes', async () => {
    const provider = createFakeProvider({ fixtures: { user: { id: 'u1', displayName: 'U1' } } })
    const status = await provider.auth.login({ mode: 'manual', scopes: ['read', 'write'] })
    assert.equal(status.loggedIn, true)
    assert.deepEqual(status.user, { id: 'u1', displayName: 'U1' })
    assert.deepEqual(status.scopes, ['read', 'write'])
    assert.deepEqual(await provider.auth.status(), status)
  })

  it('logout resets to logged-out and reports deleted data', async () => {
    const provider = createFakeProvider()
    await provider.auth.login({ mode: 'manual', scopes: [] })
    const result = await provider.auth.logout()
    assert.equal(result.revoked, true)
    assert.ok(result.deletedData.length > 0)
    assert.equal((await provider.auth.status()).loggedIn, false)
  })
})

describe('fake provider: ref parsing (ADR-0003 §3.1)', () => {
  it('parsePlaylistRef accepts a bare decimal id and returns it unchanged', () => {
    const provider = createFakeProvider()
    assert.equal(provider.parsePlaylistRef('42'), '42')
  })

  it('parsePlaylistRef accepts fake:playlist:<id> and normalizes to the decimal ref', () => {
    const provider = createFakeProvider()
    assert.equal(provider.parsePlaylistRef('fake:playlist:42'), '42')
  })

  it('parsePlaylistRef returns null for a name (falls back to name lookup)', () => {
    const provider = createFakeProvider()
    assert.equal(provider.parsePlaylistRef('My Playlist'), null)
  })

  it('parseTrackRef accepts fake:track:<id>', () => {
    const provider = createFakeProvider()
    assert.equal(provider.parseTrackRef('fake:track:7'), 'fake:track:7')
  })

  it('parseTrackRef returns null for a bare id (tracks have no bare-id form)', () => {
    const provider = createFakeProvider()
    assert.equal(provider.parseTrackRef('7'), null)
  })
})

describe('fake provider: listPlaylists / getPlaylist (offset pagination)', () => {
  it('lists every playlist with total and no filter', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    const result = await provider.listPlaylists({ limit: 10 })
    assert.equal(result.items.length, 2)
    assert.equal(result.total, 2)
    assert.equal(result.next, undefined)
  })

  it('paginates with offset and reports next.offset', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    const first = await provider.listPlaylists({ limit: 1 })
    assert.equal(first.items.length, 1)
    assert.deepEqual(first.next, { offset: 1 })
    const second = await provider.listPlaylists({ limit: 1, offset: 1 })
    assert.equal(second.items.length, 1)
    assert.equal(second.next, undefined)
    assert.notEqual(first.items[0]?.id, second.items[0]?.id)
  })

  it('filters by owned', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    const result = await provider.listPlaylists({ limit: 10 }, 'owned')
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0]?.name, 'My Playlist')
  })

  it('filters by followed (not owned)', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    const result = await provider.listPlaylists({ limit: 10 }, 'followed')
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0]?.name, 'Followed Playlist')
  })

  it('getPlaylist returns metadata even when itemsReadable is false', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    const summary = await provider.getPlaylist('2')
    assert.equal(summary.itemsReadable, false)
    assert.equal(summary.owned, false)
  })

  it('getPlaylist throws NotFoundError for an unknown ref', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    await assert.rejects(
      async () => { await provider.getPlaylist('999') },
      (error: unknown) => {
        assert.ok(error instanceof NotFoundError)
        assert.equal(error.resourceType, 'playlist')
        assert.equal(error.exitCode, 4)
        return true
      }
    )
  })
})

describe('fake provider: getPlaylistTracks', () => {
  it('returns canonical tracks in playlist order, paginated', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    const result = await provider.getPlaylistTracks('1', { limit: 10 })
    assert.equal(result.items.length, 2)
    assert.equal(result.items[0]?.title, 'Song One')
    assert.deepEqual(at(result.items, 0).refs, { fake: 'fake:track:1' })
    assert.equal(result.total, 2)
  })

  it('throws AccessRestrictedError when !itemsReadable', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    await assert.rejects(
      async () => { await provider.getPlaylistTracks('2', { limit: 10 }) },
      (error: unknown) => {
        assert.ok(error instanceof AccessRestrictedError)
        assert.equal(error.reason, 'not-owned')
        return true
      }
    )
  })

  it('paginates playlist tracks with offset', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    const page = await provider.getPlaylistTracks('1', { limit: 1, offset: 1 })
    assert.equal(page.items.length, 1)
    assert.equal(page.items[0]?.title, 'Song Two')
  })
})

describe('fake provider: getLikedTracks', () => {
  it('returns liked tracks in seed order, paginated', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    const result = await provider.getLikedTracks({ limit: 1 })
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0]?.title, 'Song Two')
    assert.deepEqual(result.next, { offset: 1 })
    assert.equal(result.total, 2)
  })

  it('returns an empty page when no tracks are liked', async () => {
    const provider = createFakeProvider()
    const result = await provider.getLikedTracks({ limit: 10 })
    assert.deepEqual(result.items, [])
    assert.equal(result.total, 0)
  })
})

describe('fake provider: createPlaylist / updatePlaylist / removePlaylist', () => {
  it('createPlaylist returns an owned, readable, empty playlist', async () => {
    const provider = createFakeProvider()
    const created = await provider.createPlaylist({ name: 'New Playlist', description: 'desc', public: false })
    assert.equal(created.owned, true)
    assert.equal(created.itemsReadable, true)
    assert.equal(created.trackCount, 0)
    assert.equal(created.description, 'desc')
    const fetched = await provider.getPlaylist(created.ref)
    assert.deepEqual(fetched, created)
  })

  it('createPlaylist assigns ids that do not collide with seeded playlists', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    const created = await provider.createPlaylist({ name: 'Another', public: true })
    assert.equal(created.ref, '3')
  })

  it('createPlaylist rejects collaborative when supportsCollaborative is false', async () => {
    const provider = createFakeProvider({ capabilities: { supportsCollaborative: false } })
    await assert.rejects(async () => {
      await provider.createPlaylist({ name: 'Collab', public: false, collaborative: true })
    })
  })

  it('updatePlaylist patches name/description/public', async () => {
    const provider = createFakeProvider()
    const created = await provider.createPlaylist({ name: 'Old Name', public: false })
    assert.ok(provider.updatePlaylist !== undefined)
    const updated = await provider.updatePlaylist(created.ref, { name: 'New Name', public: true })
    assert.equal(updated.name, 'New Name')
    assert.equal(updated.public, true)
  })

  it('removePlaylist reports "deleted" when canDeletePlaylist is true (default)', async () => {
    const provider = createFakeProvider()
    const created = await provider.createPlaylist({ name: 'To Delete', public: false })
    const removed = await provider.removePlaylist(created.ref)
    assert.deepEqual(removed, { action: 'deleted' })
    await assert.rejects(async () => { await provider.getPlaylist(created.ref) }, NotFoundError)
  })

  it('removePlaylist reports "unfollowed" when canDeletePlaylist is false (Spotify-like override)', async () => {
    const provider = createFakeProvider({ capabilities: { canDeletePlaylist: false } })
    const created = await provider.createPlaylist({ name: 'To Unfollow', public: false })
    const removed = await provider.removePlaylist(created.ref)
    assert.deepEqual(removed, { action: 'unfollowed' })
  })
})

describe('fake provider: search', () => {
  it('search(type: track) matches by title, case-insensitively', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    const result = await provider.search({ text: 'song', type: 'track' }, { limit: 10 })
    assert.equal(result.items.length, 2)
    assert.ok(result.items.every((item) => item.type === 'track'))
  })

  it('search(type: playlist) matches by name', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    const result = await provider.search({ text: 'Followed', type: 'playlist' }, { limit: 10 })
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0]?.name, 'Followed Playlist')
  })

  it('search(type: album) matches by album name and dedupes', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    const result = await provider.search({ text: 'Album X', type: 'album' }, { limit: 10 })
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0]?.name, 'Album X')
  })

  it('search(type: artist) matches by artist name and dedupes across tracks', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    const result = await provider.search({ text: 'Artist A', type: 'artist' }, { limit: 10 })
    assert.equal(result.items.length, 1)
  })

  it('clamps the effective limit to maxSearchPageSize', async () => {
    const provider = createFakeProvider({
      fixtures: freshFixtures(),
      capabilities: { maxSearchPageSize: 1 }
    })
    const result = await provider.search({ text: 'song', type: 'track' }, { limit: 10 })
    assert.equal(result.items.length, 1)
    assert.deepEqual(result.next, { offset: 1 })
  })
})

describe('fake provider: searchTracks and populatePlaylist (ADR-0003 Amendment 2)', () => {
  it('searchTracks matches by isrc', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    const hits = await provider.searchTracks({ kind: 'isrc', isrc: 'USRC17607839' }, { limit: 5 })
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.ref, 'fake:track:1')
  })

  it('searchTracks matches by metadata title and respects limit', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    const hits = await provider.searchTracks({ kind: 'metadata', title: 'Song', artists: ['Artist A'] }, { limit: 1 })
    assert.equal(hits.length, 1)
  })

  it('populatePlaylist adds valid refs in order and reports unknown refs as failed', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    const result = await provider.populatePlaylist('1', ['fake:track:3', 'not-a-ref'], { skipExisting: false })
    assert.deepEqual(result.added, ['fake:track:3'])
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0]?.ref, 'not-a-ref')
    const tracks = await provider.getPlaylistTracks('1', { limit: 10 })
    assert.equal(tracks.items.length, 3)
  })

  it('populatePlaylist skips already-added refs when skipExisting is true', async () => {
    const provider = createFakeProvider({ fixtures: freshFixtures() })
    await provider.populatePlaylist('1', ['fake:track:3'], { skipExisting: true })
    const second = await provider.populatePlaylist('1', ['fake:track:3', 'fake:track:1'], { skipExisting: true })
    assert.deepEqual(second.added, [])
  })

  it('populatePlaylist batches writes by maxTracksPerRequest without changing the result', async () => {
    const provider = createFakeProvider({
      fixtures: { catalog: [{ id: '1', title: 'A', artists: ['X'] }, { id: '2', title: 'B', artists: ['X'] }, { id: '3', title: 'C', artists: ['X'] }] },
      capabilities: { maxTracksPerRequest: 1 }
    })
    const created = await provider.createPlaylist({ name: 'P', public: false })
    const result = await provider.populatePlaylist(created.ref, ['fake:track:1', 'fake:track:2', 'fake:track:3'], { skipExisting: false })
    assert.deepEqual(result.added, ['fake:track:1', 'fake:track:2', 'fake:track:3'])
    const summary = await provider.getPlaylist(created.ref)
    assert.equal(summary.trackCount, 3)
  })
})

describe('fake provider: fixture validation', () => {
  it('throws when a playlist references an unknown track id', () => {
    assert.throws(() => {
      createFakeProvider({
        fixtures: {
          playlists: [{ id: '1', name: 'Bad', owner: { id: 'me' }, trackIds: ['missing'] }]
        }
      })
    }, /unknown track id/v)
  })

  it('throws when liked tracks reference an unknown track id', () => {
    assert.throws(() => {
      createFakeProvider({ fixtures: { liked: ['missing'] } })
    }, /unknown track id/v)
  })
})
