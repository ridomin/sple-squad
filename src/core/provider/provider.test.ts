// Exercises the `Provider` interface (ADR-0003 §3) against an in-memory stub
// implementation. No network code: the stub is pure, synchronous-but-async
// in-memory state, just enough to drive every interface member once.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CanonicalTrack } from '../canonical-track.ts'
import type { ProviderCapabilities } from './capabilities.ts'
import type {
  AuthStatus,
  Page,
  PlaylistSummary,
  Provider,
  TrackHit,
  TrackQuery
} from './provider.ts'
import { AccessRestrictedError, NotFoundError } from './errors.ts'

const STUB_CAPABILITIES: ProviderCapabilities = {
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
  isrcSearchMode: 'filter',
  searchReturnsDuration: true,
  musicAwareSearch: false,
  canDeletePlaylist: true,
  supportsCollaborative: true,
  maxTracksPerRequest: 100,
  quotaModel: { kind: 'rate-limited' }
}

interface StubPlaylist {
  summary: PlaylistSummary
  tracks: CanonicalTrack[]
}

function track (id: string, overrides: Partial<CanonicalTrack> = {}): CanonicalTrack {
  return {
    title: `Track ${id}`,
    artists: [`Artist ${id}`],
    refs: { fake: `fake:track:${id}` },
    ...overrides
  }
}

/** Builds a fresh in-memory stub `Provider` for one test. No shared state across calls. */
function createStubProvider (seed: { playlists?: StubPlaylist[], liked?: CanonicalTrack[], catalog?: TrackHit[] } = {}): Provider {
  const playlists = seed.playlists ?? []
  const liked = seed.liked ?? []
  const catalog = seed.catalog ?? []
  const addedByPlaylist = new Map<string, string[]>()

  function findPlaylist (ref: string): StubPlaylist {
    const playlist = playlists.find((p) => p.summary.ref === ref)
    if (playlist === undefined) {
      throw new NotFoundError('playlist', `No stub playlist with ref ${ref}`)
    }
    return playlist
  }

  function page<T> (items: T[], request: { limit: number, offset?: number }): Page<T> {
    const offset = request.offset ?? 0
    const slice = items.slice(offset, offset + request.limit)
    const result: Page<T> = { items: slice, total: items.length }
    if (offset + request.limit < items.length) {
      result.next = { offset: offset + request.limit }
    }
    return result
  }

  return {
    id: 'fake',
    displayName: 'Stub Provider',
    capabilities: STUB_CAPABILITIES,

    auth: {
      login: async (opts) => await Promise.resolve({ loggedIn: true, scopes: opts.scopes } satisfies AuthStatus),
      status: async () => await Promise.resolve({ loggedIn: true, scopes: [] } satisfies AuthStatus),
      logout: async () => await Promise.resolve({ revoked: true, deletedData: ['tokens.json'] })
    },

    search: async (_q, request) => await Promise.resolve(page([], request)),

    parsePlaylistRef: (input) => (/^fake:playlist:\d+$/v.test(input) || /^\d+$/v.test(input) ? input : null),

    parseTrackRef: (input) => (/^fake:track:\d+$/v.test(input) ? input : null),

    listPlaylists: async (request, filter) => {
      const filtered = filter === undefined
        ? playlists
        : playlists.filter((p) => (filter === 'owned' ? p.summary.owned : !p.summary.owned))
      return await Promise.resolve(page(filtered.map((p) => p.summary), request))
    },

    getPlaylist: async (ref) => await Promise.resolve(findPlaylist(ref).summary),

    getPlaylistTracks: async (ref, request) => {
      const playlist = findPlaylist(ref)
      if (!playlist.summary.itemsReadable) {
        throw new AccessRestrictedError('not-owned', `Playlist ${ref} is not owned by the current user`)
      }
      return await Promise.resolve(page(playlist.tracks, request))
    },

    getLikedTracks: async (request) => await Promise.resolve(page(liked, request)),

    createPlaylist: async (input) => {
      const ref = `fake:playlist:${playlists.length + 1}`
      const summary: PlaylistSummary = {
        ref,
        id: `${playlists.length + 1}`,
        name: input.name,
        owner: { id: 'stub-user' },
        owned: true,
        itemsReadable: true,
        public: input.public
      }
      playlists.push({ summary, tracks: [] })
      return await Promise.resolve(summary)
    },

    removePlaylist: async (ref) => {
      const playlist = findPlaylist(ref)
      return await Promise.resolve({ action: playlist.summary.owned ? 'deleted' : 'unfollowed' })
    },

    searchTracks: async (query: TrackQuery, opts) => {
      const hits = query.kind === 'isrc'
        ? catalog.filter((hit) => hit.track.isrc === query.isrc)
        : catalog.filter((hit) => hit.track.title.toLowerCase().includes(query.title.toLowerCase()))
      return await Promise.resolve(hits.slice(0, opts.limit))
    },

    populatePlaylist: async (ref, trackRefs, opts) => {
      findPlaylist(ref)
      const existing = addedByPlaylist.get(ref) ?? []
      const added: string[] = []
      const failed: Array<{ ref: string, error: string }> = []
      for (const trackRef of trackRefs) {
        if (opts.skipExisting && existing.includes(trackRef)) {
          continue
        }
        if (!trackRef.startsWith('fake:track:')) {
          failed.push({ ref: trackRef, error: 'Not a fake track ref' })
          continue
        }
        existing.push(trackRef)
        added.push(trackRef)
      }
      addedByPlaylist.set(ref, existing)
      return await Promise.resolve({ added, failed })
    }
  }
}

