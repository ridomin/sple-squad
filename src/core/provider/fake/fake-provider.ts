// The in-memory `fake` provider (ADR-0003 §3.1, §5; PRV-6). Implements the
// full `Provider` interface against seed fixtures with no network and no
// real auth — just enough in-memory state to drive every member once, for
// tests and for exercising the CLI end-to-end before real adapters land.
//
// Capability defaults match ADR-0003 §5 ("The fake provider defaults to
// ..."); every value is overridable per-instance so tests can cover
// `owned-only`, `cursor-forward`, `daily-buckets`, etc. (ADR-0003
// Consequences).

import type { CanonicalTrack } from '../../canonical-track.ts'
import type { ProviderCapabilities } from '../capabilities.ts'
import type {
  AuthStatus,
  Page,
  PageRequest,
  PlaylistSummary,
  Provider,
  SearchItem,
  TrackHit,
  TrackQuery
} from '../provider.ts'
import { AccessRestrictedError, NotFoundError } from '../errors.ts'
import type { FakePlaylistFixture, FakeProviderFixtures, FakeTrackFixture } from './fixtures.ts'
import { normalizeFixtures } from './fixtures.ts'

const FAKE_PROVIDER_ID = 'fake'
const DEFAULT_DISPLAY_NAME = 'Fake Provider'
const RADIX_DECIMAL = 10
const FIRST_PLAYLIST_ID = 1
const EMPTY_SIZE = 0
const ID_INCREMENT = 1
const DEFAULT_OFFSET = 0

const DEFAULT_MAX_SEARCH_PAGE_SIZE = 50
const DEFAULT_READ_PAGE_SIZE_PLAYLISTS = 50
const DEFAULT_READ_PAGE_SIZE_PLAYLIST_ITEMS = 100
const DEFAULT_READ_PAGE_SIZE_LIKED = 50
const DEFAULT_MAX_TRACKS_PER_REQUEST = 100

/** ADR-0003 §5: the fake provider's declared defaults. Every field can be overridden per-instance. */
export const DEFAULT_FAKE_CAPABILITIES: ProviderCapabilities = {
  official: false,
  requiresRiskAcknowledgement: false,
  userSuppliedClientId: true,
  requiresClientSecret: false,
  supportsRefreshToken: true,
  supportsRevocation: true,
  paginationModel: 'offset',
  maxSearchPageSize: DEFAULT_MAX_SEARCH_PAGE_SIZE,
  readPageSize: {
    playlists: DEFAULT_READ_PAGE_SIZE_PLAYLISTS,
    playlistItems: DEFAULT_READ_PAGE_SIZE_PLAYLIST_ITEMS,
    liked: DEFAULT_READ_PAGE_SIZE_LIKED
  },
  playlistItemsAccess: 'all',
  likedSongs: { read: 'exact', write: false },
  isrcSearchMode: 'none',
  searchReturnsDuration: true,
  musicAwareSearch: false,
  canDeletePlaylist: true,
  supportsCollaborative: true,
  maxTracksPerRequest: DEFAULT_MAX_TRACKS_PER_REQUEST,
  quotaModel: { kind: 'rate-limited' }
}

export interface CreateFakeProviderOptions {
  fixtures?: FakeProviderFixtures
  /** Merged over `DEFAULT_FAKE_CAPABILITIES`; only the overridden fields need to be given. */
  capabilities?: Partial<ProviderCapabilities>
  displayName?: string
}

function trackRef (id: string): string {
  return `fake:track:${id}`
}

function toCanonicalTrack (fixture: FakeTrackFixture): CanonicalTrack {
  const { title, artists, album, durationMs, isrc, addedAt, id } = fixture
  return {
    title,
    artists,
    refs: { [FAKE_PROVIDER_ID]: trackRef(id) },
    ...(album === undefined ? {} : { album }),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(isrc === undefined ? {} : { isrc }),
    ...(addedAt === undefined ? {} : { addedAt })
  }
}

