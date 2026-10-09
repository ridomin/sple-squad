// Provider registration gate (ADR-0003 §5, PRV-6): the `fake` provider is
// constructible unconditionally (see `../core/provider/fake/`), but it is
// only *registered* for CLI use when `SPLE_ENABLE_FAKE_PROVIDER=1` (reusing
// `resolveConfig`'s precedence — flags > process env > `.env` file >
// default — so the gate agrees with the rest of the config module, ADR 0004
// §1). Real adapters (Spotify, YouTube Music) register unconditionally once
// they land (issues #6, #8); this module stays the single place the CLI
// asks "which providers exist right now".

import { resolveConfig } from '../core/config/index.ts'
import type { SpleConfig } from '../core/config/index.ts'
import { createFakeProvider } from '../core/provider/fake/index.ts'
import type { CreateFakeProviderOptions } from '../core/provider/fake/index.ts'
import type { Provider } from '../core/provider/index.ts'

export interface ProviderRegistryOptions {
  /** Overrides env/`.env`-resolved config; mainly for tests. Defaults to `resolveConfig()`. */
  config?: SpleConfig
  /** Fixtures/capabilities for the fake provider, when registered. */
  fakeProviderOptions?: CreateFakeProviderOptions
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

/** Every provider registered for this process (ADR-0003 §5). Only the fake provider exists today, and only when enabled; real adapters join this list in issues #6/#8. */
export function getRegisteredProviders (options: ProviderRegistryOptions = {}): Provider[] {
  const fake = getFakeProvider(options)
  return fake === null ? [] : [fake]
}
