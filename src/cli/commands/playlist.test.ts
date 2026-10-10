import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import { createPlaylistCommands } from './playlist.ts'
import { EXIT_CODES, runCli, type CliIO } from '../index.ts'
import { getRegisteredCommands } from '../registry.ts'
import { AccessRestrictedError } from '../../core/provider/errors.ts'
import { createFakeProvider } from '../../core/provider/fake/index.ts'
import type { Provider } from '../../core/provider/provider.ts'

class CaptureWritable extends Writable {
  readonly chunks: string[] = []

  override _write (chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString())
    callback()
  }

  get text (): string {
    return this.chunks.join('')
  }
}

function createIO (stdoutIsTTY = false): CliIO & {
  stdout: CaptureWritable
  stderr: CaptureWritable
} {
  return {
    stdin: new PassThrough(),
    stdout: new CaptureWritable(),
    stderr: new CaptureWritable(),
    stdoutIsTTY,
    stderrIsTTY: false,
    stdinIsTTY: false
  }
}

function createProvider (playlists: Array<{
  id: string
  name: string
  trackIds?: string[]
  owned?: boolean
  itemsReadable?: boolean
  public?: boolean
  collaborative?: boolean
}> = [], pageSize = 1): Provider {
  const trackIds = [...new Set(playlists.flatMap(playlist => playlist.trackIds ?? []))]
  return createFakeProvider({
    fixtures: {
      playlists: playlists.map(playlist => ({
        id: playlist.id,
        name: playlist.name,
        owner: { id: `owner-${playlist.id}`, displayName: `Owner ${playlist.id}` },
        trackIds: playlist.trackIds ?? [],
        ...(playlist.owned === undefined ? {} : { owned: playlist.owned }),
        ...(playlist.itemsReadable === undefined ? {} : { itemsReadable: playlist.itemsReadable }),
        ...(playlist.public === undefined ? {} : { public: playlist.public }),
        ...(playlist.collaborative === undefined ? {} : { collaborative: playlist.collaborative })
      })),
      catalog: trackIds.map(id => ({
        id,
        title: `Track ${id}`,
        artists: [`Artist ${id}`],
        album: `Album ${id}`,
        durationMs: 180000
      }))
    },
    capabilities: {
      readPageSize: { playlists: pageSize, playlistItems: pageSize, liked: pageSize }
    }
  })
}

function readPlaylistId (text: string): string {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || !('playlist' in parsed)) {
    throw new TypeError('Expected playlist JSON output')
  }
  const { playlist } = parsed
  if (typeof playlist !== 'object' || playlist === null || !('id' in playlist) || typeof playlist.id !== 'string') {
    throw new TypeError('Expected playlist JSON output to contain a string ID')
  }
  return playlist.id
}

function readJsonObject (text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('Expected a JSON object')
  }
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed)) {
    result[key] = value
  }
  return result
}

async function run (argv: string[], provider: Provider): Promise<{
  exitCode: number
  io: ReturnType<typeof createIO>
}> {
  const io = createIO()
  const exitCode = await runCli(argv, {
    commands: createPlaylistCommands(() => provider),
    io,
    processEnv: { SPLE_DEFAULT_PROVIDER: 'fake' },
    envFilePath: '.sple-playlist-no-env'
  })
  return { exitCode, io }
}

