// Fake-requester tests for the Spotify read/write operations. No network:
// every response is a canned `Response`; request construction (method, path,
// query, body, operation name used for scope checks) is asserted from the
// recorded calls. These prove adapter behaviour against the documented
// shapes only; they do not verify live Spotify behaviour (S1–S4 unverified).

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AccessRestrictedError,
  AuthRequiredError,
  NotFoundError,
  ProviderError,
  QuotaExhaustedError,
  RateLimitError,
  UsageError
} from '../../core/provider/errors.ts'
import {
  FIRST_CALL, HTTP_CREATED, HTTP_OK, HTTP_SERVER_ERROR, OTHER_ID, PL_ID, SECOND_CALL, TRACK_ID, TRACK_URI,
  at, failing, isNotOwned, json, respondingJson, me, playlist, setup, track
} from './api-test-support.ts'
import { SPOTIFY_API_CAPABILITIES } from './api-capabilities.ts'

describe('capabilities', () => {
  it('declares the ADR-0003 §5 Spotify values (S1–S3 prior claims, unverified)', () => {
    assert.equal(SPOTIFY_API_CAPABILITIES.maxSearchPageSize, 10)
    assert.deepEqual(SPOTIFY_API_CAPABILITIES.readPageSize, { playlists: 50, playlistItems: 100, liked: 50 })
    assert.equal(SPOTIFY_API_CAPABILITIES.maxTracksPerRequest, 100)
  })
})

describe('ref parsing (pure)', () => {
  const { api } = setup(() => new Error('no I/O expected'))
  it('parses playlist IDs, URIs and URLs to the bare ID', () => {
    assert.equal(api.parsePlaylistRef(PL_ID), PL_ID)
    assert.equal(api.parsePlaylistRef(`spotify:playlist:${PL_ID}`), PL_ID)
    assert.equal(api.parsePlaylistRef(`https://open.spotify.com/intl-de/playlist/${PL_ID}?si=x`), PL_ID)
    assert.equal(api.parsePlaylistRef(`spotify:track:${PL_ID}`), null)
    assert.equal(api.parsePlaylistRef('My Playlist'), null)
  })
  it('parses track refs to spotify:track:<id>', () => {
    assert.equal(api.parseTrackRef(TRACK_ID), TRACK_URI)
    assert.equal(api.parseTrackRef(TRACK_URI), TRACK_URI)
    assert.equal(api.parseTrackRef(`https://open.spotify.com/track/${TRACK_ID}`), TRACK_URI)
    assert.equal(api.parseTrackRef(`spotify:playlist:${TRACK_ID}`), null)
    assert.equal(api.parseTrackRef('nope'), null)
  })
})

