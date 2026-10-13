import { resolveConfig } from '../../core/config/config.ts'
import type { TokenStoreOptions } from '../../core/config/token-store.ts'
import { UsageError } from '../../core/provider/errors.ts'
import type { Provider } from '../../core/provider/index.ts'
import { createSpotifyApiOperations } from './api.ts'
import { SPOTIFY_API_CAPABILITIES } from './api-capabilities.ts'
import { loginSpotify } from './auth.ts'
import { createSpotifyApiClient } from './client.ts'
import type { SpotifyLoginDependencies } from './auth-types.ts'
import { getSpotifyAuthStatus, logoutSpotify, type SpotifySessionOptions } from './session.ts'

const SPOTIFY_PROVIDER_ID = 'spotify'
const SPOTIFY_DISPLAY_NAME = 'Spotify'
export interface CreateSpotifyProviderOptions extends TokenStoreOptions {
  clientId?: string | null
  loginDependencies?: SpotifyLoginDependencies
  login?: typeof loginSpotify
  sessionOptions?: SpotifySessionOptions
}

/** Creates Spotify's registered provider surface. */
export function createSpotifyProvider (options: CreateSpotifyProviderOptions = {}): Provider {
  const clientId = options.clientId === undefined ? resolveConfig().spotifyClientId : options.clientId
  const tokenStoreOptions: TokenStoreOptions = {
    ...(options.filePath === undefined ? {} : { filePath: options.filePath }),
    ...(options.platformEnv === undefined ? {} : { platformEnv: options.platformEnv })
  }

  const operations = createSpotifyApiOperations(async (operation, method, path, init) => {
    if (clientId === null) {
      throw new UsageError('Missing Spotify Client ID. Set SPLE_SPOTIFY_CLIENT_ID in your environment or .env file.')
    }
    const client = createSpotifyApiClient({ clientId, ...tokenStoreOptions })
    return await client.request(operation, method, path, init)
  })

  return {
    id: SPOTIFY_PROVIDER_ID,
    displayName: SPOTIFY_DISPLAY_NAME,
    capabilities: SPOTIFY_API_CAPABILITIES,
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
    ...operations
  }
}
