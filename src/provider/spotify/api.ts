// Page limits above declared caps are clamped to the cap, keeping next/total visible.
// Search limit + offset > 1000 throws UsageError (spike S3, UNVERIFIED).
// The 100-per-request write batch and the scan page size are implementation assumptions
// (ADR-0003 §5 values, spike S3 unverified), not live-verified Spotify limits.
// Spotify Web API read/write operations behind the `Provider` interface
// (ADR-0003 §3, "Spotify endpoints used"). This module is transport-agnostic:
// it receives a `request` function that already owns the token, scope checks
// (ADR-0003 scope table, keyed by the operation name passed in), refresh,
// retry and HTTP-status error mapping (ADR-0010). Auth, `id`, `displayName`
// and `capabilities` are composed by the provider factory, not here.

import {
  AccessRestrictedError,
  AuthRequiredError,
  NotFoundError,
  ProviderError,
  QuotaExhaustedError,
  RateLimitError,
  UsageError
} from '../../core/provider/errors.ts'
import type { Provider, PageRequest, SearchType, TrackQuery } from '../../core/provider/index.ts'
import {
  SPOTIFY_MAX_LIKED_PAGE_SIZE,
  SPOTIFY_MAX_PLAYLISTS_PAGE_SIZE,
  SPOTIFY_MAX_PLAYLIST_ITEMS_PAGE_SIZE,
  SPOTIFY_MAX_SEARCH_PAGE_SIZE,
  SPOTIFY_MAX_TRACKS_PER_REQUEST
} from './api-capabilities.ts'
import {
  isObject,
  malformed,
  mapPlaylist,
  mapSearchItem,
  mapTrackWrapper,
  parsePlaylistRef,
  parseTrackRef,
  readPaging,
  toPage
} from './api-mappers.ts'

/** Operation names match the ADR-0003 scope table; the requester derives required scopes from them. */
export type SpotifyApiOperation =
  | 'search'
  | 'listPlaylists'
  | 'getPlaylist'
  | 'getPlaylistTracks'
  | 'getLikedTracks'
  | { operation: 'createPlaylist', public: boolean, collaborative?: boolean }
  | 'updatePlaylist'
  | 'removePlaylist'
  | 'populatePlaylist'
  | 'searchTracks'

export type SpotifyApiRequest = (
  operation: SpotifyApiOperation,
  method: string,
  path: string,
  init?: Omit<RequestInit, 'method'>
) => Promise<Response>

/** The `Provider` members this module implements; the rest (`id`, `displayName`, `capabilities`, `auth`) belong to the provider factory. */
export type SpotifyApiOperations = Omit<Provider, 'id' | 'displayName' | 'capabilities' | 'auth'>

const NO_OFFSET = 0
const NO_CHANGES = 0
const MIN_LIMIT = 1
// Spike S3 (UNVERIFIED, ADR-0003 Amendment 1): search `limit + offset <= 1000`.
const SEARCH_WINDOW_LIMIT = 1000
// Implementation choice: the page size used when scanning existing items for `skipExisting`.
const SCAN_PAGE_SIZE = SPOTIFY_MAX_PLAYLIST_ITEMS_PAGE_SIZE

/**
 * Validates paging input and clamps limits above declared caps.
 * Search keeps the limit + offset <= 1000 safety guard (S3 unverified).
 */
function clampPage (page: PageRequest, max: number, searchWindow = false): { limit: number, offset: number } {
  if (page.cursor !== undefined) {
    throw new UsageError('Spotify uses offset pagination; a cursor is not supported')
  }
  const offset = page.offset ?? NO_OFFSET
  if (!Number.isInteger(page.limit) || page.limit < MIN_LIMIT) {
    throw new UsageError('Page limit must be a positive integer')
  }
  if (!Number.isInteger(offset) || offset < NO_OFFSET) {
    throw new UsageError('Page offset must be a non-negative integer')
  }
  const limit = Math.min(page.limit, max)
  if (searchWindow && limit + offset > SEARCH_WINDOW_LIMIT) {
    throw new UsageError(`Search limit + offset must not exceed ${SEARCH_WINDOW_LIMIT}`)
  }
  return { limit, offset }
}

function pagedPath (base: string, params: { limit: number, offset: number }, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams({ ...extra, limit: String(params.limit), offset: String(params.offset) })
  return `${base}?${query.toString()}`
}

function requirePlaylistId (ref: string): string {
  const id = parsePlaylistRef(ref)
  if (id === null) {
    throw new NotFoundError('playlist')
  }
  return id
}

async function readJson (response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new ProviderError(`Spotify API request failed (HTTP ${response.status})`)
  }
  try {
    return await response.json()
  } catch {
    throw malformed('body is not valid JSON')
  }
}

function isPropagatedPopulateError (err: unknown): boolean {
  return err instanceof AuthRequiredError || err instanceof QuotaExhaustedError || err instanceof RateLimitError
}