describe('search', () => {
  it('builds the request and maps each search type', async () => {
    const { api, calls } = setup(() => json({
      tracks: { items: [track(), null], total: 25, next: 'https://api.spotify.com/next' }
    }))
    const page = await api.search({ text: 'hello world', type: 'track' }, { limit: 10, offset: 10 })
    const call = at(calls, FIRST_CALL)
    assert.equal(call.operation, 'search')
    assert.equal(call.method, 'GET')
    assert.equal(call.url.pathname, '/v1/search')
    assert.equal(call.url.searchParams.get('q'), 'hello world')
    assert.equal(call.url.searchParams.get('type'), 'track')
    assert.equal(call.url.searchParams.get('limit'), '10')
    assert.equal(call.url.searchParams.get('offset'), '10')
    assert.equal(page.total, 25)
    assert.deepEqual(page.next, { offset: 12 })
    const item = at(page.items, FIRST_CALL)
    assert.equal(item.type, 'track')
    assert.equal(item.ref, TRACK_URI)
    assert.equal(item.track.isrc, 'USRC17607839')
  })

  it('maps album, artist and playlist results', async () => {
    const section = {
      albums: { items: [{ id: 'al', uri: 'spotify:album:al', name: 'A', artists: [{ name: 'X' }], release_date: '2020', total_tracks: 9 }] },
      artists: { items: [{ id: 'ar', uri: 'spotify:artist:ar', name: 'Y' }] },
      playlists: { items: [playlist(PL_ID, 'u1')] }
    }
    const { api } = setup(() => json(section))
    const [album, artist, pl] = await Promise.all([
      api.search({ text: 'q', type: 'album' }, { limit: 5 }),
      api.search({ text: 'q', type: 'artist' }, { limit: 5 }),
      api.search({ text: 'q', type: 'playlist' }, { limit: 5 })
    ])
    assert.deepEqual(at(album.items, FIRST_CALL), { id: 'al', name: 'A', type: 'album', ref: 'spotify:album:al', artists: ['X'], releaseDate: '2020', trackCount: 9 })
    assert.equal(at(artist.items, FIRST_CALL).type, 'artist')
    assert.deepEqual(at(pl.items, FIRST_CALL), {
      id: PL_ID,
      name: 'List A',
      type: 'playlist',
      ref: PL_ID,
      url: `https://open.spotify.com/playlist/${PL_ID}`,
      owner: { id: 'u1', displayName: 'Owner' },
      trackCount: 3
    })
    assert.equal(album.next, undefined)
  })

  it('fails clearly (no silent clamp) above the declared search page size', async () => {
    const { api, calls } = setup(() => json({ tracks: { items: [] } }))
    await assert.rejects(api.search({ text: 'q', type: 'track' }, { limit: 11 }), UsageError)
    assert.equal(calls.length, 0)
    await api.search({ text: 'q', type: 'track' }, { limit: 10 })
    assert.equal(at(calls, FIRST_CALL).url.searchParams.get('limit'), '10')
  })

  it('enforces limit + offset <= 1000 (S3, unverified documented ceiling)', async () => {
    const { api, calls } = setup(() => json({ tracks: { items: [] } }))
    await assert.rejects(api.search({ text: 'q', type: 'track' }, { limit: 10, offset: 991 }), UsageError)
    await assert.rejects(api.searchTracks({ kind: 'metadata', title: 't', artists: [] }, { limit: 11 }), UsageError)
    assert.equal(calls.length, 0)
    await api.search({ text: 'q', type: 'track' }, { limit: 10, offset: 990 })
    assert.equal(at(calls, FIRST_CALL).url.searchParams.get('offset'), '990')
  })

  it('rejects invalid pagination input without a request', async () => {
    const { api, calls } = setup(() => json({}))
    await assert.rejects(api.search({ text: 'q', type: 'track' }, { limit: 0 }), UsageError)
    await assert.rejects(api.search({ text: 'q', type: 'track' }, { limit: 5, offset: -1 }), UsageError)
    await assert.rejects(api.search({ text: 'q', type: 'track' }, { limit: 5, cursor: 'c' }), UsageError)
    assert.equal(calls.length, 0)
  })

  it('rejects malformed responses', async () => {
    await Promise.all([{}, { tracks: 'x' }, { tracks: { items: 'x' } }, { tracks: { items: ['x'] } }, { tracks: { items: [{ name: 'no id' }] } }].map(async (body) => {
      const { api } = respondingJson(body)
      await assert.rejects(api.search({ text: 'q', type: 'track' }, { limit: 5 }), ProviderError)
    }))
    const { api } = setup(() => new Response('not json', { status: HTTP_OK }))
    await assert.rejects(api.search({ text: 'q', type: 'track' }, { limit: 5 }), ProviderError)
  })

  it('propagates auth, scope, rate-limit and API errors from the requester', async () => {
    await Promise.all([new AuthRequiredError('no-token'), new AuthRequiredError('missing-scope', 'x'), new RateLimitError(10), new ProviderError('boom')].map(async (error) => {
      const { api } = failing(error)
      await assert.rejects(api.search({ text: 'q', type: 'track' }, { limit: 5 }), error)
    }))
    const { api } = setup(() => json({}, HTTP_SERVER_ERROR))
    await assert.rejects(api.search({ text: 'q', type: 'track' }, { limit: 5 }), ProviderError)
  })
})

