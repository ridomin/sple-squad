// Provider-specific Spotify OAuth boundary. CLI command wiring can depend on
// this module without adding OAuth logic to the shared command dispatcher.
export type { SpotifyLoginDependencies, SpotifyLoginMode, SpotifyLoginOptions, SpotifyLoginResult } from './auth-types.ts'
export { loginSpotify } from './auth.ts'
