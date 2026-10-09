// Tests the env-var gate for the fake provider's CLI registration
// (ADR-0003 §5, PRV-6): `SPLE_ENABLE_FAKE_PROVIDER=1` must be the only way
// it becomes available. Uses `resolveConfig`'s `processEnv` override so no
// real environment variables are read or mutated.

import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { ENV_VAR_ENABLE_FAKE_PROVIDER, resolveConfig } from '../core/config/index.ts'
import { getFakeProvider, getRegisteredProviders, isFakeProviderEnabled } from './registry.ts'

describe('provider registry: fake-provider gate (SPLE_ENABLE_FAKE_PROVIDER)', () => {
  afterEach(() => { Reflect.deleteProperty(process.env, ENV_VAR_ENABLE_FAKE_PROVIDER) })

  it('is disabled when the env var is unset', () => {
    const config = resolveConfig({ processEnv: {} })
    assert.equal(isFakeProviderEnabled(config), false)
  })

  it('is disabled for any value other than "1"', () => {
    const config = resolveConfig({ processEnv: { SPLE_ENABLE_FAKE_PROVIDER: 'true' } })
    assert.equal(isFakeProviderEnabled(config), false)
  })

  it('is enabled when the env var is exactly "1"', () => {
    const config = resolveConfig({ processEnv: { SPLE_ENABLE_FAKE_PROVIDER: '1' } })
    assert.equal(isFakeProviderEnabled(config), true)
  })

  it('getFakeProvider returns null when disabled', () => {
    const config = resolveConfig({ processEnv: {} })
    assert.equal(getFakeProvider({ config }), null)
  })

  it('getFakeProvider returns a usable fake Provider when enabled', async () => {
    const config = resolveConfig({ processEnv: { SPLE_ENABLE_FAKE_PROVIDER: '1' } })
    const provider = getFakeProvider({ config })
    assert.ok(provider !== null)
    assert.equal(provider.id, 'fake')
    const status = await provider.auth.status()
    assert.equal(status.loggedIn, false)
  })

  it('getFakeProvider forwards fixtures/capabilities to the constructed provider', () => {
    const config = resolveConfig({ processEnv: { SPLE_ENABLE_FAKE_PROVIDER: '1' } })
    const provider = getFakeProvider({
      config,
      fakeProviderOptions: { displayName: 'Custom', capabilities: { canDeletePlaylist: false } }
    })
    assert.ok(provider !== null)
    assert.equal(provider.displayName, 'Custom')
    assert.equal(provider.capabilities.canDeletePlaylist, false)
  })

  it('getRegisteredProviders is empty when the gate is off', () => {
    const config = resolveConfig({ processEnv: {} })
    assert.deepEqual(getRegisteredProviders({ config }), [])
  })

  it('getRegisteredProviders includes exactly the fake provider when the gate is on', () => {
    const config = resolveConfig({ processEnv: { SPLE_ENABLE_FAKE_PROVIDER: '1' } })
    const providers = getRegisteredProviders({ config })
    assert.equal(providers.length, 1)
    assert.equal(providers[0]?.id, 'fake')
  })

  it('defaults to resolveConfig() (real process.env) when no config is given, reading SPLE_ENABLE_FAKE_PROVIDER from the real environment', () => {
    Reflect.deleteProperty(process.env, ENV_VAR_ENABLE_FAKE_PROVIDER)
    assert.equal(getFakeProvider(), null)

    process.env[ENV_VAR_ENABLE_FAKE_PROVIDER] = '1'
    const provider = getFakeProvider()
    assert.ok(provider !== null)
    assert.equal(provider.id, 'fake')
  })
})