describe('searchTracks', () => {
  it('sends an isrc: filter query (S1 unverified) and returns hits', async () => {
    const { api, calls } = setup(() => json({ tracks: { items: [track()] } }))
    const hits = await api.searchTracks({ kind: 'isrc', isrc: 'us-rc1-76-07839' }, { limit: 3 })
    const call = at(calls, FIRST_CALL)
    assert.equal(call.operation, 'searchTracks')
    assert.equal(call.url.searchParams.get('q'), 'isrc:USRC17607839')
    assert.equal(call.url.searchParams.get('type'), 'track')
    assert.equal(call.url.searchParams.get('limit'), '3')
    assert.deepEqual(hits.map((h) => h.ref), [TRACK_URI])
    assert.equal(at(hits, FIRST_CALL).track.durationMs, 1234)
  })

  it('returns no hits without throwing when the isrc: filter finds nothing or is not honored (S1 unverified)', async () => {
    const { api } = setup(() => json({ tracks: { items: [], total: 0 } }))
    assert.deepEqual(await api.searchTracks({ kind: 'isrc', isrc: 'USRC17607839' }, { limit: 5 }), [])
  })

  it('ignores album/durationMs in the query text (scored by the matching engine)', async () => {
    const { api, calls } = setup(() => json({ tracks: { items: [] } }))
    await api.searchTracks({ kind: 'metadata', title: 'T', artists: ['A'], album: 'Alb', durationMs: 1000 }, { limit: 5 })
    assert.equal(at(calls, FIRST_CALL).url.searchParams.get('q'), 'T A')
  })

  it('uses title plus first artist for metadata queries', async () => {
    const { api, calls } = setup(() => json({ tracks: { items: [] } }))
    await api.searchTracks({ kind: 'metadata', title: 'Song', artists: ['A', 'B'] }, { limit: 10 })
    assert.equal(at(calls, FIRST_CALL).url.searchParams.get('q'), 'Song A')
    await api.searchTracks({ kind: 'metadata', title: 'Song', artists: [] }, { limit: 10 })
    assert.equal(at(calls, SECOND_CALL).url.searchParams.get('q'), 'Song')
  })

  it('rejects an invalid ISRC without a request', async () => {
    const { api, calls } = setup(() => json({}))
    await assert.rejects(api.searchTracks({ kind: 'isrc', isrc: 'bad" OR' }, { limit: 1 }), UsageError)
    assert.equal(calls.length, 0)
  })

  it('propagates requester errors', async () => {
    const { api } = setup(() => new AuthRequiredError('token-expired'))
    await assert.rejects(api.searchTracks({ kind: 'metadata', title: 't', artists: [] }, { limit: 1 }), AuthRequiredError)
  })
})

describe('track mapping', () => {
  it('applies the ADR-0003 fallbacks and drops unsupported items', async () => {
    const items = [
      { added_at: '2024-01-01T00:00:00Z', item: track(TRACK_ID, { name: '', artists: [], album: undefined, external_ids: {}, duration_ms: undefined }) },
      { added_at: 'x', item: { ...track(), type: 'episode' } },
      { added_at: 'x', is_local: true, item: track() },
      { added_at: 'x', item: null },
      null
    ]
    const { api } = setup(() => json({ items, total: 5 }))
    const page = await api.getPlaylistTracks(PL_ID, { limit: 100 })
    assert.equal(page.total, 5)
    assert.deepEqual(page.items, [{
      title: '(untitled)',
      artists: ['Unknown Artist'],
      isrc: null,
      refs: { spotify: TRACK_URI },
      addedAt: '2024-01-01T00:00:00Z'
    }])
  })
})