interface InternalPlaylist {
  summary: PlaylistSummary
  /** Track refs (`fake:track:<id>`), in playlist order. */
  trackRefs: string[]
}

function toPlaylistSummary (fixture: FakePlaylistFixture): PlaylistSummary {
  const { id, name, owner, trackIds, description, public: isPublic, collaborative, owned: fixtureOwned, itemsReadable: fixtureItemsReadable } = fixture
  const owned = fixtureOwned ?? true
  return {
    ref: id,
    id,
    name,
    owner,
    owned,
    itemsReadable: fixtureItemsReadable ?? owned,
    trackCount: trackIds.length,
    ...(description === undefined ? {} : { description }),
    ...(isPublic === undefined ? {} : { public: isPublic }),
    ...(collaborative === undefined ? {} : { collaborative })
  }
}

/** Slices `items` per `PageRequest` (offset pagination) and fills in `next`/`total` (ADR-0003 §3). */
function paginate<T> (items: readonly T[], request: PageRequest): Page<T> {
  const { limit } = request
  const offset = request.offset ?? DEFAULT_OFFSET
  const slice = items.slice(offset, offset + limit)
  const page: Page<T> = { items: slice, total: items.length }
  if (offset + limit < items.length) {
    page.next = { offset: offset + limit }
  }
  return page
}

