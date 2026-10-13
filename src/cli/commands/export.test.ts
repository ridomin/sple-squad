import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { PassThrough, Writable } from 'node:stream'
import { createFakeProvider } from '../../core/provider/fake/fake-provider.ts'
import type { Provider } from '../../core/provider/provider.ts'
import { AuthRequiredError } from '../../core/provider/errors.ts'
import { createExportCommand } from './export.ts'
import { runCli } from '../framework.ts'
import type { CliIO } from '../framework.ts'
import { getRegisteredCommands } from '../registry.ts'

const testRoot = join(process.cwd(), `.sple-export-cli-test-${process.pid}-${randomUUID()}`)
const PLAYLIST_NAME = 'Café Mix'
const PLAYLIST_ID = 'mix-1'
const CATALOG_TRACK_ID = 'track-1'

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

function createIO (): CliIO & { stdout: CaptureWritable, stderr: CaptureWritable } {
  return {
    stdin: new PassThrough(),
    stdout: new CaptureWritable(),
    stderr: new CaptureWritable(),
    stdoutIsTTY: false,
    stderrIsTTY: false,
    stdinIsTTY: false
  }
}

function createProvider (): Provider {
  return createFakeProvider({
    fixtures: {
      catalog: [{
        id: CATALOG_TRACK_ID,
        title: 'Luminous',
        artists: ['Artist'],
        album: 'Record',
        durationMs: 123000,
        isrc: 'USABC1234567',
        addedAt: '2026-10-01T12:00:00Z'
      }],
      playlists: [{
        id: PLAYLIST_ID,
        name: PLAYLIST_NAME,
        owner: { id: 'owner-1', displayName: 'Owner' },
        trackIds: [CATALOG_TRACK_ID]
      }],
      liked: [CATALOG_TRACK_ID]
    }
  })
}

function asRecord (value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value))
  return value
}

function asArray (value: unknown): unknown[] {
  assert.ok(Array.isArray(value))
  return value
}

function parseRecord (text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text)
  return asRecord(parsed)
}

async function invoke (
  args: string[],
  provider: Provider
): Promise<{ code: number, io: ReturnType<typeof createIO> }> {
  const io = createIO()
  const code = await runCli(args, {
    commands: [createExportCommand(() => provider)],
    io,
    processEnv: {}
  })
  return { code, io }
}

before(async () => {
  await mkdir(testRoot, { recursive: true })
})

after(async () => {
  await rm(testRoot, { recursive: true, force: true })
})

test('the export CLI writes lossless canonical JSON to stdout', async () => {
  const { code, io } = await invoke(['export', PLAYLIST_NAME], createProvider())
  assert.equal(code, 0)
  const output = parseRecord(io.stdout.text)
  const source = asRecord(output.source)
  const playlist = asRecord(output.playlist)
  const tracks = asArray(output.tracks)
  const [firstTrackValue] = tracks
  const firstTrack = asRecord(firstTrackValue)
  assert.equal(output.schemaVersion, 1)
  assert.equal(source.provider, 'fake')
  assert.equal(playlist.name, PLAYLIST_NAME)
  assert.equal(firstTrack.isrc, 'USABC1234567')
  assert.equal(io.stderr.text, '')
})

test('the export CLI writes RFC 4180 CSV to stdout', async () => {
  const { code, io } = await invoke(['export', PLAYLIST_NAME, '--format', 'csv'], createProvider())
  assert.equal(code, 0)
  const rows = io.stdout.text.split('\r\n')
  assert.equal(rows[0], 'position,title,artists,album,duration_ms,added_at,isrc,ref')
  assert.equal(rows.length, 3)
  assert.match(rows[1] ?? '', /^1,Luminous,Artist,Record,123000,2026-10-01T12:00:00Z,USABC1234567,fake:track:track-1$/v)
})

test('the production command registry exposes export and its CLI help', async () => {
  assert.ok(getRegisteredCommands().some(command => command.path.join(' ') === 'export'))
  const io = createIO()
  const code = await runCli(['export', '--help'], { io, processEnv: {} })
  assert.equal(code, 0)
  assert.match(io.stdout.text, /^Usage: sple export /v)
})

test('directory exports use slug-id names and protect existing files unless forced', async () => {
  const directory = join(testRoot, 'named-output')
  await mkdir(directory)
  const outputFile = join(directory, 'cafe-mix-mix-1.json')
  const first = await invoke(['export', PLAYLIST_NAME, '-o', directory], createProvider())
  assert.equal(first.code, 0)
  assert.deepEqual(await readdir(directory), ['cafe-mix-mix-1.json'])
  assert.equal(asRecord(asRecord(JSON.parse(await readFile(outputFile, 'utf8'))).playlist).name, PLAYLIST_NAME)

  const protectedWrite = await invoke(['export', PLAYLIST_NAME, '-o', outputFile], createProvider())
  assert.equal(protectedWrite.code, 2)
  assert.equal(
    protectedWrite.io.stderr.text,
    `sple: Export target already exists; use --force to overwrite: ${outputFile}\n`
  )
  assert.equal(asArray(parseRecord(await readFile(outputFile, 'utf8')).tracks).length, 1)

  const forced = await invoke(['export', PLAYLIST_NAME, '-o', outputFile, '--force', '--json'], createProvider())
  assert.equal(forced.code, 0)
  const summary = parseRecord(forced.io.stdout.text)
  assert.equal(asArray(summary.files).length, 1)
})

