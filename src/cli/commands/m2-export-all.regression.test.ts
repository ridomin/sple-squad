import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { createFakeProvider } from '../../core/provider/fake/fake-provider.ts'
import type { Provider } from '../../core/provider/provider.ts'
import { AuthRequiredError } from '../../core/provider/errors.ts'
import { EXIT_CODES } from '../exit-codes.ts'
import { createExportCommand } from './export.ts'
import { asArray, asRecord, parseJsonRecord, runCommands } from './fixtures/m2/harness.ts'
import { MULTI_PLAYLIST_LIBRARY } from './fixtures/m2/library.ts'

const root = join(process.cwd(), `.sple-m2-export-all-${process.pid}-${randomUUID()}`)
const schema = parseJsonRecord(await readFile(new URL('../../../schemas/canonical-playlist.v1.schema.json', import.meta.url), 'utf8'))
const validate = new Ajv2020({ strict: true }).compile(schema)

interface IndexFile { path: string, format: string, trackCount: number }
interface IndexSkipped { id: unknown, name: unknown, status: unknown, reason: unknown }
interface Index { files: IndexFile[], skipped: IndexSkipped[] }

async function exportAll (provider: Provider, directory: string, extra: string[] = []): ReturnType<typeof runCommands> {
  return await runCommands([createExportCommand(() => provider)], ['export', '--all', '-o', directory, ...extra])
}

async function readIndex (directory: string): Promise<Index> {
  const index = parseJsonRecord(await readFile(join(directory, 'index.json'), 'utf8'))
  return {
    files: asArray(index.files).map(item => {
      const { path, format, trackCount } = asRecord(item)
      assert.ok(typeof path === 'string' && typeof format === 'string' && typeof trackCount === 'number')
      return { path, format, trackCount }
    }),
    skipped: asArray(index.skipped).map(item => {
      const { id, name, status, reason } = asRecord(item)
      return { id, name, status, reason }
    })
  }
}

before(async () => { await mkdir(root, { recursive: true }) })
after(async () => { await rm(root, { recursive: true, force: true }) })

