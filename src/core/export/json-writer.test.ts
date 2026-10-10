import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Ajv2020 } from 'ajv/dist/2020.js'
import type { ValidateFunction } from 'ajv'
import type { CanonicalPlaylistFile } from './format.ts'
import { serializePlaylistJSON } from './json-writer.ts'

const schemaPath = fileURLToPath(new URL('../../../schemas/canonical-playlist.v1.schema.json', import.meta.url))
const schema: unknown = JSON.parse(readFileSync(schemaPath, 'utf8'))
const validate: ValidateFunction = new Ajv2020({ strict: true }).compile(schema)

function asRecord (value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value))
  return value
}

function asArray (value: unknown): unknown[] {
  assert.ok(Array.isArray(value))
  return value
}

function fixture (): CanonicalPlaylistFile {
  return {
    schemaVersion: 1,
    exportedAt: '2026-09-01T12:34:56Z',
    generator: { name: 'sple', version: '0.1.0' },
    source: { provider: 'spotify', kind: 'playlist', userId: 'user-1' },
    playlist: {
      id: 'playlist-1',
      name: 'Playlist',
      owner: { id: 'owner-1', displayName: 'Owner' },
      trackCount: 2
    },
    tracks: [
      {
        title: 'Track B',
        artists: ['Artist B'],
        isrc: null,
        refs: { spotify: 'spotify:track:b', 'youtube-music': 'track-b' },
        position: 2
      },
      {
        title: 'Track A',
        artists: ['Artist A'],
        album: 'Album A',
        durationMs: 123000,
        isrc: 'USABC1234567',
        refs: { spotify: 'spotify:track:a' },
        addedAt: '2026-08-01T00:00:00Z',
        position: 1
      }
    ],
    unsupportedItems: []
  }
}

test('serializes canonical JSON that validates against the v1 schema', () => {
  const serialized = serializePlaylistJSON(fixture())
  const parsed: unknown = JSON.parse(serialized)
  assert.equal(serialized.endsWith('\n'), true)
  assert.equal(validate(parsed), true, JSON.stringify(validate.errors))
})

test('keeps optional ISRC and provider refs lossless while sorting tracks', () => {
  const parsed = asRecord(JSON.parse(serializePlaylistJSON(fixture())))
  const tracks = asArray(parsed.tracks)
  assert.deepEqual(tracks.map((track) => asRecord(track).position), [1, 2])
  assert.equal(asRecord(tracks[0]).isrc, 'USABC1234567')
  assert.equal(asRecord(tracks[1]).isrc, null)
  assert.deepEqual(asRecord(tracks[1]).refs, {
    spotify: 'spotify:track:b',
    'youtube-music': 'track-b'
  })
})

test('serializes provider refs in a stable key order', () => {
  const file = fixture()
  const { tracks: [, secondTrack] } = file
  assert.ok(secondTrack !== undefined)
  secondTrack.refs = {
    'youtube-music': 'track-b',
    spotify: 'spotify:track:b'
  }

  const serialized = serializePlaylistJSON(file)
  assert.ok(serialized.indexOf('"spotify"') < serialized.indexOf('"youtube-music"'))
  assert.equal(serialized, serializePlaylistJSON({
    ...file,
    tracks: file.tracks.map((track) => ({
      ...track,
      refs: Object.fromEntries(Object.entries(track.refs).reverse())
    }))
  }))
})

test('omits absent optional fields and strips runtime-only properties', () => {
  const file = fixture()
  const { tracks: [firstTrack] } = file
  assert.ok(firstTrack !== undefined)
  Object.assign(firstTrack, { unexpected: 'must not leak' })
  const serialized = serializePlaylistJSON(file)
  const parsed = asRecord(JSON.parse(serialized))
  const tracks = asArray(parsed.tracks)
  const [, optionalTrackValue] = tracks
  const optionalTrack = asRecord(optionalTrackValue)
  assert.equal('isrc' in optionalTrack, true)
  assert.equal('album' in optionalTrack, false)
  assert.equal('unexpected' in optionalTrack, false)
})

test('rejects files that violate canonical invariants', () => {
  const file = fixture()
  file.playlist.trackCount = 3
  assert.throws(() => serializePlaylistJSON(file), /trackCount/v)
})
