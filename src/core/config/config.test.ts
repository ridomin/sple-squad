import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveConfig,
  UsageError,
  ENV_VAR_DEFAULT_PROVIDER,
  ENV_VAR_ENABLE_FAKE_PROVIDER,
  ENV_VAR_SPOTIFY_CLIENT_ID
} from './config.ts'

describe('resolveConfig precedence (CLI-6: flag > process env > default)', () => {
  it('falls back to the built-in default provider when nothing else is set', () => {
    const config = resolveConfig({ processEnv: {} })
    assert.equal(config.defaultProvider, 'spotify')
  })

  it('uses the process env value when the flag is absent', () => {
    const config = resolveConfig({
      processEnv: { [ENV_VAR_DEFAULT_PROVIDER]: 'youtube-music' }
    })
    assert.equal(config.defaultProvider, 'youtube-music')
  })

  it('uses process.env by default', () => {
    const previousValue: unknown = Object.getOwnPropertyDescriptor(
      process.env,
      ENV_VAR_DEFAULT_PROVIDER
    )?.value
    process.env[ENV_VAR_DEFAULT_PROVIDER] = 'youtube-music'
    try {
      assert.equal(resolveConfig().defaultProvider, 'youtube-music')
    } finally {
      if (typeof previousValue === 'string') {
        process.env[ENV_VAR_DEFAULT_PROVIDER] = previousValue
      } else {
        Reflect.deleteProperty(process.env, ENV_VAR_DEFAULT_PROVIDER)
      }
    }
  })

  it('the --provider flag overrides process env', () => {
    const config = resolveConfig({
      cliProvider: 'youtube-music',
      processEnv: { [ENV_VAR_DEFAULT_PROVIDER]: 'fake' }
    })
    assert.equal(config.defaultProvider, 'youtube-music')
  })

  it('treats an empty process env value as unset and falls through to the default', () => {
    const config = resolveConfig({
      processEnv: { [ENV_VAR_SPOTIFY_CLIENT_ID]: '   ' }
    })
    assert.equal(config.spotifyClientId, null)
  })

  it('a client ID absent everywhere resolves to null (not a UsageError)', () => {
    const config = resolveConfig({ processEnv: {} })
    assert.equal(config.spotifyClientId, null)
    assert.equal(config.youtubeMusicClientId, null)
    assert.equal(config.googleClientSecret, null)
  })

  it('throws UsageError (exit 2) for an unknown SPLE_DEFAULT_PROVIDER value', () => {
    assert.throws(
      () => {
        resolveConfig({ processEnv: { [ENV_VAR_DEFAULT_PROVIDER]: 'not-a-real-provider' } })
      },
      (err: unknown) => {
        assert.ok(err instanceof UsageError)
        assert.equal(err.exitCode, 2)
        return true
      }
    )
  })

  it('only enables the fake provider when the flag value is exactly "1"', () => {
    const enabled = resolveConfig({ processEnv: { [ENV_VAR_ENABLE_FAKE_PROVIDER]: '1' } })
    const disabled = resolveConfig({ processEnv: { [ENV_VAR_ENABLE_FAKE_PROVIDER]: 'true' } })
    assert.equal(enabled.enableFakeProvider, true)
    assert.equal(disabled.enableFakeProvider, false)
  })
})