describe('M2 regression: export --all over a multi-playlist library', () => {
  it('writes one schema-valid file per readable playlist, with unique names for duplicate playlist names', async () => {
    const directory = join(root, 'full')
    const { code, io } = await exportAll(createFakeProvider({ fixtures: MULTI_PLAYLIST_LIBRARY }), directory)
    assert.equal(code, EXIT_CODES.error, io.stderr.text)

    const index = await readIndex(directory)
    const entries = (await readdir(directory)).sort()
    assert.deepEqual(entries, [...index.files.map(file => file.path), 'index.json'].sort())
    assert.equal(new Set(index.files.map(file => file.path)).size, index.files.length, 'file names must be unique')
    assert.equal(index.files.length, 7, '6 readable playlists (incl. followed) + Liked Songs')

    for (const file of index.files) {
      // eslint-disable-next-line no-await-in-loop -- sequential reads keep failures attributable
      const exported = parseJsonRecord(await readFile(join(directory, file.path), 'utf8'))
      assert.equal(validate(exported), true, `${file.path}: ${JSON.stringify(validate.errors)}`)
      assert.equal(asArray(exported.tracks).length, file.trackCount, `${file.path}: index trackCount must match the file`)
    }
  })

  it('preserves duplicate tracks, empty playlists, and unicode/quoted titles byte-for-byte per playlist', async () => {
    const directory = join(root, 'content')
    await exportAll(createFakeProvider({ fixtures: MULTI_PLAYLIST_LIBRARY }), directory)
    const index = await readIndex(directory)
    const countsByPrefix = new Map(index.files.map(file => [file.path.replace(/\.json$/v, ''), file.trackCount]))
    const find = (needle: string): number | undefined => [...countsByPrefix].find(([name]) => name.includes(needle))?.[1]
    assert.equal(find('chill-3'), 2, 'the same track twice in one playlist stays twice')
    assert.equal(find('empty'), 0)
    assert.equal(find('cafe-mix'), 3)
    assert.equal(find('liked-songs'), 2)
  })

  it('lists every skipped playlist in index.json with id, name and reason, and still exits non-zero', async () => {
    const directory = join(root, 'skipped')
    const { code, io } = await exportAll(createFakeProvider({ fixtures: MULTI_PLAYLIST_LIBRARY }), directory)
    assert.equal(code, EXIT_CODES.error)
    const { skipped } = await readIndex(directory)
    assert.deepEqual(skipped, [{ id: '7', name: 'Followed Locked', status: 'skipped', reason: 'not-owned' }])
    assert.match(io.stderr.text, /exported \d+ of \d+ playlists; 1 skipped/v)
  })

  it('exports as CSV with .csv names and valid index formats', async () => {
    const directory = join(root, 'csv')
    await exportAll(createFakeProvider({ fixtures: MULTI_PLAYLIST_LIBRARY }), directory, ['--format', 'csv'])
    const index = await readIndex(directory)
    assert.ok(index.files.length > 0)
    for (const file of index.files) {
      assert.match(file.path, /\.csv$/v)
      assert.equal(file.format, 'csv')
      // eslint-disable-next-line no-await-in-loop -- sequential reads keep failures attributable
      const text = await readFile(join(directory, file.path), 'utf8')
      assert.match(text, /^position,title,artists,/v)
      assert.equal(text.split('\r\n').filter(row => row !== '').length - 1, file.trackCount)
    }
  })

  it('refuses to overwrite an earlier --all run without --force and leaves it untouched', async () => {
    const directory = join(root, 'rerun')
    const provider = createFakeProvider({ fixtures: MULTI_PLAYLIST_LIBRARY })
    await exportAll(provider, directory)
    const before = new Map(await Promise.all((await readdir(directory)).map(async name => [name, await readFile(join(directory, name), 'utf8')] as const)))
    const sentinel = join(directory, 'index.json')
    await writeFile(sentinel, 'SENTINEL')

    const again = await exportAll(provider, directory)
    assert.equal(again.code, EXIT_CODES.usage, again.io.stderr.text)
    assert.match(again.io.stderr.text, /--force/v)
    assert.equal(await readFile(sentinel, 'utf8'), 'SENTINEL')
    for (const [name, text] of before) {
      if (name === 'index.json') continue
      // eslint-disable-next-line no-await-in-loop -- sequential reads keep failures attributable
      assert.equal(await readFile(join(directory, name), 'utf8'), text, `${name} must not be rewritten`)
    }

    const forced = await exportAll(provider, directory, ['--force'])
    assert.notEqual(forced.code, EXIT_CODES.usage)
    assert.notEqual(await readFile(sentinel, 'utf8'), 'SENTINEL')
  })

  it('does not write Liked Songs for providers that cannot read them', async () => {
    const directory = join(root, 'no-liked')
    const provider = createFakeProvider({
      fixtures: MULTI_PLAYLIST_LIBRARY,
      capabilities: { likedSongs: { read: 'none', write: false } }
    })
    await exportAll(provider, directory)
    assert.ok(!(await readdir(directory)).some(name => name.startsWith('liked-songs')))
  })

  it('an authentication failure mid-run aborts with the auth exit code and writes no misleading partial directory', async () => {
    const directory = join(root, 'auth-expiry')
    const provider = createFakeProvider({ fixtures: MULTI_PLAYLIST_LIBRARY })
    const original = provider.getPlaylistTracks.bind(provider)
    let reads = 0
    provider.getPlaylistTracks = async (...args) => {
      reads += 1
      if (reads > 2) throw new AuthRequiredError('token-expired')
      return await original(...args)
    }
    const { code, io } = await exportAll(provider, directory)
    assert.equal(code, EXIT_CODES.authRequired, io.stderr.text)
    assert.match(io.stderr.text, /Authentication required/v)
    assert.deepEqual(await readdir(directory).catch(() => []), [], 'no index.json claiming success for a half-read library')
  })

  it('--all without -o, or mixed with explicit playlists, is a usage error that writes nothing', async () => {
    const provider = createFakeProvider({ fixtures: MULTI_PLAYLIST_LIBRARY })
    const noDir = await runCommands([createExportCommand(() => provider)], ['export', '--all'])
    assert.equal(noDir.code, EXIT_CODES.usage)
    const directory = join(root, 'mixed')
    const mixed = await exportAll(provider, directory, ['Chill'])
    assert.equal(mixed.code, EXIT_CODES.usage, mixed.io.stderr.text)
    assert.deepEqual(await readdir(directory).catch(() => []), [])
  })
})