describe('playlist list command', () => {
  it('lists all pages with playlist metadata in stable columns', async () => {
    const provider = createProvider([
      { id: '1', name: 'Road Trip', trackIds: ['a'], public: true, collaborative: false },
      { id: '2', name: 'Shared', owned: false, itemsReadable: true, trackIds: ['b'], collaborative: true }
    ])

    const { exitCode, io } = await run(['playlist', 'list'], provider)

    assert.equal(exitCode, EXIT_CODES.success)
    assert.equal(io.stdout.text, [
      'Road Trip\t1\t1\tOwner 1\ttrue\ttrue\tfalse',
      'Shared\t2\t1\tOwner 2\tfalse\t\ttrue',
      ''
    ].join('\n'))
    assert.equal(io.stderr.text, '')
  })

  it('applies owned/followed filters and prints IDs in quiet mode', async () => {
    const provider = createProvider([
      { id: '1', name: 'Mine' },
      { id: '2', name: 'Theirs', owned: false, itemsReadable: true }
    ])

    const { exitCode, io } = await run(['playlist', 'list', '--followed', '--quiet'], provider)

    assert.equal(exitCode, EXIT_CODES.success)
    assert.equal(io.stdout.text, '2\n')
    assert.equal(io.stderr.text, '')
  })

  it('rejects mutually exclusive filters before listing', async () => {
    const provider = createProvider([{ id: '1', name: 'Mine' }])
    let calls = 0
    const { listPlaylists } = provider
    provider.listPlaylists = async (...args) => {
      calls += 1
      return await listPlaylists(...args)
    }

    const { exitCode, io } = await run(['playlist', 'list', '--owned', '--followed'], provider)

    assert.equal(exitCode, EXIT_CODES.usage)
    assert.equal(calls, 0)
    assert.match(io.stderr.text, /--owned and --followed cannot be used together/v)
  })

  it('reports an empty result on stderr', async () => {
    const { exitCode, io } = await run(['playlist', 'list'], createProvider())

    assert.equal(exitCode, EXIT_CODES.success)
    assert.equal(io.stdout.text, '')
    assert.equal(io.stderr.text, 'No playlists.\n')
  })

  it('returns the playlist summaries and filtered total in JSON mode', async () => {
    const provider = createProvider([
      { id: '1', name: 'Mine' },
      { id: '2', name: 'Theirs', owned: false }
    ])

    const { exitCode, io } = await run(['playlist', 'list', '--owned', '--json'], provider)
    const output = readJsonObject(io.stdout.text)

    assert.equal(exitCode, EXIT_CODES.success)
    assert.equal(output.total, 1)
    assert.equal(io.stderr.text, '')
    assert.deepEqual(output.playlists, [{
      ref: '1',
      id: '1',
      name: 'Mine',
      owner: { id: 'owner-1', displayName: 'Owner 1' },
      owned: true,
      itemsReadable: true,
      trackCount: 0
    }])
  })

  it('prints an empty JSON list result while reporting no playlists on stderr', async () => {
    const { exitCode, io } = await run(['playlist', 'list', '--json'], createProvider())

    assert.equal(exitCode, EXIT_CODES.success)
    assert.deepEqual(readJsonObject(io.stdout.text), { playlists: [], total: 0 })
    assert.equal(io.stderr.text, 'No playlists.\n')
  })
})

