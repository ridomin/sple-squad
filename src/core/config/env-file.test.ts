import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkEnvFilePermissions, parseDotEnv } from './env-file.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tmpRoot = join(repoRoot, 'tmp')

const cleanupDirs: string[] = []
afterEach(async () => {
  const dirs = cleanupDirs.splice(0, cleanupDirs.length)
  await Promise.all(dirs.map(async (dir) => { await rm(dir, { recursive: true, force: true }) }))
})

async function makeTempDir (): Promise<string> {
  const dir = await mkdtemp(join(tmpRoot, 'env-file-test-'))
  cleanupDirs.push(dir)
  return dir
}

describe('parseDotEnv', () => {
  it('parses simple KEY=value pairs', () => {
    const result = parseDotEnv('SPLE_SPOTIFY_CLIENT_ID=abc123\nSPLE_DEFAULT_PROVIDER=spotify\n')
    assert.deepEqual(result, {
      SPLE_SPOTIFY_CLIENT_ID: 'abc123',
      SPLE_DEFAULT_PROVIDER: 'spotify'
    })
  })

  it('ignores blank lines and comments', () => {
    const result = parseDotEnv([
      '# this is a comment',
      '',
      '   ',
      'SPLE_DEFAULT_PROVIDER=spotify',
      '# SPLE_SPOTIFY_CLIENT_ID=commented-out'
    ].join('\n'))
    assert.deepEqual(result, { SPLE_DEFAULT_PROVIDER: 'spotify' })
  })

  it('strips surrounding single or double quotes from values', () => {
    const result = parseDotEnv([
      'SPLE_SPOTIFY_CLIENT_ID="double-quoted"',
      'SPLE_GOOGLE_CLIENT_SECRET=\'single-quoted\''
    ].join('\n'))
    assert.deepEqual(result, {
      SPLE_SPOTIFY_CLIENT_ID: 'double-quoted',
      SPLE_GOOGLE_CLIENT_SECRET: 'single-quoted'
    })
  })

  it('trims whitespace around keys and values', () => {
    const result = parseDotEnv('  SPLE_DEFAULT_PROVIDER  =   spotify  \n')
    assert.deepEqual(result, { SPLE_DEFAULT_PROVIDER: 'spotify' })
  })

  it('ignores lines without a key=value separator', () => {
    const result = parseDotEnv('not-a-valid-line\nSPLE_DEFAULT_PROVIDER=spotify')
    assert.deepEqual(result, { SPLE_DEFAULT_PROVIDER: 'spotify' })
  })

  it('returns an empty object for empty content', () => {
    assert.deepEqual(parseDotEnv(''), {})
  })
})

describe('checkEnvFilePermissions', () => {
  it('returns null on win32 regardless of mode', async () => {
    const dir = await makeTempDir()
    const path = join(dir, '.env')
    await writeFile(path, 'SPLE_DEFAULT_PROVIDER=spotify\n')
    await chmod(path, 0o644)
    const warning = await checkEnvFilePermissions(path, 'win32')
    assert.equal(warning, null)
  })

  it('returns null for a missing file', async () => {
    const dir = await makeTempDir()
    const path = join(dir, 'does-not-exist.env')
    const warning = await checkEnvFilePermissions(path, 'linux')
    assert.equal(warning, null)
  })

  it('returns null when the file is 0600 (owner-only)', async () => {
    const dir = await makeTempDir()
    const path = join(dir, '.env')
    await writeFile(path, 'SPLE_DEFAULT_PROVIDER=spotify\n', { mode: 0o600 })
    await chmod(path, 0o600)
    const warning = await checkEnvFilePermissions(path, 'linux')
    assert.equal(warning, null)
  })

  it('warns when the file is readable by group or others', async () => {
    const dir = await makeTempDir()
    const path = join(dir, '.env')
    await writeFile(path, 'SPLE_DEFAULT_PROVIDER=spotify\n')
    await chmod(path, 0o644)
    const warning = await checkEnvFilePermissions(path, 'linux')
    assert.ok(warning !== null)
    assert.match(warning, /is readable by other users/v)
    assert.match(warning, /chmod 600/v)
  })
})
