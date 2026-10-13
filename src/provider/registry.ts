// Provider registration (ADR-0003 §5): Spotify's auth-capable Provider is
// always registered, while the fake provider is registered only when
// `SPLE_ENABLE_FAKE_PROVIDER=1` (reusing `resolveConfig` precedence — flags
// > process env > default — ADR 0004 §1). This module stays the single place
// the CLI asks "which providers exist right now".

import { resolveConfig } from '../core/config/index.ts'
import type { SpleConfig } from '../core/config/index.ts'
import { createFakeProvider } from '../core/provider/fake/index.ts'
import type { CreateFakeProviderOptions } from '../core/provider/fake/index.ts'
import type { Provider } from '../core/provider/index.ts'
import { createSpotifyProvider } from './spotify/provider.ts'
import type { CreateSpotifyProviderOptions } from './spotify/provider.ts'

export interface ProviderRegistryOptions {
  /** Overrides resolved config; mainly for tests. Defaults to `resolveConfig()`. */
  config?: SpleConfig
  /** Fixtures/capabilities for the fake provider, when registered. */
  fakeProviderOptions?: CreateFakeProviderOptions
  /** Token-store and login overrides for Spotify; config supplies its client ID. */
  spotifyProviderOptions?: Omit<CreateSpotifyProviderOptions, 'clientId'>
}

/** `true` when the fake provider is enabled for this process (`SPLE_ENABLE_FAKE_PROVIDER=1`, via `resolveConfig`). */
export function isFakeProviderEnabled (config: SpleConfig = resolveConfig()): boolean {
  return config.enableFakeProvider
}

/** Returns a fresh fake `Provider`, or `null` when `SPLE_ENABLE_FAKE_PROVIDER` is not set to `1`. */
export function getFakeProvider (options: ProviderRegistryOptions = {}): Provider | null {
  const config = options.config ?? resolveConfig()
  if (!isFakeProviderEnabled(config)) {
    return null
  }
  return createFakeProvider(options.fakeProviderOptions)
}

/** Every provider registered for this process (ADR-0003 §5). Spotify is always registered; fake remains opt-in. */
export function getRegisteredProviders (options: ProviderRegistryOptions = {}): Provider[] {
  const config = options.config ?? resolveConfig()
  const spotify = createSpotifyProvider({
    ...options.spotifyProviderOptions,
    clientId: config.spotifyClientId
  })
  const fake = getFakeProvider(options)
  return fake === null ? [spotify] : [spotify, fake]
}