describe('listPlaylists', () => {
  const body = {
    items: [playlist(PL_ID, 'me'), playlist(OTHER_ID, 'other'), null],
    total: 120,
    next: 'https://api.spotify.com/next'
  }

  it('requests /me then /me/playlists with page params and maps ownership/readability', async () => {
    const { api, calls } = setup((call) => me(call) ?? json(body))
    const page = await api.listPlaylists({ limit: 50, offset: 50 })
    assert.equal(at(calls, FIRST_CALL).url.pathname, '/v1/me')
    const call = at(calls, SECOND_CALL)
    assert.equal(call.operation, 'listPlaylists')
    assert.equal(call.url.pathname, '/v1/me/playlists')
    assert.equal(call.url.searchParams.get('limit'), '50')
    assert.equal(call.url.searchParams.get('offset'), '50')
    assert.equal(page.total, 120)
    assert.deepEqual(page.next, { offset: 53 })
    assert.deepEqual(page.items.map((p) => [p.owned, p.itemsReadable]), [[true, true], [false, true]])
  })

  it('marks a non-owned playlist without an items key as not readable', async () => {
    const { api } = setup((call) => me(call) ?? json({ items: [playlist(OTHER_ID, 'other', { items: undefined })] }))
    const page = await api.listPlaylists({ limit: 10 })
    assert.equal(at(page.items, FIRST_CALL).itemsReadable, false)
  })

  it('filters owned/followed on the page and omits total', async () => {
    const { api } = setup((call) => me(call) ?? json(body))
    const owned = await api.listPlaylists({ limit: 50 }, 'owned')
    const followed = await api.listPlaylists({ limit: 50 }, 'followed')
    assert.deepEqual(owned.items.map((p) => p.id), [PL_ID])
    assert.deepEqual(followed.items.map((p) => p.id), [OTHER_ID])
    assert.equal(owned.total, undefined)
    assert.deepEqual(owned.next, { offset: 3 })
  })

  it('caches the current user across calls', async () => {
    const { api, calls } = setup((call) => me(call) ?? json(body))
    await api.listPlaylists({ limit: 5 })
    await api.listPlaylists({ limit: 5 })
    assert.equal(calls.filter((c) => c.url.pathname === '/v1/me').length, 1)
  })

  it('rejects malformed payloads', async () => {
    await Promise.all([{ items: 'x' }, { items: [{ id: 'short', name: 'n', owner: { id: 'o' } }] }, { items: [{ id: PL_ID, name: 'n' }] }, { items: [{ id: PL_ID, owner: { id: 'o' } }] }].map(async (bad) => {
      const { api } = respondingJson(bad, true)
      await assert.rejects(api.listPlaylists({ limit: 5 }), ProviderError)
    }))
    const noId = setup((call) => call.url.pathname === '/v1/me' ? json({}) : json(body))
    await assert.rejects(noId.api.listPlaylists({ limit: 5 }), ProviderError)
  })

  it('propagates scope errors and retries the identity lookup after a failure', async () => {
    let fail = true
    const { api } = setup((call) => {
      if (fail) {
        fail = false
        return new AuthRequiredError('missing-scope', 'playlist-read-private')
      }
      return me(call) ?? json(body)
    })
    await assert.rejects(api.listPlaylists({ limit: 5 }), AuthRequiredError)
    assert.equal((await api.listPlaylists({ limit: 5 })).items.length, 2)
  })
})

describe('getPlaylist', () => {
  it('requests the bare ID and returns metadata even when items are not readable', async () => {
    const { api, calls } = setup((call) => me(call) ?? json(playlist(OTHER_ID, 'other', { items: undefined })))
    const result = await api.getPlaylist(`spotify:playlist:${OTHER_ID}`)
    assert.equal(at(calls, SECOND_CALL).operation, 'getPlaylist')
    assert.equal(at(calls, SECOND_CALL).url.pathname, `/v1/playlists/${OTHER_ID}`)
    assert.equal(result.itemsReadable, false)
    assert.equal(result.owned, false)
    assert.equal(result.trackCount, undefined)
  })

  it('rejects non-ID refs without a request and maps 404/malformed', async () => {
    const idle = setup(() => json({}))
    await assert.rejects(idle.api.getPlaylist('../me'), NotFoundError)
    assert.equal(idle.calls.length, 0)
    const missing = setup((call) => me(call) ?? new NotFoundError('other'))
    await assert.rejects(missing.api.getPlaylist(PL_ID), (err: unknown) => err instanceof NotFoundError && err.resourceType === 'playlist')
    const bad = setup((call) => me(call) ?? json([]))
    await assert.rejects(bad.api.getPlaylist(PL_ID), ProviderError)
  })
})