test('file destinations passed as directories are usage errors that preserve the destination', async () => {
  const destination = join(testRoot, 'file-destination')
  await writeFile(destination, 'original destination')

  const { code, io } = await invoke(['export', PLAYLIST_NAME, '-o', `${destination}/`], createProvider())
  assert.equal(code, 2)
  assert.equal(io.stdout.text, '')
  assert.equal(io.stderr.text, `sple: Export destination is not a directory: ${destination}\n`)
  assert.equal(await readFile(destination, 'utf8'), 'original destination')
})

test('the --all caller writes an index and records unreadable playlists as skipped', async () => {
  const inaccessible = {
    id: 'private-2',
    name: 'Private',
    owner: { id: 'other' },
    owned: false,
    itemsReadable: false,
    trackIds: [CATALOG_TRACK_ID]
  }
  const provider = createFakeProvider({
    fixtures: {
      catalog: [{
        id: CATALOG_TRACK_ID,
        title: 'Luminous',
        artists: ['Artist'],
        isrc: null
      }],
      playlists: [
        { id: PLAYLIST_ID, name: PLAYLIST_NAME, owner: { id: 'owner-1' }, trackIds: [CATALOG_TRACK_ID] },
        inaccessible
      ],
      liked: [CATALOG_TRACK_ID]
    }
  })
  const directory = join(testRoot, 'all-output')
  const { code, io } = await invoke(['export', '--all', '-o', directory], provider)
  assert.equal(code, 1)
  const entries = await readdir(directory)
  assert.deepEqual(entries.sort(), ['cafe-mix-mix-1.json', 'index.json', 'liked-songs.json'])
  const index = parseRecord(await readFile(join(directory, 'index.json'), 'utf8'))
  assert.equal(asArray(index.files).length, 2)
  const skipped = asArray(index.skipped)
  assert.equal(skipped.length, 1)
  assert.equal(asRecord(skipped[0]).status, 'skipped')
  assert.equal(asRecord(skipped[0]).reason, 'not-owned')
  assert.match(io.stderr.text, /Could not export "private-2"/v)

  const playlistPath = join(directory, 'cafe-mix-mix-1.json')
  const before = await readFile(playlistPath, 'utf8')
  const protectedRerun = await invoke(['export', '--all', '-o', directory], provider)
  assert.equal(protectedRerun.code, 2)
  assert.match(protectedRerun.io.stderr.text, /use --force to overwrite/v)
  assert.equal(await readFile(playlistPath, 'utf8'), before)

  const forcedRerun = await invoke(['export', '--all', '-o', directory, '--force'], provider)
  assert.equal(forcedRerun.code, 1)
  const afterForce = parseRecord(await readFile(playlistPath, 'utf8'))
  assert.equal(asRecord(afterForce.playlist).name, PLAYLIST_NAME)
  assert.equal(asArray(afterForce.tracks).length, 1)
})

test('Liked Songs requires Spotify library scope and names the canonical source', async () => {
  const base = createProvider()
  const spotifyProvider: Provider = {
    ...base,
    id: 'spotify',
    auth: {
      ...base.auth,
      status: async () => await Promise.resolve({ loggedIn: true, scopes: [] })
    }
  }
  const destination = join(testRoot, 'liked.json')
  const denied = await invoke(['export', '--liked', '-o', destination], spotifyProvider)
  assert.equal(denied.code, 3)
  assert.match(denied.io.stderr.text, /user-library-read/v)
  await assert.rejects(readFile(destination))

  const allowedProvider: Provider = {
    ...spotifyProvider,
    auth: {
      ...spotifyProvider.auth,
        status: async () => await Promise.resolve({
        loggedIn: true,
        scopes: ['user-library-read'],
        user: { id: 'spotify-user' }
      })
    }
  }
  const allowed = await invoke(['export', '--liked'], allowedProvider)
  assert.equal(allowed.code, 0)
  const exported = parseRecord(allowed.io.stdout.text)
  assert.equal(asRecord(exported.source).kind, 'liked')
  assert.equal(asRecord(exported.playlist).name, 'Liked Songs')
})

