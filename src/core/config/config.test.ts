import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveConfig,
  loadConfigFromDisk,
  UsageError,
  ENV_VAR_SPOTIFY_CLIENT_ID,
  ENV_VAR_DEFAULT_PROVIDER,
  ENV_VAR_ENABLE_FAKE_PROVIDER
} from './config.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tmpRoot = join(repoRoot, 'tmp')

const cleanupDirs: string[] = []
afterEach(async () => {
  const dirs = cleanupDirs.splice(0, cleanupDirs.length)
  await Promise.all(dirs.map(async (dir) => { await rm(dir, { recursive: true, force: true }) }))
})

async function makeTempDir (): Promise<string> {
  const dir = await mkdtemp(join(tmpRoot, 'config-test-'))
  cleanupDirs.push(dir)
  return dir
}

describe('resolveConfig precedence (CLI-6: flag > process env > .env file > default)', () => {
  it('falls back to the built-in default provider when nothing else is set', () => {
    const config = resolveConfig({ processEnv: {}, envFileVars: {} })
    assert.equal(config.defaultProvider, 'spotify')
  })

  it('uses the .env file value when process env and flag are absent', () => {
    const config = resolveConfig({
      processEnv: {},
      envFileVars: { [ENV_VAR_DEFAULT_PROVIDER]: 'youtube-music' }
    })
    assert.equal(config.defaultProvider, 'youtube-music')
  })

  it('process env overrides the .env file', () => {
    const config = resolveConfig({
      processEnv: { [ENV_VAR_DEFAULT_PROVIDER]: 'fake' },
      envFileVars: { [ENV_VAR_DEFAULT_PROVIDER]: 'youtube-music' }
    })
    assert.equal(config.defaultProvider, 'fake')
  })

  it('the --provider flag overrides process env and the .env file', () => {
    const config = resolveConfig({
      cliProvider: 'youtube-music',
      processEnv: { [ENV_VAR_DEFAULT_PROVIDER]: 'fake' },
      envFileVars: { [ENV_VAR_DEFAULT_PROVIDER]: 'spotify' }
    })
    assert.equal(config.defaultProvider, 'youtube-music')
  })

  it('treats an empty process env value as unset and falls through to the file', () => {
    const config = resolveConfig({
      processEnv: { [ENV_VAR_SPOTIFY_CLIENT_ID]: '   ' },
      envFileVars: { [ENV_VAR_SPOTIFY_CLIENT_ID]: 'from-file' }
    })
    assert.equal(config.spotifyClientId, 'from-file')
  })

  it('a client ID absent everywhere resolves to null (not a UsageError)', () => {
    const config = resolveConfig({ processEnv: {}, envFileVars: {} })
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

describe('loadConfigFromDisk', () => {
  it('is not an error when the .env file is missing', async () => {
    const dir = await makeTempDir()
    const envFilePath = join(dir, '.env')
    const { config, warnings } = await loadConfigFromDisk({ envFilePath, processEnv: {} })
    assert.equal(config.defaultProvider, 'spotify')
    assert.deepEqual(warnings, [])
  })

  it('reads and merges values from a real .env file on disk', async () => {
    const dir = await makeTempDir()
    const envFilePath = join(dir, '.env')
    await writeFile(
      envFilePath,
      '# config\nSPLE_SPOTIFY_CLIENT_ID=abc123\nSPLE_DEFAULT_PROVIDER=youtube-music\n',
      { mode: 0o600 }
    )
    await chmod(envFilePath, 0o600)

    const { config, warnings } = await loadConfigFromDisk({ envFilePath, processEnv: {} })
    assert.equal(config.spotifyClientId, 'abc123')
    assert.equal(config.defaultProvider, 'youtube-music')
    assert.deepEqual(warnings, [])
  })

  it('warns when the .env file is readable by group or others', async () => {
    const dir = await makeTempDir()
    const envFilePath = join(dir, '.env')
    await writeFile(envFilePath, 'SPLE_DEFAULT_PROVIDER=spotify\n')
    await chmod(envFilePath, 0o644)

    const { warnings } = await loadConfigFromDisk({ envFilePath, processEnv: {} })
    assert.equal(warnings.length, 1)
    assert.match(warnings[0] ?? '', /is readable by other users/v)
  })

  it('process env still overrides values loaded from the .env file', async () => {
    const dir = await makeTempDir()
    const envFilePath = join(dir, '.env')
    await writeFile(envFilePath, 'SPLE_DEFAULT_PROVIDER=youtube-music\n', { mode: 0o600 })
    await chmod(envFilePath, 0o600)

    const { config } = await loadConfigFromDisk({
      envFilePath,
      processEnv: { [ENV_VAR_DEFAULT_PROVIDER]: 'fake' }
    })
    assert.equal(config.defaultProvider, 'fake')
  })
})
