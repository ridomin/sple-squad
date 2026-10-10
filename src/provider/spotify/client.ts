import type { StoredToken } from '../../core/config/types.ts'
import { UsageError } from '../../core/provider/errors.ts'
import { HttpClient, type HttpClientOptions } from '../http/http-client.ts'
import { tokenStoreAccess } from '../http/token-store-access.ts'
import type { TokenStoreOptions } from '../../core/config/token-store.ts'
import { mapSpotifyApiError, refreshSpotifyToken } from './oauth.ts'
import { requireSpotifyScopes, type SpotifyScopeOperation } from './session.ts'

const SPOTIFY_API_BASE_URL = 'https://api.spotify.com'
const SPOTIFY_API_PATH_PREFIX = '/v1'
const EMPTY_LENGTH = 0

export interface SpotifyApiClientOptions extends TokenStoreOptions {
  clientId: string
  fetchImpl?: typeof fetch
  loadToken?: () => Promise<StoredToken | null>
  saveToken?: (token: StoredToken) => Promise<void>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

export interface SpotifyApiClient {
  request: (
    operation: SpotifyScopeOperation,
    method: string,
    path: string,
    init?: Omit<RequestInit, 'method'>
  ) => Promise<Response>
}

function spotifyApiUrl (path: string): URL {
  const url = new URL(path, SPOTIFY_API_BASE_URL)
  if (
    url.origin !== SPOTIFY_API_BASE_URL ||
    (url.pathname !== SPOTIFY_API_PATH_PREFIX && !url.pathname.startsWith(`${SPOTIFY_API_PATH_PREFIX}/`))
  ) {
    throw new UsageError('Spotify API requests must target a /v1 endpoint')
  }
  return url
}

/** Creates a Spotify API client with local token storage, scope checks, and transparent refresh. */
export function createSpotifyApiClient (options: SpotifyApiClientOptions): SpotifyApiClient {
  if (options.clientId.trim().length === EMPTY_LENGTH) {
    throw new UsageError('Missing Spotify Client ID. Set SPLE_SPOTIFY_CLIENT_ID in your environment or .env file.')
  }
  const store = tokenStoreAccess('spotify', options)
  const loadToken = options.loadToken ?? store.loadToken
  const saveToken = options.saveToken ?? store.saveToken
  const httpOptions: HttpClientOptions<StoredToken> = {
    loadToken,
    saveToken,
    refreshToken: async (token) => {
      const refreshOptions = {
        clientId: options.clientId,
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        ...(options.now === undefined ? {} : { now: options.now })
      }
      return await refreshSpotifyToken(token, refreshOptions)
    },
    mapError: ({ status, body }) => mapSpotifyApiError(status, body),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
    ...(options.random === undefined ? {} : { random: options.random })
  }
  const http = new HttpClient<StoredToken>(httpOptions)

  return {
    request: async (operation, method, path, init = {}) => {
      const token = await loadToken()
      requireSpotifyScopes(token, operation)
      return await http.request(method, spotifyApiUrl(path), init)
    }
  }
}