test('Liked Songs counts unsupported provider items in its warning', async () => {
  const base = createProvider()
  const provider: Provider = {
    ...base,
    getLikedTracks: async request => {
      const page = await base.getLikedTracks(request)
      return { ...page, total: (page.total ?? page.items.length) + 2 }
    }
  }
  const { code, io } = await invoke(['export', '--liked'], provider)
  assert.equal(code, 0)
  assert.match(io.stderr.text, /warning: skipped 2 unsupported items .* and were not exported/v)
})

test('unsupported provider items are omitted and counted in a stderr warning', async () => {
  const base = createProvider()
  const provider: Provider = {
    ...base,
    getPlaylistTracks: async (ref, request) => {
      const page = await base.getPlaylistTracks(ref, request)
      return { ...page, total: (page.total ?? page.items.length) + 2 }
    }
  }
  const { code, io } = await invoke(['export', PLAYLIST_NAME], provider)
  assert.equal(code, 0)
  assert.equal(asRecord(parseRecord(io.stdout.text).playlist).trackCount, 1)
  assert.match(io.stderr.text, /warning: skipped 2 unsupported items/v)
})

test('invalid stdout JSON mode is rejected before provider retrieval', async () => {
  const provider = createProvider()
  let retrieved = false
  const guardedProvider: Provider = {
    ...provider,
    getPlaylist: async () => {
      retrieved = true
      return await provider.getPlaylist(PLAYLIST_ID)
    }
  }
  const { code, io } = await invoke(['export', PLAYLIST_NAME, '--json'], guardedProvider)
  assert.equal(code, 2)
  assert.equal(retrieved, false)
  assert.match(io.stderr.text, /cannot be used when export data is written to stdout/v)
})

test('empty playlist arguments are usage errors before provider retrieval', async () => {
  const provider = createProvider()
  let retrieved = false
  const guardedProvider: Provider = {
    ...provider,
    getPlaylist: async () => {
      retrieved = true
      return await provider.getPlaylist(PLAYLIST_ID)
    }
  }

  const { code, io } = await invoke(['export', ''], guardedProvider)
  assert.equal(code, 2)
  assert.equal(io.stdout.text, '')
  assert.equal(io.stderr.text, 'sple: Playlist arguments must not be empty\n')
  assert.equal(retrieved, false)
})

test('ambiguous playlist names fail before creating output targets', async () => {
  const provider = createFakeProvider({
    fixtures: {
      playlists: [
        { id: 'first', name: 'Twin', owner: { id: 'owner-a' }, trackIds: [] },
        { id: 'second', name: 'Twin', owner: { id: 'owner-b' }, trackIds: [] }
      ]
    }
  })

  test('duplicate playlist sources are exported once and warn before output', async () => {
    const directory = join(testRoot, 'duplicate-output')
    const { code, io } = await invoke(
      ['export', PLAYLIST_NAME, PLAYLIST_NAME, '-o', `${directory}/`],
      createProvider()
    )
    assert.equal(code, 0)
    assert.deepEqual(await readdir(directory), ['cafe-mix-mix-1.json'])
    assert.match(io.stderr.text, /resolves to a source already listed and will be exported once/v)
  })

  test('an authentication failure after an earlier read leaves no output directory', async () => {
    const secondPlaylistId = 'mix-2'
    const base = createFakeProvider({
      fixtures: {
        catalog: [{
          id: CATALOG_TRACK_ID,
          title: 'Luminous',
          artists: ['Artist']
        }],
        playlists: [
          { id: PLAYLIST_ID, name: PLAYLIST_NAME, owner: { id: 'owner-1' }, trackIds: [CATALOG_TRACK_ID] },
          { id: secondPlaylistId, name: 'Second Mix', owner: { id: 'owner-1' }, trackIds: [CATALOG_TRACK_ID] }
        ]
      }
    })
    const provider: Provider = {
      ...base,
      getPlaylistTracks: async (ref, request) => {
        if (ref === secondPlaylistId) throw new AuthRequiredError('token-expired')
        return await base.getPlaylistTracks(ref, request)
      }
    }
    const destination = join(testRoot, 'auth-failure-output')
    const { code, io } = await invoke(['export', PLAYLIST_NAME, 'Second Mix', '-o', destination], provider)
    assert.equal(code, 3)
    assert.match(io.stderr.text, /Authentication required/v)
    await assert.rejects(readdir(destination))
  })
  const destination = join(testRoot, 'ambiguous-output')
  const { code, io } = await invoke(['export', 'Twin', '-o', destination], provider)
  assert.equal(code, 2)
  assert.match(io.stderr.text, /Ambiguous playlist name "Twin"/v)
  await assert.rejects(readdir(destination))
})

test('a single missing playlist preserves its provider error and does not create output', async () => {
  const destination = join(testRoot, 'missing.json')
  const { code, io } = await invoke(['export', 'missing', '-o', destination], createProvider())
  assert.equal(code, 4)
  assert.match(io.stderr.text, /^sple: playlist not found: missing\n$/v)
  await assert.rejects(readFile(destination))
})
