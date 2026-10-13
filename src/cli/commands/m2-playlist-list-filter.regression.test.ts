import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeProvider } from '../../core/provider/fake/fake-provider.ts'
import { EXIT_CODES } from '../exit-codes.ts'
import { createPlaylistCommands, parseNameFilter } from './playlist.ts'
import { asArray, asRecord, parseJsonRecord, runCommands } from './fixtures/m2/harness.ts'
import { MULTI_PLAYLIST_LIBRARY } from './fixtures/m2/library.ts'

async function list (args: string[], pageSize?: number): Promise<{ code: number, stdout: string, stderr: string }> {
  const provider = createFakeProvider({
    fixtures: MULTI_PLAYLIST_LIBRARY,
    ...(pageSize === undefined ? {} : { capabilities: { readPageSize: { playlists: pageSize, playlistItems: 100, liked: 50 } } })
  })
  const { code, io } = await runCommands(createPlaylistCommands(() => provider), ['playlist', 'list', '--quiet', ...args])
  return { code, stdout: io.stdout.text, stderr: io.stderr.text }
}

describe('M2 regression: playlist list --filter', () => {
  it('applies the filter across all provider pages, not just the first', async () => {
    const result = await list(['--filter', 'chill'], 2)
    assert.equal(result.stdout, '2\n3\n')
  })

  it('a /regex/g filter is stateless: every matching playlist is returned', async () => {
    const result = await list(['--filter', '/chill/gi'])
    assert.equal(result.stdout, '2\n3\n')
  })

  it('a /regex/y filter is not sticky: it matches mid-name', async () => {
    assert.equal(parseNameFilter('/hill/y')?.('Chill'), true)
    assert.equal((await list(['--filter', '/hill/y'])).stdout, '2\n3\n')
  })

  it('treats slashes and punctuation inside a literal as plain text', async () => {
    assert.equal((await list(['--filter', 'Road/Trip: 66?'])).stdout, '5\n')
    assert.equal((await list(['--filter', '66?'])).stdout, '5\n')
  })

  it('matches names case-insensitively beyond ASCII', async () => {
    assert.equal((await list(['--filter', 'CAFÉ'])).stdout, '1\n')
  })

  it('matches against the name only, not description or owner', async () => {
    assert.equal((await list(['--filter', 'second'])).stdout, '')
    assert.equal((await list(['--filter', 'someone'])).stdout, '')
  })

  it('exits 0 with a notice for no matches, and an empty list in --json', async () => {
    const quiet = await list(['--filter', 'nothing-matches'])
    assert.equal(quiet.code, EXIT_CODES.success)
    assert.match(quiet.stderr, /No playlists/v)

    const provider = createFakeProvider({ fixtures: MULTI_PLAYLIST_LIBRARY })
    const { code, io } = await runCommands(createPlaylistCommands(() => provider), ['playlist', 'list', '--json', '--filter', 'nothing-matches'])
    assert.equal(code, EXIT_CODES.success)
    assert.deepEqual(parseJsonRecord(io.stdout.text), { playlists: [], total: 0 })
  })

  it('--json emits only matching playlists and a matching total', async () => {
    const provider = createFakeProvider({ fixtures: MULTI_PLAYLIST_LIBRARY })
    const { io } = await runCommands(createPlaylistCommands(() => provider), ['playlist', 'list', '--json', '--filter', '/^chill$/i'])
    const { playlists, total } = parseJsonRecord(io.stdout.text)
    assert.deepEqual(asArray(playlists).map(row => asRecord(row).id), ['2', '3'])
    assert.equal(total, 2)
  })

  it('--followed with --filter excludes owned playlists even when the name matches', async () => {
    assert.equal((await list(['--followed', '--filter', 'followed'])).stdout, '6\n7\n')
    assert.equal((await list(['--owned', '--filter', 'followed'])).stdout, '')
  })

  it('rejects empty, bare, and invalid regex filters with exit 2 and the offending value', async () => {
    for (const filter of ['', '/(/', '/a/z', '/a/uv']) {
      // eslint-disable-next-line no-await-in-loop -- sequential cases keep failures attributable
      const result = await list(['--filter', filter])
      assert.equal(result.code, EXIT_CODES.usage, `filter ${JSON.stringify(filter)}`)
      assert.equal(result.stdout, '')
    }
    assert.match((await list(['--filter', '/(/'])).stderr, /Invalid --filter regular expression: \/\(\//v)
  })

  it('does not list playlists when --filter is invalid', async () => {
    const provider = createFakeProvider({ fixtures: MULTI_PLAYLIST_LIBRARY })
    let calls = 0
    const original = provider.listPlaylists.bind(provider)
    provider.listPlaylists = async (...args) => {
      calls += 1
      return await original(...args)
    }
    const { code } = await runCommands(createPlaylistCommands(() => provider), ['playlist', 'list', '--filter', '/(/'])
    assert.equal(code, EXIT_CODES.usage)
    assert.equal(calls, 0)
  })
})
