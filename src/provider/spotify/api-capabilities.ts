// Spotify capability values for the read/write adapter (ADR-0003 §5).
//
// UNVERIFIED (docs/spikes/M1-spotify-spikes.md): `isrcSearchMode: 'filter'`
// (S1), `playlistItemsAccess: 'owned-or-collaborator'` (S2) and every page
// size below (S3) are prior claims that no live request has reproduced. They
// are declared here exactly as ADR-0003 §5 states and are the only values
// the adapter reads for page limits, so a retest outcome is a one-place change.

import type { ProviderCapabilities } from '../../core/provider/index.ts'

export const SPOTIFY_MAX_SEARCH_PAGE_SIZE = 10
export const SPOTIFY_MAX_PLAYLISTS_PAGE_SIZE = 50
export const SPOTIFY_MAX_PLAYLIST_ITEMS_PAGE_SIZE = 100
export const SPOTIFY_MAX_LIKED_PAGE_SIZE = 50
export const SPOTIFY_MAX_TRACKS_PER_REQUEST = 100
const SPOTIFY_MAX_PLAYLIST_SIZE = 10_000

export const SPOTIFY_API_CAPABILITIES: ProviderCapabilities = {
  official: true,
  requiresRiskAcknowledgement: false,
  userSuppliedClientId: true,
  requiresClientSecret: false,
  supportsRefreshToken: true,
  supportsRevocation: false,
  paginationModel: 'offset',
  maxSearchPageSize: SPOTIFY_MAX_SEARCH_PAGE_SIZE,
  readPageSize: {
    playlists: SPOTIFY_MAX_PLAYLISTS_PAGE_SIZE,
    playlistItems: SPOTIFY_MAX_PLAYLIST_ITEMS_PAGE_SIZE,
    liked: SPOTIFY_MAX_LIKED_PAGE_SIZE
  },
  playlistItemsAccess: 'owned-or-collaborator',
  likedSongs: { read: 'exact', write: false },
  isrcSearchMode: 'filter',
  searchReturnsDuration: true,
  musicAwareSearch: true,
  canDeletePlaylist: false,
  supportsCollaborative: true,
  maxTracksPerRequest: SPOTIFY_MAX_TRACKS_PER_REQUEST,
  maxPlaylistSize: SPOTIFY_MAX_PLAYLIST_SIZE,
  quotaModel: { kind: 'rate-limited' }
}
