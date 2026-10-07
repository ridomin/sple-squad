// Capability declaration types (ADR-0003 §1, §5). One type,
// `ProviderCapabilities`, is the single source of truth for what a provider
// can do; the CLI and core read capabilities and never branch on provider
// IDs (PRV-5).

/** The closed set of providers sple knows about. The fake provider (`'fake'`) is test-only (ADR-0003 Amendment 2). */
export type ProviderId = 'spotify' | 'youtube-music' | 'fake'

/** Operations a `Provider` may support, used as keys into `QuotaModel`'s `daily-buckets` costs. */
export type ProviderOperation =
  | 'search' | 'searchTracks' | 'getTrackDetails'
  | 'listPlaylists' | 'getPlaylistItems'
  | 'createPlaylist' | 'updatePlaylist' | 'removePlaylist' | 'populatePlaylist'
  | 'readLiked'

/** A daily quota bucket (e.g. YouTube Data API `'units'`). */
export interface QuotaBucket {
  /** Bucket identifier referenced by `QuotaCost.bucket`, e.g. `'units'`, `'search'`. */
  id: string
  /** Default daily limit; user-overridable in config. */
  dailyLimit: number
  /** IANA time zone the daily reset is computed in, e.g. `'America/Los_Angeles'`. */
  resetTimeZone: string
}

/** The quota cost of one `ProviderOperation`, charged against a `QuotaBucket`. */
export interface QuotaCost {
  /** `QuotaBucket.id` this cost is charged against. */
  bucket: string
  amount: number
  per: 'call' | 'page' | 'item'
  /** Only meaningful when `per === 'page'`. */
  pageSize?: number
}

/** How a provider enforces usage limits (PRV-4, FR-MIG-5). */
export type QuotaModel =
  // 429 + Retry-After only; no documented daily budget (e.g. Spotify).
  | { kind: 'rate-limited' }
  // A documented set of daily buckets with per-operation costs (e.g. YouTube Data API).
  | { kind: 'daily-buckets', buckets: QuotaBucket[], costs: Partial<Record<ProviderOperation, QuotaCost[]>> }
  // Reserved for NFR-7 opt-in providers with no documented quota; unused today.
  | { kind: 'undocumented', minDelayMs: number, maxBatch: number }

/** Page size a provider returns for each kind of read (ADR-0003 Amendment 2). Reads only; writes use `maxTracksPerRequest`. */
export interface ReadPageSize {
  playlists: number
  playlistItems: number
  liked: number
}

/** How much of `getLikedTracks` a provider can read, and whether writing likes is supported (out of scope today). */
export interface LikedSongsCapability {
  read: 'exact' | 'approximate' | 'none'
  /** Always `false`: writing likes is out of scope (requirements §9); lifting it needs a new ADR. */
  write: false
  /** Only meaningful when `read === 'approximate'`. */
  readCap?: number
}

/**
 * Everything the CLI and core need to know about a provider, without ever
 * branching on `ProviderId` (ADR-0003 §1, §5). Declared once per provider
 * (plus the configurable fake provider used in tests).
 */
export interface ProviderCapabilities {
  // identity & policy (NFR-7)
  /** `false` => opt-in rules apply (NFR-7). */
  official: boolean
  requiresRiskAcknowledgement: boolean

  // auth (FR-AUTH)
  /** FR-AUTH-2. */
  userSuppliedClientId: boolean
  /** Google Desktop client: `true` (FR-AUTH-1). */
  requiresClientSecret: boolean
  supportsRefreshToken: boolean
  /** FR-AUTH-4. */
  supportsRevocation: boolean

  // reading
  /** Drives `--offset` (FR-SEARCH-2). */
  paginationModel: 'offset' | 'cursor-forward'
  maxSearchPageSize: number
  /** Page size for list/items/liked reads (Amendment 2). */
  readPageSize: ReadPageSize
  /** FR-PL-2, FR-EXP-5. */
  playlistItemsAccess: 'all' | 'owned-only' | 'owned-or-collaborator'
  likedSongs: LikedSongsCapability

  // matching (FR-MIG-2)
  /** Replaces the old `supportsIsrcSearch` boolean. */
  isrcSearchMode: 'lookup' | 'filter' | 'none'
  /** `false` => `searchTracks` fetches details (`getTrackDetails`) to fill `durationMs`. */
  searchReturnsDuration: boolean
  musicAwareSearch: boolean

  // writing
  /** `false` => remove = unfollow (FR-PL-4). */
  canDeletePlaylist: boolean
  supportsCollaborative: boolean
  /** `populatePlaylist` batch size; writes only, never a read page size. */
  maxTracksPerRequest: number
  maxPlaylistSize?: number

  // limits (PRV-4, FR-MIG-5)
  quotaModel: QuotaModel
}
