import { resolveConfig } from '../../core/config/config.ts'
import type { TokenStoreOptions } from '../../core/config/token-store.ts'
import { ProviderError, UsageError } from '../../core/provider/errors.ts'
import type { Provider, ProviderCapabilities } from '../../core/provider/index.ts'
import { loginSpotify } from './auth.ts'
import type { SpotifyLoginDependencies } from './auth-types.ts'
import { getSpotifyAuthStatus, logoutSpotify, type SpotifySessionOptions } from './session.ts'

const SPOTIFY_PROVIDER_ID = 'spotify'
const SPOTIFY_DISPLAY_NAME = 'Spotify'
const NO_SUPPORTED_PAGE_SIZE = 0
const SPOTIFY_ACCOUNT_CAPABILITIES: ProviderCapabilities = {
  official: true,
  requiresRiskAcknowledgement: false,
  userSuppliedClientId: true,
  requiresClientSecret: false,
  supportsRefreshToken: true,
  supportsRevocation: false,
  paginationModel: 'offset',
  maxSearchPageSize: NO_SUPPORTED_PAGE_SIZE,
  readPageSize: {
    playlists: NO_SUPPORTED_PAGE_SIZE,
    playlistItems: NO_SUPPORTED_PAGE_SIZE,
    liked: NO_SUPPORTED_PAGE_SIZE
  },
  playlistItemsAccess: 'owned-only',
  likedSongs: { read: 'none', write: false },
  isrcSearchMode: 'none',
  searchReturnsDuration: false,
  musicAwareSearch: false,
  canDeletePlaylist: false,
  supportsCollaborative: false,
  maxTracksPerRequest: NO_SUPPORTED_PAGE_SIZE,
  quotaModel: { kind: 'rate-limited' }
}

export interface CreateSpotifyProviderOptions extends TokenStoreOptions {
  clientId?: string | null
  loginDependencies?: SpotifyLoginDependencies
  login?: typeof loginSpotify
  sessionOptions?: SpotifySessionOptions
}

async function rejectUnsupportedOperation (): Promise<never> {
  return await Promise.reject(unsupportedOperation())
}

function unsupportedOperation (): ProviderError {
  return new ProviderError('Spotify catalog and playlist operations are not implemented yet')
}

/** Creates Spotify's registered provider surface; catalog operations remain unavailable until their adapter lands. */
export function createSpotifyProvider (options: CreateSpotifyProviderOptions = {}): Provider {
  const clientId = options.clientId === undefined ? resolveConfig().spotifyClientId : options.clientId
  const tokenStoreOptions: TokenStoreOptions = {
    ...(options.filePath === undefined ? {} : { filePath: options.filePath }),
    ...(options.platformEnv === undefined ? {} : { platformEnv: options.platformEnv })
  }

  return {
    id: SPOTIFY_PROVIDER_ID,
    displayName: SPOTIFY_DISPLAY_NAME,
    capabilities: SPOTIFY_ACCOUNT_CAPABILITIES,
    auth: {
      login: async ({ mode, scopes, interaction }) => {
        if (clientId === null) {
          throw new UsageError('Missing Spotify Client ID. Set SPLE_SPOTIFY_CLIENT_ID in your environment or .env file.')
        }
        const login = options.login ?? loginSpotify
        const dependencies = { ...options.loginDependencies, tokenStoreOptions }
        const result = await login({ clientId, mode, scopes }, interaction === undefined
          ? dependencies
          : {
              ...dependencies,
              writeStderr: async message => {
                if (message.startsWith('https://accounts.spotify.com/authorize?')) {
                  await interaction.showAuthorizationUrl(message, mode)
                }
              },
              readLine: async () => await interaction.promptForRedirectUrl(
                'After authorizing, paste the redirected URL here:'
              )
            })
        return {
          loggedIn: true,
          user: {
            id: result.userId,
            ...(result.displayName === undefined ? {} : { displayName: result.displayName })
          },
          scopes: [...result.scopes],
          ...(result.expiresAt === undefined ? {} : { expiresAt: result.expiresAt })
        }
      },
      status: async () => await getSpotifyAuthStatus({ ...tokenStoreOptions, ...options.sessionOptions }),
      logout: async () => await logoutSpotify({ ...tokenStoreOptions, ...options.sessionOptions })
    },
    search: rejectUnsupportedOperation,
    parsePlaylistRef: () => null,
    parseTrackRef: () => null,
    listPlaylists: rejectUnsupportedOperation,
    getPlaylist: rejectUnsupportedOperation,
    getPlaylistTracks: rejectUnsupportedOperation,
    getLikedTracks: rejectUnsupportedOperation,
    createPlaylist: rejectUnsupportedOperation,
    removePlaylist: rejectUnsupportedOperation,
    searchTracks: rejectUnsupportedOperation,
    populatePlaylist: rejectUnsupportedOperation
  }
}
