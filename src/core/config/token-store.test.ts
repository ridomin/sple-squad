import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { platform } from 'node:process'
import { loadTokens, saveTokens, deleteTokens } from './token-store.ts'
import type { StoredToken } from './types.ts'
import { redactSensitiveValues } from '../security/secrets.ts'

const tmpRoot = tmpdir()

const cleanupDirs: string[] = []
afterEach(async () => {
  const dirs = cleanupDirs.splice(0, cleanupDirs.length)
  await Promise.all(dirs.map(async (dir) => { await rm(dir, { recursive: true, force: true }) }))
})

async function makeTempDir (): Promise<string> {
  const dir = await mkdtemp(join(tmpRoot, 'token-store-test-'))
  cleanupDirs.push(dir)
  return dir
}

function sampleToken (overrides: Partial<StoredToken> = {}): StoredToken {
  return {
    accessToken: 'access-token-value',
    refreshToken: 'refresh-token-value',
    expiresAt: '2026-10-01T12:34:56Z',
    scopes: ['playlist-read-private'],
    userId: 'rido',
    grantedAt: '2026-09-01T00:00:00Z',
    ...overrides
  }
}

describe('loadTokens', () => {
  it('returns null when tokens.json does not exist', async () => {
    const dir = await makeTempDir()
    const filePath = join(dir, 'tokens.json')
    const token = await loadTokens('spotify', { filePath })
    assert.equal(token, null)
  })

  it('returns null when the provider has no entry', async () => {
    const dir = await makeTempDir()
    const filePath = join(dir, 'tokens.json')
    await saveTokens('youtube-music', sampleToken(), { filePath })
    const token = await loadTokens('spotify', { filePath })
    assert.equal(token, null)
  })

  it('returns null when the provider has an empty accounts array', async () => {
    const dir = await makeTempDir()
    const filePath = join(dir, 'tokens.json')
    await writeFile(
      filePath,
      JSON.stringify({ schemaVersion: 1, providers: { spotify: { accounts: [] } } }, null, 2)
    )
    const token = await loadTokens('spotify', { filePath })
    assert.equal(token, null)
  })

  it('throws on an unsupported schemaVersion', async () => {
    const dir = await makeTempDir()
    const filePath = join(dir, 'tokens.json')
    await writeFile(filePath, JSON.stringify({ schemaVersion: 2, providers: {} }))
    await assert.rejects(async () => { await loadTokens('spotify', { filePath }) })
  })

  it('throws when the stored token is missing required fields', async () => {
    const dir = await makeTempDir()
    const filePath = join(dir, 'tokens.json')
    await writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        providers: { spotify: { accounts: [{ accessToken: '' }] } }
      })
    )
    await assert.rejects(async () => { await loadTokens('spotify', { filePath }) })
  })
})

describe('saveTokens / loadTokens round trip', () => {
  it('saves and reloads a token for a single provider', async () => {
    const dir = await makeTempDir()
    const filePath = join(dir, 'tokens.json')
    const token = sampleToken()

    await saveTokens('spotify', token, { filePath })
    const loaded = await loadTokens('spotify', { filePath })

    assert.deepEqual(loaded, token)
    assert.equal(
      redactSensitiveValues(`${token.accessToken} ${token.refreshToken ?? ''}`),
      '[REDACTED] [REDACTED]'
    )
  })

  it('creates the config directory if it does not exist yet', async () => {
    const dir = await makeTempDir()
    const filePath = join(dir, 'nested', 'config', 'tokens.json')

    await saveTokens('spotify', sampleToken(), { filePath })
    const loaded = await loadTokens('spotify', { filePath })

    assert.ok(loaded !== null)
  })

  it('replaces an existing token for the same provider', async () => {
    const dir = await makeTempDir()
    const filePath = join(dir, 'tokens.json')

    await saveTokens('spotify', sampleToken({ userId: 'first' }), { filePath })
    await saveTokens('spotify', sampleToken({ userId: 'second' }), { filePath })
    const loaded = await loadTokens('spotify', { filePath })

    assert.equal(loaded?.userId, 'second')
  })

  it('keeps multiple providers logged in simultaneously (FR-AUTH-6)', async () => {
    const dir = await makeTempDir()
    const filePath = join(dir, 'tokens.json')

    await saveTokens('spotify', sampleToken({ userId: 'spotify-user' }), { filePath })
    await saveTokens('youtube-music', sampleToken({ userId: 'yt-user' }), { filePath })

    const spotifyToken = await loadTokens('spotify', { filePath })
    const youtubeToken = await loadTokens('youtube-music', { filePath })

    assert.equal(spotifyToken?.userId, 'spotify-user')
    assert.equal(youtubeToken?.userId, 'yt-user')
  })

  it('rejects saving a token missing required fields', async () => {
    const dir = await makeTempDir()
    const filePath = join(dir, 'tokens.json')
    const invalidToken = { ...sampleToken(), accessToken: '' }

    await assert.rejects(async () => { await saveTokens('spotify', invalidToken, { filePath }) })
  })
})

describe('deleteTokens', () => {
  it('is not an error when tokens.json does not exist', async () => {
    const dir = await makeTempDir()
    const filePath = join(dir, 'tokens.json')
    await deleteTokens('spotify', { filePath })
    assert.equal(await loadTokens('spotify', { filePath }), null)
  })

  it('removes only the targeted provider, leaving others untouched', async () => {
    const dir = await makeTempDir()
    const filePath = join(dir, 'tokens.json')

    await saveTokens('spotify', sampleToken({ userId: 'spotify-user' }), { filePath })
    await saveTokens('youtube-music', sampleToken({ userId: 'yt-user' }), { filePath })
    await deleteTokens('spotify', { filePath })

    assert.equal(await loadTokens('spotify', { filePath }), null)
    const youtubeToken = await loadTokens('youtube-music', { filePath })
    assert.equal(youtubeToken?.userId, 'yt-user')
  })
})

describe('tokens.json file permissions', () => {
  it('writes tokens.json with 0600 permissions on POSIX systems', { skip: platform === 'win32' }, async () => {
    const dir = await makeTempDir()
    const filePath = join(dir, 'tokens.json')

    await saveTokens('spotify', sampleToken(), { filePath })

    const stats = await stat(filePath)
    assert.equal(stats.mode & 0o777, 0o600)
  })

  it('keeps 0600 permissions after an update (temp file + rename)', { skip: platform === 'win32' }, async () => {
    const dir = await makeTempDir()
    const filePath = join(dir, 'tokens.json')

    await saveTokens('spotify', sampleToken({ userId: 'first' }), { filePath })
    await saveTokens('spotify', sampleToken({ userId: 'second' }), { filePath })

    const stats = await stat(filePath)
    assert.equal(stats.mode & 0o777, 0o600)
  })

  it('does not leave a stray temp file behind after a write', async () => {
    const dir = await makeTempDir()
    const filePath = join(dir, 'tokens.json')
    await saveTokens('spotify', sampleToken(), { filePath })

    const entries = await readDirSafe(dir)
    assert.deepEqual(entries, ['tokens.json'])
  })
})

async function readDirSafe (dir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  return await readdir(dir)
}
