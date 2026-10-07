// The `Provider` interface and its supporting types (ADR-0003 §3, incl.
// Amendment 2 — `readPageSize`, `parseTrackRef`, `searchTracks`,
// `MatchCandidate`, `TrackQuery`). `CanonicalTrack` is defined once, in
// `../canonical-track.ts` (ADR-0005/#5); it is imported here, not redeclared.

import type { CanonicalTrack } from '../canonical-track.ts'
import type { ProviderCapabilities, ProviderId } from './capabilities.ts'

export interface PageRequest {
  limit: number
  offset?: number
  cursor?: string
}

export interface Page<T> {
  items: T[]
  next?: { offset?: number, cursor?: string }
  total?: number
}

export interface PlaylistSummary {
  /** Opaque provider ref accepted by `getPlaylist` etc. (Spotify: the bare 22-char playlist ID; §3.1). */
  ref: string
  id: string
  name: string
  description?: string
  owner: { id: string, displayName?: string }
  /** FR-PL-1. */
  owned: boolean
  /**
   * `false` when not owned and `playlistItemsAccess === 'owned-only'`, or
   * when the non-owned playlist is not readable (Amendment 1). Spotify
   * readability is probed at read time (Amendment 2): a non-owned playlist
   * is readable when `GET /playlists/{id}` includes an `items` key; a later
   * 403/404 on `/items` turns it into `AccessRestrictedError('not-owned')`.
   */
  itemsReadable: boolean
  trackCount?: number
  public?: boolean
  collaborative?: boolean
  url?: string
}

/** FR-SEARCH-4 (Amendment 1): what a `search` call can look for. */
export type SearchType = 'track' | 'album' | 'artist' | 'playlist'

interface SearchItemBase {
  id: string
  /** Opaque provider ref for this item (§3.1). */
  ref: string
  url?: string
  name: string
}

/**
 * One `search` result, discriminated on `type` (FR-SEARCH-4, Amendment 1) so
 * the CLI renders and serializes results without casts or provider
 * knowledge. Adapters map provider payloads to `SearchItem` themselves; a
 * new search type is an ADR amendment.
 */
export type SearchItem =
  | (SearchItemBase & { type: 'track', track: CanonicalTrack })
  | (SearchItemBase & { type: 'album', artists: string[], releaseDate?: string, trackCount?: number })
  | (SearchItemBase & { type: 'artist' })
  | (SearchItemBase & { type: 'playlist', owner: { id: string, displayName?: string }, trackCount?: number })

/**
 * Input to `searchTracks` (Amendment 2). The adapter turns it into its own
 * query syntax; core never builds provider query strings.
 */
export type TrackQuery =
  // Only sent when `isrcSearchMode !== 'none'`.
  | { kind: 'isrc', isrc: string }
  | { kind: 'metadata', title: string, artists: string[], album?: string, durationMs?: number }

/** One `searchTracks` result. `ref` is a canonical track ref for this provider (§3.1). */
export interface TrackHit {
  ref: string
  track: CanonicalTrack
}

/** The single candidate type, used by the matching engine and the match report (ADR 0009). */
export interface MatchCandidate {
  ref: string
  track: CanonicalTrack
  confidence: number
  strategy: 'known-ref' | 'isrc' | 'metadata'
}

export interface AuthStatus {
  loggedIn: boolean
  user?: { id: string, displayName?: string }
  scopes: string[]
  expiresAt?: string
}

/** How the CLI drives interactive steps (`showAuthorizationUrl`, `promptForRedirectUrl`) during `login` (ADR 0010), kept out of the adapter. */
export interface AuthLoginInteraction {
  showAuthorizationUrl: (url: string, mode: 'loopback' | 'no-browser' | 'manual') => void | Promise<void>
  promptForRedirectUrl: (prompt: string) => Promise<string>
}

export interface ProviderAuth {
  login: (opts: {
    mode: 'loopback' | 'no-browser' | 'manual'
    scopes: string[]
    interaction?: AuthLoginInteraction
  }) => Promise<AuthStatus>
  status: () => Promise<AuthStatus>
  /** FR-AUTH-4. May return a `notice` line for the user (e.g. how to revoke manually). */
  logout: () => Promise<{ revoked: boolean, deletedData: string[], notice?: string }>
}

export interface Provider {
  readonly id: ProviderId
  readonly displayName: string
  readonly capabilities: ProviderCapabilities
  readonly auth: ProviderAuth

  search: (q: { text: string, type: SearchType }, page: PageRequest) => Promise<Page<SearchItem>>
  /** Returns a provider ref if `input` is an ID, URI, or URL for this provider; otherwise `null` (caller falls back to name lookup). Pure, no I/O. */
  parsePlaylistRef: (input: string) => string | null
  /** Returns the canonical track ref (§3.1) if `input` is a track ID, URI, or URL for this provider; otherwise `null`. Pure, no I/O (Amendment 2). */
  parseTrackRef: (input: string) => string | null
  /** `filter` is applied on `PlaylistSummary.owned`; a filtered page may hold fewer than `limit` items and omits `total`. */
  listPlaylists: (page: PageRequest, filter?: 'owned' | 'followed') => Promise<Page<PlaylistSummary>>
  /** Returns metadata even when `!itemsReadable`. */
  getPlaylist: (ref: string) => Promise<PlaylistSummary>
  /** Throws `AccessRestrictedError` if `!itemsReadable`; drops unsupported items, `total` counts all items. */
  getPlaylistTracks: (ref: string, page: PageRequest) => Promise<Page<CanonicalTrack>>
  getLikedTracks: (page: PageRequest) => Promise<Page<CanonicalTrack>>
  createPlaylist: (input: { name: string, description?: string, public: boolean, collaborative?: boolean }) => Promise<PlaylistSummary>
  /** FR-PL-5 (S). */
  updatePlaylist?: (ref: string, patch: { name?: string, description?: string, public?: boolean }) => Promise<PlaylistSummary>
  removePlaylist: (ref: string) => Promise<{ action: 'deleted' | 'unfollowed' }>
  /**
   * Catalog track search for matching (ADR 0009). Returns at most `limit`
   * hits in the provider's relevance order. Durations are filled in when the
   * provider has them (`searchReturnsDuration === false` => the adapter
   * fetches details).
   */
  searchTracks: (query: TrackQuery, opts: { limit: number }) => Promise<TrackHit[]>
  /**
   * Internal: used only by import/migrate (scope note §4.3). Never exposed
   * as a command. Adds in the given order, in batches of
   * `maxTracksPerRequest`.
   */
  populatePlaylist: (ref: string, trackRefs: string[], opts: { skipExisting: boolean }) => Promise<{ added: string[], failed: Array<{ ref: string, error: string }> }>
}
