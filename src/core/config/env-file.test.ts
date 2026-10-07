import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { checkEnvFilePermissions } from './env-file.ts'

const tmpRoot = tmpdir()

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