describe('Provider stub: identity and auth', () => {
  it('exposes id, displayName and capabilities', () => {
    const provider = createStubProvider()
    assert.equal(provider.id, 'fake')
    assert.equal(provider.displayName, 'Stub Provider')
    assert.equal(provider.capabilities.paginationModel, 'offset')
  })

  it('auth.login returns the requested scopes', async () => {
    const provider = createStubProvider()
    const status = await provider.auth.login({ mode: 'loopback', scopes: ['playlist-read-private'] })
    assert.equal(status.loggedIn, true)
    assert.deepEqual(status.scopes, ['playlist-read-private'])
  })

  it('auth.logout reports what was deleted', async () => {
    const provider = createStubProvider()
    const result = await provider.auth.logout()
    assert.equal(result.revoked, true)
    assert.deepEqual(result.deletedData, ['tokens.json'])
  })
})

describe('Provider stub: playlist refs (§3.1)', () => {
  it('parsePlaylistRef accepts an ID-shaped ref', () => {
    const provider = createStubProvider()
    assert.equal(provider.parsePlaylistRef('fake:playlist:1'), 'fake:playlist:1')
  })

  it('parsePlaylistRef returns null for a name (falls back to name lookup)', () => {
    const provider = createStubProvider()
    assert.equal(provider.parsePlaylistRef('My Playlist'), null)
  })

  it('parseTrackRef accepts a canonical fake track ref', () => {
    const provider = createStubProvider()
    assert.equal(provider.parseTrackRef('fake:track:42'), 'fake:track:42')
  })

  it('parseTrackRef returns null for an unrelated string', () => {
    const provider = createStubProvider()
    assert.equal(provider.parseTrackRef('not-a-ref'), null)
  })
})

