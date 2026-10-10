import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  resolveConfig,
  parseEnvFile,
  loadConfigFromDisk,
  UsageError,
  ENV_VAR_SPOTIFY_CLIENT_ID,
  ENV_VAR_DEFAULT_PROVIDER,
  ENV_VAR_ENABLE_FAKE_PROVIDER
} from './config.ts'

const tmpRoot = tmpdir()

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


describe('loadConfigFromDisk', () => {
  it('is not an error when the .env file is missing', async () => {
    const dir = await makeTempDir()
    const envFilePath = join(dir, '.env')
    const { config, warnings } = await loadConfigFromDisk({ envFilePath, processEnv: {} })
    assert.equal(config.defaultProvider, 'spotify')
    assert.deepEqual(warnings, [])
  })

  it('loads values from a real .env file on disk into the selected environment', async () => {
    const dir = await makeTempDir()
    const envFilePath = join(dir, '.env')
    await writeFile(
      envFilePath,
      '# config\n\nSPLE_SPOTIFY_CLIENT_ID="abc 123"\nSPLE_DEFAULT_PROVIDER=youtube-music\n',
      { mode: 0o600 }
    )
    await chmod(envFilePath, 0o600)

    const { config, warnings } = await loadConfigFromDisk({ envFilePath, processEnv: {} })
    assert.equal(config.spotifyClientId, 'abc 123')
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

  it('process environment wins over .env and the CLI flag wins over both (CLI-6)', async () => {
    const dir = await makeTempDir()
    const envFilePath = join(dir, '.env')
    await writeFile(envFilePath, 'SPLE_DEFAULT_PROVIDER=youtube-music\n', { mode: 0o600 })
    await chmod(envFilePath, 0o600)

    const { config: processEnvConfig } = await loadConfigFromDisk({
      envFilePath,
      processEnv: { [ENV_VAR_DEFAULT_PROVIDER]: 'fake' }
    })
    assert.equal(processEnvConfig.defaultProvider, 'fake')

    const { config: cliConfig } = await loadConfigFromDisk({
      cliProvider: 'spotify',
      envFilePath,
      processEnv: { [ENV_VAR_DEFAULT_PROVIDER]: 'fake' }
    })
    assert.equal(cliConfig.defaultProvider, 'spotify')
  })

  it('loads the file when process.loadEnvFile is unavailable', async () => {
    const dir = await makeTempDir()
    const envFilePath = join(dir, '.env')
    await writeFile(envFilePath, 'SPLE_DEFAULT_PROVIDER=fake\n', { mode: 0o600 })
    await chmod(envFilePath, 0o600)

    const descriptor = Object.getOwnPropertyDescriptor(process, 'loadEnvFile')
    Object.defineProperty(process, 'loadEnvFile', {
      configurable: true,
      value: undefined,
      writable: true
    })
    try {
      const { config, warnings } = await loadConfigFromDisk({ envFilePath, processEnv: {} })
      assert.equal(config.defaultProvider, 'fake')
      assert.deepEqual(warnings, [])
    } finally {
      if (descriptor === undefined) {
        Reflect.deleteProperty(process, 'loadEnvFile')
      } else {
        Object.defineProperty(process, 'loadEnvFile', descriptor)
      }
    }
  })

  it('rejects malformed entries with a line-numbered error without exposing values', () => {
    const contents = [
      '# config',
      'SPLE_DEFAULT_PROVIDER=spotify',
      'BAD KEY=must-not-appear'
    ].join('\n')

    assert.throws(
      () => parseEnvFile(contents),
      (error: unknown) => {
        assert.ok(error instanceof SyntaxError)
        assert.match(error.message, /line 3/v)
        assert.doesNotMatch(error.message, /must-not-appear/v)
        return true
      }
    )
  })

  it('parses documented assignment, comment, empty, quoted, and spaced values', () => {
    assert.deepEqual(parseEnvFile([
      '# config comment',
      '',
      'PLAIN=value with spaces',
      'EMPTY=',
      'SINGLE=\' value with spaces \'',
      'DOUBLE="value with spaces and = sign"',
      'PADDED =  padded value  '
    ].join('\n')), [
      ['PLAIN', 'value with spaces'],
      ['EMPTY', ''],
      ['SINGLE', ' value with spaces '],
      ['DOUBLE', 'value with spaces and = sign'],
      ['PADDED', 'padded value']
    ])
  })

  it('rejects malformed file contents instead of resolving with defaults', async () => {
    const dir = await makeTempDir()
    const envFilePath = join(dir, '.env')
    await writeFile(envFilePath, 'SPLE_DEFAULT_PROVIDER="unterminated\n', { mode: 0o600 })
    await chmod(envFilePath, 0o600)

    const processEnv: NodeJS.ProcessEnv = {}
    await assert.rejects(
      loadConfigFromDisk({ envFilePath, processEnv }),
      (error: unknown) => {
        assert.ok(error instanceof SyntaxError)
        assert.match(error.message, /line 1/v)
        return true
      }
    )
    assert.deepEqual(processEnv, {})
  })
})