describe('getPlaylistTracks', () => {
  it('requests /items with the page size cap and paginates', async () => {
    const { api, calls } = setup(() => json({ items: [{ added_at: 'a', item: track() }], total: 250, next: 'n' }))
    const page = await api.getPlaylistTracks(PL_ID, { limit: 100, offset: 100 })
    const call = at(calls, FIRST_CALL)
    assert.equal(call.operation, 'getPlaylistTracks')
    assert.equal(call.url.pathname, `/v1/playlists/${PL_ID}/items`)
    assert.equal(call.url.searchParams.get('limit'), '100')
    assert.equal(call.url.searchParams.get('offset'), '100')
    assert.deepEqual(page.next, { offset: 101 })
    assert.equal(page.total, 250)
  })

  it('accepts the legacy `track` wrapper key', async () => {
    const { api } = setup(() => json({ items: [{ added_at: 'a', track: track() }] }))
    assert.equal((await api.getPlaylistTracks(PL_ID, { limit: 5 })).items.length, 1)
  })

  it('rejects a limit above the page cap', async () => {
    const { api, calls } = setup(() => json({ items: [] }))
    await assert.rejects(api.getPlaylistTracks(PL_ID, { limit: 101 }), UsageError)
    assert.equal(calls.length, 0)
  })

  it('maps a missing/owned-but-absent playlist 404 on /items to NotFoundError(playlist), not not-owned', async () => {
    const { api } = failing(new NotFoundError('other'))
    await assert.rejects(api.getPlaylistTracks(PL_ID, { limit: 5 }), (err: unknown) =>
      err instanceof NotFoundError && err.resourceType === 'playlist' && !isNotOwned(err))
  })

  it('reports a 403 on /items as not-owned (ADR-0003 A2, S2 unverified) but keeps other errors', async () => {
    const { api } = failing(new AccessRestrictedError('other'))
    await assert.rejects(api.getPlaylistTracks(PL_ID, { limit: 5 }), isNotOwned)
    const premium = setup(() => new AccessRestrictedError('premium-required'))
    await assert.rejects(premium.api.getPlaylistTracks(PL_ID, { limit: 5 }), (err: unknown) =>
      err instanceof AccessRestrictedError && err.reason === 'premium-required')
    const scope = setup(() => new AuthRequiredError('missing-scope', 'playlist-read-private'))
    await assert.rejects(scope.api.getPlaylistTracks(PL_ID, { limit: 5 }), AuthRequiredError)
    const server = setup(() => json({}, HTTP_SERVER_ERROR))
    await assert.rejects(server.api.getPlaylistTracks(PL_ID, { limit: 5 }), ProviderError)
  })

  it('drops null-id and unavailable tracks and keeps the rest of the page', async () => {
    const other = track(OTHER_ID)
    const items = [
      { added_at: 'a', item: { name: 'no id', type: 'track' } },
      { added_at: 'a', item: 'garbage' },
      'garbage',
      { added_at: 'a', item: { ...track(), id: null, uri: null } },
      { added_at: 'a', item: other }
    ]
    const { api } = setup(() => json({ items, total: 5 }))
    const page = await api.getPlaylistTracks(PL_ID, { limit: 5 })
    assert.deepEqual(page.items.map((t) => t.refs.spotify), [`spotify:track:${OTHER_ID}`])
  })

  it('rejects malformed payloads and bad refs', async () => {
    const notArray = setup(() => json({ items: {} }))
    await assert.rejects(notArray.api.getPlaylistTracks(PL_ID, { limit: 5 }), ProviderError)
    await assert.rejects(notArray.api.getPlaylistTracks('x/y', { limit: 5 }), NotFoundError)
  })
})

describe('getLikedTracks', () => {
  it('requests /me/tracks with the liked page cap and maps addedAt', async () => {
    const { api, calls } = setup(() => json({ items: [{ added_at: '2024-02-02T00:00:00Z', track: track() }], total: 3, next: null }))
    const page = await api.getLikedTracks({ limit: 50, offset: 4 })
    const call = at(calls, FIRST_CALL)
    assert.equal(call.operation, 'getLikedTracks')
    assert.equal(call.url.pathname, '/v1/me/tracks')
    assert.equal(call.url.searchParams.get('limit'), '50')
    assert.equal(call.url.searchParams.get('offset'), '4')
    assert.equal(page.next, undefined)
    assert.equal(at(page.items, FIRST_CALL).addedAt, '2024-02-02T00:00:00Z')
  })

  it('drops null-id/unavailable liked tracks and continues', async () => {
    const items = [{ added_at: 'a', track: { name: 'x' } }, { added_at: 'b', track: null }, { added_at: 'c', track: track() }]
    const { api } = setup(() => json({ items }))
    const page = await api.getLikedTracks({ limit: 50 })
    assert.deepEqual(page.items.map((t) => t.addedAt), ['c'])
    await assert.rejects(api.getLikedTracks({ limit: 51 }), UsageError)
    await assert.rejects(api.listPlaylists({ limit: 51 }), UsageError)
  })

  it('surfaces scope and API errors and malformed payloads', async () => {
    const scope = setup(() => new AuthRequiredError('missing-scope', 'user-library-read'))
    await assert.rejects(scope.api.getLikedTracks({ limit: 5 }), (err: unknown) =>
      err instanceof AuthRequiredError && err.scope === 'user-library-read')
    const quota = setup(() => new QuotaExhaustedError('x'))
    await assert.rejects(quota.api.getLikedTracks({ limit: 5 }), QuotaExhaustedError)
    const bad = setup(() => json({ total: 1 }))
    await assert.rejects(bad.api.getLikedTracks({ limit: 5 }), ProviderError)
  })
})

