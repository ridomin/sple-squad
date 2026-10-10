// Provider-specific Spotify OAuth boundary. CLI command wiring can depend on
// this module without adding OAuth logic to the shared command dispatcher.
export type { SpotifyLoginDependencies, SpotifyLoginMode, SpotifyLoginOptions, SpotifyLoginResult } from './auth-types.ts'
export { loginSpotify } from './auth.ts'
export { createSpotifyApiClient } from './client.ts'
export type { SpotifyApiClient, SpotifyApiClientOptions } from './client.ts'
export { getSpotifyAuthStatus, logoutSpotify, requiredSpotifyScopes, requireSpotifyScopes } from './session.ts'
export type { SpotifyAuthStatus, SpotifyScopeOperation, SpotifySessionOptions } from './session.ts'
export { refreshSpotifyToken } from './oauth.ts'
export type { RefreshSpotifyTokenOptions } from './oauth.ts'