/** Builds a fresh in-memory `fake` `Provider` from seed fixtures (ADR-0003 §3.1, §5, PRV-6). No shared state across instances. */
export function createFakeProvider (options: CreateFakeProviderOptions = {}): Provider {
  const { fixtures: fixturesOption, capabilities: capabilityOverrides, displayName: displayNameOption } = options
  const fixtures = normalizeFixtures(fixturesOption ?? {})
  const capabilities: ProviderCapabilities = { ...DEFAULT_FAKE_CAPABILITIES, ...capabilityOverrides }
  const displayName = displayNameOption ?? DEFAULT_DISPLAY_NAME

  const catalogByRef = new Map<string, FakeTrackFixture>(
    fixtures.catalog.map((fixture) => [trackRef(fixture.id), fixture])
  )
  const playlists = new Map<string, InternalPlaylist>(
    fixtures.playlists.map((fixture) => {
      for (const trackId of fixture.trackIds) {
        if (!catalogByRef.has(trackRef(trackId))) {
          throw new Error(`Fake provider fixture error: playlist '${fixture.id}' references unknown track id '${trackId}'`)
        }
      }
      return [fixture.id, { summary: toPlaylistSummary(fixture), trackRefs: fixture.trackIds.map(trackRef) }]
    })
  )
  const likedRefs: string[] = fixtures.liked.map((id) => {
    if (!catalogByRef.has(trackRef(id))) {
      throw new Error(`Fake provider fixture error: liked tracks reference unknown track id '${id}'`)
    }
    return trackRef(id)
  })

  let nextPlaylistId = playlists.size === EMPTY_SIZE
    ? FIRST_PLAYLIST_ID
    : Math.max(...Array.from(playlists.keys(), (id) => Number.parseInt(id, RADIX_DECIMAL))) + ID_INCREMENT

  let authState: AuthStatus = { loggedIn: false, scopes: [] }

  function findPlaylist (ref: string): InternalPlaylist {
    const playlist = playlists.get(ref)
    if (playlist === undefined) {
      throw new NotFoundError('playlist', `No fake playlist with ref '${ref}'`)
    }
    return playlist
  }

  function findCatalogTrack (ref: string): FakeTrackFixture {
    const fixture = catalogByRef.get(ref)
    if (fixture === undefined) {
      throw new Error(`Fake provider internal error: track ref '${ref}' missing from catalog`)
    }
    return fixture
  }

  function catalogTracks (): FakeTrackFixture[] {
    return Array.from(catalogByRef.values())
  }

  function matchesMetadataQuery (fixture: FakeTrackFixture, query: Extract<TrackQuery, { kind: 'metadata' }>): boolean {
    const { title } = fixture
    const titleLower = title.toLowerCase()
    const queryTitleLower = query.title.toLowerCase()
    return titleLower.includes(queryTitleLower) || queryTitleLower.includes(titleLower)
  }

  function searchCatalogTracks (text: string): SearchItem[] {
    const queryLower = text.toLowerCase()
    return catalogTracks()
      .filter((fixture) => fixture.title.toLowerCase().includes(queryLower))
      .map((fixture) => ({
        type: 'track',
        id: fixture.id,
        ref: trackRef(fixture.id),
        name: fixture.title,
        track: toCanonicalTrack(fixture)
      }))
  }

  function searchPlaylists (text: string): SearchItem[] {
    const queryLower = text.toLowerCase()
    const items: SearchItem[] = []
    for (const playlist of playlists.values()) {
      const { summary } = playlist
      const { id, ref, name, owner, trackCount } = summary
      if (!name.toLowerCase().includes(queryLower)) {
        continue
      }
      items.push({ type: 'playlist', id, ref, name, owner, ...(trackCount === undefined ? {} : { trackCount }) })
    }
    return items
  }

  function searchAlbums (text: string): SearchItem[] {
    const queryLower = text.toLowerCase()
    const seen = new Set<string>()
    const items: SearchItem[] = []
    for (const fixture of catalogTracks()) {
      const { album, artists } = fixture
      if (album === undefined || !album.toLowerCase().includes(queryLower) || seen.has(album)) {
        continue
      }
      seen.add(album)
      items.push({ type: 'album', id: album, ref: `fake:album:${album}`, name: album, artists })
    }
    return items
  }

  function searchArtists (text: string): SearchItem[] {
    const queryLower = text.toLowerCase()
    const seen = new Set<string>()
    const items: SearchItem[] = []
    for (const fixture of catalogTracks()) {
      for (const artist of fixture.artists) {
        if (!artist.toLowerCase().includes(queryLower) || seen.has(artist)) {
          continue
        }
        seen.add(artist)
        items.push({ type: 'artist', id: artist, ref: `fake:artist:${artist}`, name: artist })
      }
    }
    return items
  }

  return {
    id: FAKE_PROVIDER_ID,
    displayName,
    capabilities,

    auth: {
      login: async (opts) => {
        const { scopes } = opts
        authState = { loggedIn: true, user: fixtures.user, scopes }
        return await Promise.resolve(authState)
      },
      status: async () => await Promise.resolve(authState),
      logout: async () => {
        authState = { loggedIn: false, scopes: [] }
        return await Promise.resolve({ revoked: true, deletedData: ['fake-session'] })
      }
    },

    search: async (q, page) => {
      const { type, text } = q
      const { limit, offset } = page
      const effectiveLimit = Math.min(limit, capabilities.maxSearchPageSize)
      const request: PageRequest = offset === undefined ? { limit: effectiveLimit } : { limit: effectiveLimit, offset }

      const items: SearchItem[] = type === 'track'
        ? searchCatalogTracks(text)
        : type === 'playlist'
          ? searchPlaylists(text)
          : type === 'album'
            ? searchAlbums(text)
            : searchArtists(text)

      return await Promise.resolve(paginate(items, request))
    },

    parsePlaylistRef: (input) => {
      const prefixed = /^fake:playlist:(?<id>\d+)$/v.exec(input)
      const id = prefixed?.groups?.id
      if (id !== undefined) {
        return id
      }
      return /^\d+$/v.test(input) ? input : null
    },

    parseTrackRef: (input) => (/^fake:track:\d+$/v.test(input) ? input : null),

    listPlaylists: async (page, filter) => {
      const all = Array.from(playlists.values(), (playlist) => playlist.summary)
      const filtered = filter === undefined
        ? all
        : all.filter((summary) => (filter === 'owned' ? summary.owned : !summary.owned))
      return await Promise.resolve(paginate(filtered, page))
    },

    getPlaylist: async (ref) => await Promise.resolve(findPlaylist(ref).summary),

    getPlaylistTracks: async (ref, page) => {
      const playlist = findPlaylist(ref)
      if (!playlist.summary.itemsReadable) {
        throw new AccessRestrictedError('not-owned', `Playlist '${ref}' is not readable`)
      }
      const tracks = playlist.trackRefs.map((trackRefValue) => toCanonicalTrack(findCatalogTrack(trackRefValue)))
      return await Promise.resolve(paginate(tracks, page))
    },

    getLikedTracks: async (page) => {
      const tracks = likedRefs.map((ref) => toCanonicalTrack(findCatalogTrack(ref)))
      return await Promise.resolve(paginate(tracks, page))
    },

    createPlaylist: async (input) => {
      const { name, description, public: isPublic, collaborative } = input
      const id = String(nextPlaylistId)
      nextPlaylistId += ID_INCREMENT

      if (collaborative !== undefined && !capabilities.supportsCollaborative) {
        throw new Error('Fake provider: collaborative playlists are not supported by this capability set')
      }

      const summary: PlaylistSummary = {
        ref: id,
        id,
        name,
        owner: fixtures.user,
        owned: true,
        itemsReadable: true,
        trackCount: EMPTY_SIZE,
        public: isPublic,
        ...(description === undefined ? {} : { description }),
        ...(collaborative === undefined ? {} : { collaborative })
      }
      playlists.set(id, { summary, trackRefs: [] })
      return await Promise.resolve(summary)
    },

    updatePlaylist: async (ref, patch) => {
      const playlist = findPlaylist(ref)
      const { name, description, public: isPublic } = patch
      if (name !== undefined) {
        playlist.summary.name = name
      }
      if (description !== undefined) {
        playlist.summary.description = description
      }
      if (isPublic !== undefined) {
        playlist.summary.public = isPublic
      }
      return await Promise.resolve(playlist.summary)
    },

    removePlaylist: async (ref) => {
      findPlaylist(ref)
      playlists.delete(ref)
      return await Promise.resolve({ action: capabilities.canDeletePlaylist ? 'deleted' : 'unfollowed' })
    },

    searchTracks: async (query, opts) => {
      const { limit } = opts
      const hits: TrackHit[] = catalogTracks()
        .filter((fixture) => (query.kind === 'isrc'
          ? fixture.isrc !== undefined && fixture.isrc !== null && fixture.isrc === query.isrc
          : matchesMetadataQuery(fixture, query)))
        .map((fixture) => ({ ref: trackRef(fixture.id), track: toCanonicalTrack(fixture) }))
        .slice(DEFAULT_OFFSET, limit)
      return await Promise.resolve(hits)
    },

    populatePlaylist: async (ref, trackRefsToAdd, opts) => {
      const { skipExisting } = opts
      const playlist = findPlaylist(ref)
      const { trackRefs } = playlist
      const added: string[] = []
      const failed: Array<{ ref: string, error: string }> = []
      const { maxTracksPerRequest: batchSize } = capabilities

      for (let batchStart = 0; batchStart < trackRefsToAdd.length; batchStart += batchSize) {
        const batch = trackRefsToAdd.slice(batchStart, batchStart + batchSize)
        for (const candidateRef of batch) {
          if (skipExisting && trackRefs.includes(candidateRef)) {
            continue
          }
          if (!catalogByRef.has(candidateRef)) {
            failed.push({ ref: candidateRef, error: `Unknown fake track ref: ${candidateRef}` })
            continue
          }
          trackRefs.push(candidateRef)
          added.push(candidateRef)
        }
      }
      const { length: trackCount } = trackRefs
      playlist.summary.trackCount = trackCount
      return await Promise.resolve({ added, failed })
    }
  }
}