function errorMessage (err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function trackQueryText (query: TrackQuery): string {
  if (query.kind === 'isrc') {
    // isrcSearchMode is 'none' (owner decision, M1 spike S1): ISRC queries are never sent to Spotify.
    throw new UsageError('Spotify does not support ISRC search')
  }
  // `album` and `durationMs` are deliberately not sent: the search text is title + first artist
  // (ADR-0003 endpoint table); the matching engine uses those fields to score the returned hits.
  const firstArtist = query.artists.at(NO_OFFSET)
  return firstArtist === undefined ? query.title : `${query.title} ${firstArtist}`
}

/**
 * Splits input into canonical refs to add and invalid refs (pushed to `failed`).
 * With `skipExisting`, refs already present or repeated in the input are left out (neither added nor failed).
 */
function planPopulate (
  trackRefs: string[],
  existing: Set<string>,
  skipExisting: boolean,
  failed: Array<{ ref: string, error: string }>
): string[] {
  const valid: string[] = []
  const seen = new Set<string>()
  for (const trackRef of trackRefs) {
    const canonical = parseTrackRef(trackRef)
    if (canonical === null || !trackRef.startsWith('spotify:track:')) {
      failed.push({ ref: trackRef, error: 'Not a Spotify track URI' })
    } else if (!skipExisting || !(existing.has(canonical) || seen.has(canonical))) {
      seen.add(canonical)
      valid.push(canonical)
    }
  }
  return valid
}

export function createSpotifyApiOperations (request: SpotifyApiRequest): SpotifyApiOperations {
  let currentUserId: Promise<string> | null = null

  const getJson = async (operation: SpotifyApiOperation, path: string): Promise<unknown> =>
    await readJson(await request(operation, 'GET', path))

  const loadCurrentUserId = async (operation: SpotifyApiOperation): Promise<string> => {
    const body = await getJson(operation, '/v1/me')
    if (!isObject(body) || typeof body.id !== 'string' || body.id.length === NO_OFFSET) {
      throw malformed('current user has no id')
    }
    return body.id
  }

  const userId = async (operation: SpotifyApiOperation): Promise<string> => {
    currentUserId ??= loadCurrentUserId(operation).catch((err: unknown) => {
      currentUserId = null
      throw err
    })
    return await currentUserId
  }

  const search = async (
    operation: 'search' | 'searchTracks',
    q: string,
    type: SearchType,
    page: PageRequest
  ): ReturnType<SpotifyApiOperations['search']> => {
    const params = clampPage(page, SPOTIFY_MAX_SEARCH_PAGE_SIZE, true)
    const body = await getJson(operation, pagedPath('/v1/search', params, { q, type }))
    const section = isObject(body) ? body[`${type}s`] : undefined
    const raw = readPaging(section, `search ${type}s`)
    const items = raw.items.flatMap((entry) => {
      const mapped = mapSearchItem(type, entry)
      return mapped === null ? [] : [mapped]
    })
    return toPage(raw, items, params.offset)
  }

  const readPlaylistItems = async (
    operation: 'getPlaylistTracks' | 'populatePlaylist',
    id: string,
    params: { limit: number, offset: number }
  ): Promise<unknown> => await getJson(operation, pagedPath(`/v1/playlists/${id}/items`, params))

  const existingTrackRefs = async (id: string): Promise<Set<string>> => {
    const refs = new Set<string>()
    let offset = NO_OFFSET
    for (;;) {
      const body = await readPlaylistItems('populatePlaylist', id, { limit: SCAN_PAGE_SIZE, offset }) // eslint-disable-line no-await-in-loop -- sequential: each page depends on the previous offset
      const raw = readPaging(body, 'playlist items')
      for (const entry of raw.items) {
        const ref = mapTrackWrapper(entry)?.refs.spotify
        const canonical = ref === undefined ? null : parseTrackRef(ref)
        if (canonical !== null) {
          refs.add(canonical)
        }
      }
      if (!raw.hasNext || raw.items.length === NO_OFFSET) {
        return refs
      }
      offset += raw.items.length
    }
  }

  const api: SpotifyApiOperations = {
    search: async (q, page) => await search('search', q.text, q.type, page),

    parsePlaylistRef,
    parseTrackRef,

    listPlaylists: async (page, filter) => {
      const params = clampPage(page, SPOTIFY_MAX_PLAYLISTS_PAGE_SIZE)
      const me = await userId('listPlaylists')
      const raw = readPaging(await getJson('listPlaylists', pagedPath('/v1/me/playlists', params)), 'playlists')
      const all = raw.items.flatMap((entry) => entry === null ? [] : [mapPlaylist(entry, me)])
      if (filter === undefined) {
        return toPage(raw, all, params.offset)
      }
      const kept = all.filter((p) => filter === 'owned' ? p.owned : !p.owned)
      const { total: _total, ...page_ } = toPage(raw, kept, params.offset)
      return page_
    },

    getPlaylist: async (ref) => {
      const id = requirePlaylistId(ref)
      const me = await userId('getPlaylist')
      const body = await getJson('getPlaylist', `/v1/playlists/${id}`).catch((err: unknown) => {
        if (err instanceof NotFoundError) {
          throw new NotFoundError('playlist')
        }
        throw err
      })
      return mapPlaylist(body, me)
    },

    getPlaylistTracks: async (ref, page) => {
      const id = requirePlaylistId(ref)
      const params = clampPage(page, SPOTIFY_MAX_PLAYLIST_ITEMS_PAGE_SIZE)
      const body = await readPlaylistItems('getPlaylistTracks', id, params).catch((err: unknown) => {
        // ADR-0003 Amendment 2 (spike S2, UNVERIFIED): Spotify /items 403 and 404 both map to
        // AccessRestrictedError('not-owned'). S2 remains unverified; this is the chosen contract.
        if (err instanceof NotFoundError || (err instanceof AccessRestrictedError && err.reason === 'other')) {
          throw new AccessRestrictedError('not-owned')
        }
        throw err
      })
      const raw = readPaging(body, 'playlist items')
      const tracks = raw.items.flatMap((entry) => {
        const track = mapTrackWrapper(entry)
        return track === null ? [] : [track]
      })
      return toPage(raw, tracks, params.offset)
    },

    getLikedTracks: async (page) => {
      const params = clampPage(page, SPOTIFY_MAX_LIKED_PAGE_SIZE)
      const raw = readPaging(await getJson('getLikedTracks', pagedPath('/v1/me/tracks', params)), 'liked tracks')
      const tracks = raw.items.flatMap((entry) => {
        const track = mapTrackWrapper(entry)
        return track === null ? [] : [track]
      })
      return toPage(raw, tracks, params.offset)
    },

    createPlaylist: async (input) => {
      const collaborative = input.collaborative === true
      if (collaborative && input.public) {
        throw new UsageError('A collaborative playlist cannot be public')
      }
      const me = await userId({ operation: 'createPlaylist', public: input.public, collaborative })
      const response = await request(
        { operation: 'createPlaylist', public: input.public, collaborative },
        'POST',
        '/v1/me/playlists',
        {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: input.name,
            ...(input.description === undefined ? {} : { description: input.description }),
            public: input.public,
            collaborative
          })
        }
      )
      return mapPlaylist(await readJson(response), me, true)
    },

    updatePlaylist: async (ref, patch) => {
      const id = requirePlaylistId(ref)
      const body = {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.description === undefined ? {} : { description: patch.description }),
        ...(patch.public === undefined ? {} : { public: patch.public })
      }
      if (Object.keys(body).length === NO_CHANGES) {
        throw new UsageError('updatePlaylist requires at least one of name, description, public')
      }
      const response = await request('updatePlaylist', 'PUT', `/v1/playlists/${id}`, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!response.ok) {
        throw new ProviderError(`Spotify API request failed (HTTP ${response.status})`)
      }
      // The PUT returns an empty body, so re-read the playlist for the canonical summary.
      return await api.getPlaylist(id)
    },

    removePlaylist: async (ref) => {
      const id = requirePlaylistId(ref)
      const query = new URLSearchParams({ uris: `spotify:playlist:${id}` })
      const response = await request('removePlaylist', 'DELETE', `/v1/me/library?${query.toString()}`)
      if (!response.ok) {
        throw new ProviderError(`Spotify API request failed (HTTP ${response.status})`)
      }
      return { action: 'unfollowed' }
    },

    searchTracks: async (query, opts) => {
      const page = await search('searchTracks', trackQueryText(query), 'track', { limit: opts.limit })
      return page.items.flatMap((item) => item.type === 'track' ? [{ ref: item.ref, track: item.track }] : [])
    },

    populatePlaylist: async (ref, trackRefs, opts) => {
      const id = requirePlaylistId(ref)
      const added: string[] = []
      const failed: Array<{ ref: string, error: string }> = []
      const existing = opts.skipExisting ? await existingTrackRefs(id) : new Set<string>()
      const valid = planPopulate(trackRefs, existing, opts.skipExisting, failed)
      for (let start = NO_OFFSET; start < valid.length; start += SPOTIFY_MAX_TRACKS_PER_REQUEST) {
        const batch = valid.slice(start, start + SPOTIFY_MAX_TRACKS_PER_REQUEST)
        try {
          // eslint-disable-next-line no-await-in-loop -- batches must be added in order, one request at a time
          const response = await request('populatePlaylist', 'POST', `/v1/playlists/${id}/items`, {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ uris: batch })
          })
          if (!response.ok) {
            throw new ProviderError(`Spotify API request failed (HTTP ${response.status})`)
          }
          added.push(...batch)
        } catch (err) {
          if (isPropagatedPopulateError(err)) {
            throw err
          }
          const error = errorMessage(err)
          failed.push(...batch.map((batchRef) => ({ ref: batchRef, error })))
        }
      }
      return { added, failed }
    }
  }
  return api
}

