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

  it('getRegisteredProviders contains Spotify when the fake-provider gate is off', () => {
    const config = resolveConfig({ processEnv: {} })
    assert.deepEqual(getRegisteredProviders({ config }).map(provider => provider.id), ['spotify'])
  })

  it('getRegisteredProviders always includes Spotify and adds fake only when enabled', () => {
    const config = resolveConfig({ processEnv: { SPLE_ENABLE_FAKE_PROVIDER: '1' } })
    const providers = getRegisteredProviders({ config })
    assert.deepEqual(providers.map(provider => provider.id), ['spotify', 'fake'])
  })

  it('exposes Spotify status and logout through the registered Provider interface', async () => {
    const config = resolveConfig({ processEnv: {} })
    let deleted = false
    const [spotify] = getRegisteredProviders({
      config,
      spotifyProviderOptions: {
        sessionOptions: {
          loadToken: async () => await Promise.resolve(null),
          deleteToken: async () => {
            deleted = true
            await Promise.resolve()
          }
        }
      }
    })
    assert.ok(spotify !== undefined)
    assert.equal(spotify.id, 'spotify')
    assert.deepEqual(await spotify.auth.status(), { loggedIn: false, scopes: [] })
    const result = await spotify.auth.logout()
    assert.equal(deleted, true)
    assert.equal(result.revoked, false)
    assert.deepEqual(result.deletedData, ['Spotify tokens'])
    assert.match(result.notice ?? '', /does not support token revocation/v)
  })

  it('routes registered Spotify login through the typed auth interface', async () => {
    const config = resolveConfig({
      processEnv: {
        SPLE_SPOTIFY_CLIENT_ID: 'mock-client-id'
      }
    })
    const shownUrls: string[] = []
    let requestedPrompt = ''
    let pastedRedirect = ''
    const [spotify] = getRegisteredProviders({
      config,
      spotifyProviderOptions: {
        login: async ({ clientId, mode, scopes }, dependencies) => {
          await dependencies?.writeStderr?.('https://accounts.spotify.com/authorize?mock=1')
          pastedRedirect = await dependencies?.readLine?.() ?? ''
          return await Promise.resolve({
          userId: clientId,
          ...(mode === undefined ? {} : { displayName: mode }),
          scopes: scopes ?? []
          })
        }
      }
    })
    assert.ok(spotify !== undefined)
    assert.deepEqual(await spotify.auth.login({
      mode: 'manual',
      scopes: ['playlist-read-private'],
      interaction: {
        showAuthorizationUrl: url => { shownUrls.push(url) },
        promptForRedirectUrl: async prompt => {
          requestedPrompt = prompt
          return await Promise.resolve('mock-redirect-url')
        }
      }
    }), {
      loggedIn: true,
      user: { id: 'mock-client-id', displayName: 'manual' },
      scopes: ['playlist-read-private']
    })
    assert.deepEqual(shownUrls, ['https://accounts.spotify.com/authorize?mock=1'])
    assert.equal(requestedPrompt, 'After authorizing, paste the redirected URL here:')
    assert.equal(pastedRedirect, 'mock-redirect-url')
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