describe('playlist show command', () => {
  it('resolves ID/name and prints all track pages in quiet mode', async () => {
    const provider = createProvider([
      { id: '1', name: 'Road Trip', trackIds: ['a', 'b'] }
    ])

    const { exitCode, io } = await run(['playlist', 'show', 'Road Trip', '--quiet'], provider)

    assert.equal(exitCode, EXIT_CODES.success)
    assert.equal(io.stdout.text, 'fake:track:a\nfake:track:b\n')
    assert.equal(io.stderr.text, '')
  })

  it('returns full canonical tracks with positions in JSON mode', async () => {
    const provider = createProvider([
      { id: '1', name: 'Road Trip', trackIds: ['a', 'b'] }
    ])

    const { exitCode, io } = await run(['playlist', 'show', '1', '--json'], provider)
    const output = readJsonObject(io.stdout.text)

    assert.equal(exitCode, EXIT_CODES.success)
    assert.equal(readPlaylistId(io.stdout.text), '1')
    assert.deepEqual(output.tracks, [
      {
        title: 'Track a',
        artists: ['Artist a'],
        refs: { fake: 'fake:track:a' },
        album: 'Album a',
        durationMs: 180000,
        position: 1
      },
      {
        title: 'Track b',
        artists: ['Artist b'],
        refs: { fake: 'fake:track:b' },
        album: 'Album b',
        durationMs: 180000,
        position: 2
      }
    ])
    assert.deepEqual(output.unsupportedItems, [])
    assert.equal(io.stderr.text, '')
  })

  it('formats the human-readable track columns and duration', async () => {
    const provider = createProvider([{ id: '1', name: 'Trip', trackIds: ['a'] }])

    const { exitCode, io } = await run(['playlist', 'show', '1'], provider)

    assert.equal(exitCode, EXIT_CODES.success)
    assert.equal(io.stdout.text, [
      '1\tTrack a\tArtist a\tAlbum a\t3:00\t\tfake:track:a',
      ''
    ].join('\n'))
  })

  it('uses a case-sensitive match before a case-insensitive match', async () => {
    const provider = createProvider([
      { id: '1', name: 'mix', trackIds: ['a'] },
      { id: '2', name: 'Mix', trackIds: ['b'] }
    ])

    const { exitCode, io } = await run(['playlist', 'show', 'Mix', '--json'], provider)

    assert.equal(exitCode, EXIT_CODES.success)
    assert.equal(readPlaylistId(io.stdout.text), '2')
  })

  it('falls back from a bare missing ID to a playlist-name lookup', async () => {
    const provider = createProvider([{ id: '1', name: '99', trackIds: ['a'] }])

    const { exitCode, io } = await run(['playlist', 'show', '99', '--json'], provider)

    assert.equal(exitCode, EXIT_CODES.success)
    assert.equal(readPlaylistId(io.stdout.text), '1')
  })

  it('returns usage error and lists matches for an ambiguous name', async () => {
    const provider = createProvider([
      { id: '1', name: 'Mix' },
      { id: '2', name: 'Mix' }
    ])

    const { exitCode, io } = await run(['playlist', 'show', 'Mix'], provider)

    assert.equal(exitCode, EXIT_CODES.usage)
    assert.match(io.stderr.text, /Ambiguous playlist name "Mix"/v)
    assert.match(io.stderr.text, /• Mix \(id: 1, owner: Owner 1 \(owned\)\)/v)
    assert.match(io.stderr.text, /• Mix \(id: 2, owner: Owner 2 \(owned\)\)/v)
  })

  it('uses the case-insensitive matching tier only after no exact match', async () => {
    const provider = createProvider([
      { id: '1', name: 'mix' },
      { id: '2', name: 'MIX' }
    ])

    const { exitCode, io } = await run(['playlist', 'show', 'Mix'], provider)

    assert.equal(exitCode, EXIT_CODES.usage)
    assert.match(io.stderr.text, /id: 1/v)
    assert.match(io.stderr.text, /id: 2/v)
  })

  it('returns not found for an unmatched name', async () => {
    const { exitCode, io } = await run(['playlist', 'show', 'missing'], createProvider())

    assert.equal(exitCode, EXIT_CODES.notFound)
    assert.match(io.stderr.text, /playlist not found: missing/v)
  })

  it('fails early for reported unreadability with an actionable workaround', async () => {
    const provider = createProvider([
      { id: '1', name: 'Restricted', owned: false, itemsReadable: false }
    ])
    let trackCalls = 0
    const { getPlaylistTracks } = provider
    provider.getPlaylistTracks = async (...args) => {
      trackCalls += 1
      return await getPlaylistTracks(...args)
    }

    const { exitCode, io } = await run(['playlist', 'show', '1'], provider)

    assert.equal(exitCode, EXIT_CODES.error)
    assert.equal(trackCalls, 0)
    assert.match(io.stderr.text, /reports that this playlist's tracks are restricted/v)
    assert.match(io.stderr.text, /copy its tracks into a playlist you own/v)
  })

  it('handles access restrictions returned while reading playlist items', async () => {
    const provider = createProvider([{ id: '1', name: 'Restricted' }])
    provider.getPlaylistTracks = async () => await Promise.reject(
      new AccessRestrictedError('not-owned')
    )

    const { exitCode, io } = await run(['playlist', 'show', '1'], provider)

    assert.equal(exitCode, EXIT_CODES.error)
    assert.match(io.stderr.text, /tracks are restricted/v)
    assert.match(io.stderr.text, /copy its tracks into a playlist you own/v)
  })

  it('does not assert collaborator support for a readable non-owned playlist', async () => {
    const provider = createProvider([
      { id: '1', name: 'Shared', owned: false, itemsReadable: true, trackIds: ['a'] }
    ])

    const { exitCode, io } = await run(['playlist', 'show', '1'], provider)

    assert.equal(exitCode, EXIT_CODES.success)
    assert.equal(io.stderr.text, '')
    assert.doesNotMatch(io.stderr.text, /collaborat/iv)
  })

  it('does not retry a missing URI as a playlist name', async () => {
    const provider = createProvider([{ id: '1', name: 'fake:playlist:999' }])
    let listCalls = 0
    const { listPlaylists } = provider
    provider.listPlaylists = async (...args) => {
      listCalls += 1
      return await listPlaylists(...args)
    }

    const { exitCode } = await run(['playlist', 'show', 'fake:playlist:999'], provider)

    assert.equal(exitCode, EXIT_CODES.notFound)
    assert.equal(listCalls, 0)
  })

  it('warns about unsupported items and advances offset pagination by request size', async () => {
    const provider = createProvider([{ id: '1', name: 'Partial', trackIds: ['a'] }])
    const offsets: number[] = []
    const { getPlaylistTracks } = provider
    provider.getPlaylistTracks = async (ref, page) => {
      const offset = page.offset ?? 0
      offsets.push(offset)
      if (offset === 0) return { items: [], total: 2 }
      const remaining = await getPlaylistTracks(ref, { limit: page.limit, offset: 0 })
      return { items: remaining.items, total: 2 }
    }

    const { exitCode, io } = await run(['playlist', 'show', '1', '--json'], provider)

    assert.equal(exitCode, EXIT_CODES.success)
    assert.deepEqual(readJsonObject(io.stdout.text), {
      playlist: {
        ref: '1',
        id: '1',
        name: 'Partial',
        owner: { id: 'owner-1', displayName: 'Owner 1' },
        owned: true,
        itemsReadable: true,
        trackCount: 1
      },
      tracks: [{
        title: 'Track a',
        artists: ['Artist a'],
        refs: { fake: 'fake:track:a' },
        album: 'Album a',
        durationMs: 180000,
        position: 1
      }],
      unsupportedItems: []
    })
    assert.deepEqual(offsets, [0, 1])
    assert.match(io.stderr.text, /1 of 2 items in "Partial" are not supported/v)
  })

  it('reports an empty playlist on stderr', async () => {
    const { exitCode, io } = await run(
      ['playlist', 'show', '1'],
      createProvider([{ id: '1', name: 'Empty' }])
    )

    assert.equal(exitCode, EXIT_CODES.success)
    assert.equal(io.stdout.text, '')
    assert.equal(io.stderr.text, 'Playlist "Empty" has no tracks.\n')
  })

  it('prints an empty show result in JSON mode', async () => {
    const { exitCode, io } = await run(
      ['playlist', 'show', '1', '--json'],
      createProvider([{ id: '1', name: 'Empty' }])
    )

    assert.equal(exitCode, EXIT_CODES.success)
    assert.deepEqual(readJsonObject(io.stdout.text), {
      playlist: {
        ref: '1',
        id: '1',
        name: 'Empty',
        owner: { id: 'owner-1', displayName: 'Owner 1' },
        owned: true,
        itemsReadable: true,
        trackCount: 0
      },
      tracks: [],
      unsupportedItems: []
    })
    assert.equal(io.stderr.text, 'Playlist "Empty" has no tracks.\n')
  })
})

describe('playlist command registration', () => {
  it('registers list and show for the default CLI', () => {
    const paths = getRegisteredCommands().map(command => command.path.join(' '))

    assert.ok(paths.includes('playlist list'))
    assert.ok(paths.includes('playlist show'))
  })

  it('resolves the configured fake provider only when registered', async () => {
    const io = createIO()
    const exitCode = await runCli(['playlist', 'list'], {
      io,
      processEnv: {
        SPLE_DEFAULT_PROVIDER: 'fake',
        SPLE_ENABLE_FAKE_PROVIDER: '1'
      },
      envFilePath: '.sple-playlist-no-env'
    })

    assert.equal(exitCode, EXIT_CODES.success)
    assert.equal(io.stderr.text, 'No playlists.\n')
  })
})
