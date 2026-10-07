// `tokenStoreAccess` wires `HttpClient`'s loadToken/saveToken hooks to the
// real token store (ADR 0004); this just checks the wiring round-trips
// through a temp tokens.json, not token-store.ts's own behavior (see
// `core/config/token-store.test.ts` for that).
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { saveTokens } from '../../core/config/token-store.ts'
import type { StoredToken } from '../../core/config/types.ts'
import { tokenStoreAccess } from './token-store-access.ts'

const cleanupDirs: string[] = []
afterEach(async () => {
  const dirs = cleanupDirs.splice(0, cleanupDirs.length)
  await Promise.all(dirs.map(async (dir) => { await rm(dir, { recursive: true, force: true }) }))
})

async function makeTempTokensPath (): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'http-client-token-store-test-'))
  cleanupDirs.push(dir)
  return join(dir, 'tokens.json')
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

describe('tokenStoreAccess', () => {
  it('loadToken reads null when no token is stored', async () => {
    const filePath = await makeTempTokensPath()
    const access = tokenStoreAccess('spotify', { filePath })
    assert.equal(await access.loadToken(), null)
  })

  it('loadToken reads what saveTokens wrote directly', async () => {
    const filePath = await makeTempTokensPath()
    await saveTokens('spotify', sampleToken(), { filePath })
    const access = tokenStoreAccess('spotify', { filePath })
    const token = await access.loadToken()
    assert.equal(token?.accessToken, 'access-token-value')
  })

  it('saveToken writes a token that loadToken then reads back', async () => {
    const filePath = await makeTempTokensPath()
    const access = tokenStoreAccess('youtube-music', { filePath })
    await access.saveToken(sampleToken({ accessToken: 'refreshed-value' }))
    const token = await access.loadToken()
    assert.equal(token?.accessToken, 'refreshed-value')
  })
})