describe('Provider stub: listPlaylists / getPlaylist', () => {
  function seedPlaylists (): StubPlaylist[] {
    return [
      { summary: { ref: 'fake:playlist:1', id: '1', name: 'Owned', owner: { id: 'me' }, owned: true, itemsReadable: true }, tracks: [track('a')] },
      { summary: { ref: 'fake:playlist:2', id: '2', name: 'Followed', owner: { id: 'other' }, owned: false, itemsReadable: false }, tracks: [] }
    ]
  }

  it('lists every playlist with no filter and reports total', async () => {
    const provider = createStubProvider({ playlists: seedPlaylists() })
    const result = await provider.listPlaylists({ limit: 10 })
    assert.equal(result.items.length, 2)
    assert.equal(result.total, 2)
  })

  it('filters by owned', async () => {
    const provider = createStubProvider({ playlists: seedPlaylists() })
    const result = await provider.listPlaylists({ limit: 10 }, 'owned')
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0]?.name, 'Owned')
  })

  it('getPlaylist returns metadata even when itemsReadable is false', async () => {
    const provider = createStubProvider({ playlists: seedPlaylists() })
    const summary = await provider.getPlaylist('fake:playlist:2')
    assert.equal(summary.itemsReadable, false)
  })

  it('getPlaylist throws NotFoundError for an unknown ref', async () => {
    const provider = createStubProvider({ playlists: seedPlaylists() })
    await assert.rejects(
      async () => { await provider.getPlaylist('fake:playlist:999') },
      (error: unknown) => {
        assert.ok(error instanceof NotFoundError)
        assert.equal(error.resourceType, 'playlist')
        assert.equal(error.exitCode, 4)
        return true
      }
    )
  })

  it('getPlaylistTracks throws AccessRestrictedError when !itemsReadable', async () => {
    const provider = createStubProvider({ playlists: seedPlaylists() })
    await assert.rejects(
      async () => { await provider.getPlaylistTracks('fake:playlist:2', { limit: 10 }) },
      (error: unknown) => {
        assert.ok(error instanceof AccessRestrictedError)
        assert.equal(error.reason, 'not-owned')
        return true
      }
    )
  })

  it('getPlaylistTracks pages through readable playlists', async () => {
    const provider = createStubProvider({ playlists: seedPlaylists() })
    const result = await provider.getPlaylistTracks('fake:playlist:1', { limit: 10 })
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0]?.title, 'Track a')
  })
})

describe('Provider stub: liked tracks, create/remove playlist', () => {
  it('getLikedTracks pages the liked library', async () => {
    const provider = createStubProvider({ liked: [track('x'), track('y')] })
    const result = await provider.getLikedTracks({ limit: 1 })
    assert.equal(result.items.length, 1)
    assert.deepEqual(result.next, { offset: 1 })
    assert.equal(result.total, 2)
  })

  it('createPlaylist then removePlaylist reports deleted for an owned playlist', async () => {
    const provider = createStubProvider()
    const created = await provider.createPlaylist({ name: 'New Playlist', public: false })
    assert.equal(created.owned, true)
    const removed = await provider.removePlaylist(created.ref)
    assert.deepEqual(removed, { action: 'deleted' })
  })
})

describe('Provider stub: searchTracks and populatePlaylist (ADR-0003 Amendment 2)', () => {
  it('searchTracks matches by isrc', async () => {
    const hit: TrackHit = { ref: 'fake:track:1', track: track('1', { isrc: 'USRC17607839' }) }
    const provider = createStubProvider({ catalog: [hit] })
    const hits = await provider.searchTracks({ kind: 'isrc', isrc: 'USRC17607839' }, { limit: 5 })
    assert.equal(hits.length, 1)
    assert.equal(hits[0]?.ref, 'fake:track:1')
  })

  it('searchTracks matches by metadata title and respects limit', async () => {
    const hits: TrackHit[] = [
      { ref: 'fake:track:1', track: track('1') },
      { ref: 'fake:track:2', track: track('2') }
    ]
    const provider = createStubProvider({ catalog: hits })
    const result = await provider.searchTracks({ kind: 'metadata', title: 'Track', artists: ['Artist'] }, { limit: 1 })
    assert.equal(result.length, 1)
  })

  it('populatePlaylist adds valid refs and reports invalid ones as failed', async () => {
    const provider = createStubProvider({
      playlists: [{ summary: { ref: 'fake:playlist:1', id: '1', name: 'P', owner: { id: 'me' }, owned: true, itemsReadable: true }, tracks: [] }]
    })
    const result = await provider.populatePlaylist('fake:playlist:1', ['fake:track:1', 'not-a-ref'], { skipExisting: false })
    assert.deepEqual(result.added, ['fake:track:1'])
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0]?.ref, 'not-a-ref')
  })

  it('populatePlaylist skips already-added refs when skipExisting is true', async () => {
    const provider = createStubProvider({
      playlists: [{ summary: { ref: 'fake:playlist:1', id: '1', name: 'P', owner: { id: 'me' }, owned: true, itemsReadable: true }, tracks: [] }]
    })
    await provider.populatePlaylist('fake:playlist:1', ['fake:track:1'], { skipExisting: true })
    const second = await provider.populatePlaylist('fake:playlist:1', ['fake:track:1', 'fake:track:2'], { skipExisting: true })
    assert.deepEqual(second.added, ['fake:track:2'])
  })
})
