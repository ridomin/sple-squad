import { deleteTokens, loadTokens, type TokenStoreOptions } from '../../core/config/token-store.ts'
import type { StoredToken } from '../../core/config/types.ts'
import { AuthRequiredError } from '../../core/provider/errors.ts'
import type { AuthStatus } from '../../core/provider/provider.ts'

const SPOTIFY_ACCOUNT_APPS_URL = 'https://www.spotify.com/account/apps/'

export interface SpotifySessionOptions extends TokenStoreOptions {
  loadToken?: () => Promise<StoredToken | null>
  deleteToken?: () => Promise<void>
}

export interface SpotifyAuthStatus extends AuthStatus {
  refreshTokenExpiresAt?: string
}

/** Reads only local token metadata; it never attempts to refresh or contact Spotify. */
export async function getSpotifyAuthStatus (
  options: SpotifySessionOptions = {}
): Promise<SpotifyAuthStatus> {
  const token = await (options.loadToken ?? (async () => await loadTokens('spotify', options)))()
  if (token === null) {
    return { loggedIn: false, scopes: [] }
  }

  const { userId, displayName, scopes, expiresAt, refreshTokenExpiresAt } = token
  const status: SpotifyAuthStatus = {
    loggedIn: true,
    user: {
      id: userId,
      ...(displayName === undefined ? {} : { displayName })
    },
    scopes: [...scopes]
  }
  if (expiresAt !== undefined) {
    status.expiresAt = expiresAt
  }
  if (refreshTokenExpiresAt !== undefined) {
    status.refreshTokenExpiresAt = refreshTokenExpiresAt
  }
  return status
}

/** Spotify has no revoke endpoint; logout always removes its local token entry. */
export async function logoutSpotify (
  options: SpotifySessionOptions = {}
): Promise<{ revoked: false, deletedData: string[], notice: string }> {
  await (options.deleteToken ?? (async () => { await deleteTokens('spotify', options) }))()
  return {
    revoked: false,
    deletedData: ['Spotify tokens'],
    notice: `Spotify does not support token revocation. Revoke access at ${SPOTIFY_ACCOUNT_APPS_URL}`
  }
}

export type SpotifyScopeOperation =
  | 'search'
  | 'listPlaylists'
  | 'getPlaylist'
  | 'getPlaylistTracks'
  | 'getLikedTracks'
  | { operation: 'createPlaylist', public: boolean, collaborative?: boolean }
  | 'removePlaylist'
  | 'populatePlaylist'
  | 'searchTracks'

const LIST_PLAYLIST_SCOPES = ['playlist-read-private', 'playlist-read-collaborative']
const PLAYLIST_WRITE_SCOPES = ['playlist-modify-public', 'playlist-modify-private']
const SPOTIFY_SCOPES_BY_OPERATION: Record<Exclude<SpotifyScopeOperation, { operation: 'createPlaylist' }>, string[]> = {
  search: [],
  listPlaylists: LIST_PLAYLIST_SCOPES,
  getPlaylist: ['playlist-read-private'],
  getPlaylistTracks: ['playlist-read-private'],
  getLikedTracks: ['user-library-read'],
  removePlaylist: PLAYLIST_WRITE_SCOPES,
  populatePlaylist: PLAYLIST_WRITE_SCOPES,
  searchTracks: []
}

/** Returns the required scopes in the order defined by ADR-0003 Amendment 2. */
export function requiredSpotifyScopes (operation: SpotifyScopeOperation): string[] {
  if (typeof operation === 'object') {
    if (operation.collaborative === true) {
      return [...PLAYLIST_WRITE_SCOPES]
    }
    return [operation.public ? 'playlist-modify-public' : 'playlist-modify-private']
  }
  return [...SPOTIFY_SCOPES_BY_OPERATION[operation]]
}

/** Validates login and operation scopes before a Spotify API request is made. */
export function requireSpotifyScopes (
  token: StoredToken | null,
  operation: SpotifyScopeOperation
): void {
  if (token === null) {
    throw new AuthRequiredError('no-token')
  }
  const granted = new Set(token.scopes)
  const missing = requiredSpotifyScopes(operation).find((scope) => !granted.has(scope))
  if (missing !== undefined) {
    throw new AuthRequiredError(
      'missing-scope',
      missing,
      `Missing scope '${missing}'. Run "sple auth login" to grant ${missing}`
    )
  }
}