describe('createPlaylist', () => {
  it('POSTs the body, passes the scope-bearing operation and maps an owned playlist', async () => {
    const { api, calls } = setup((call) => me(call) ?? json(playlist(PL_ID, 'me', { items: undefined }), HTTP_CREATED))
    const created = await api.createPlaylist({ name: 'New', description: 'd', public: false, collaborative: true })
    const call = at(calls, SECOND_CALL)
    assert.deepEqual(call.operation, { operation: 'createPlaylist', public: false, collaborative: true })
    assert.equal(call.method, 'POST')
    assert.equal(call.url.pathname, '/v1/me/playlists')
    assert.deepEqual(call.body, { name: 'New', description: 'd', public: false, collaborative: true })
    assert.equal(created.ref, PL_ID)
    assert.equal(created.owned, true)
    assert.equal(created.itemsReadable, true)
  })

  it('defaults collaborative to false and omits an absent description', async () => {
    const { api, calls } = setup((call) => me(call) ?? json(playlist(PL_ID, 'me'), HTTP_CREATED))
    await api.createPlaylist({ name: 'New', public: true })
    assert.deepEqual(at(calls, SECOND_CALL).body, { name: 'New', public: true, collaborative: false })
  })

  it('rejects public + collaborative without a request', async () => {
    const { api, calls } = setup(() => json({}))
    await assert.rejects(api.createPlaylist({ name: 'x', public: true, collaborative: true }), UsageError)
    assert.equal(calls.length, 0)
  })

  it('surfaces scope/API/malformed failures', async () => {
    const scope = setup(() => new AuthRequiredError('missing-scope', 'playlist-modify-private'))
    await assert.rejects(scope.api.createPlaylist({ name: 'x', public: false }), AuthRequiredError)
    const forbidden = setup((call) => me(call) ?? new AccessRestrictedError('other'))
    await assert.rejects(forbidden.api.createPlaylist({ name: 'x', public: false }), AccessRestrictedError)
    const bad = setup((call) => me(call) ?? json({ id: PL_ID }, HTTP_CREATED))
    await assert.rejects(bad.api.createPlaylist({ name: 'x', public: false }), ProviderError)
  })
})

describe('removePlaylist', () => {
  it('unfollows via DELETE /me/library with the playlist URI', async () => {
    const { api, calls } = setup(() => new Response(null, { status: HTTP_OK }))
    const result = await api.removePlaylist(`https://open.spotify.com/playlist/${PL_ID}`)
    const call = at(calls, FIRST_CALL)
    assert.deepEqual(result, { action: 'unfollowed' })
    assert.equal(call.operation, 'removePlaylist')
    assert.equal(call.method, 'DELETE')
    assert.equal(call.url.pathname, '/v1/me/library')
    assert.equal(call.url.searchParams.get('uris'), `spotify:playlist:${PL_ID}`)
  })

  it('rejects bad refs and surfaces failures', async () => {
    const { api, calls } = setup(() => new Response(null, { status: HTTP_SERVER_ERROR }))
    await assert.rejects(api.removePlaylist('nope'), NotFoundError)
    assert.equal(calls.length, 0)
    await assert.rejects(api.removePlaylist(PL_ID), ProviderError)
    const scope = setup(() => new AuthRequiredError('missing-scope', 'playlist-modify-public'))
    await assert.rejects(scope.api.removePlaylist(PL_ID), AuthRequiredError)
    const missing = setup(() => new NotFoundError('other'))
    await assert.rejects(missing.api.removePlaylist(PL_ID), NotFoundError)
  })
})
