// Ajv strict-mode compile + fixture validation for the canonical playlist
// v1 JSON Schema (ADR-0008 §3, issue #6). The schema's job is structural
// validation only; invariants it can't express (unique positions,
// trackCount consistency, etc.) are covered by src/core/export/invariants.ts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Ajv2020 } from 'ajv/dist/2020.js'
import type { ValidateFunction } from 'ajv'
import type { CanonicalPlaylistFile } from '../src/core/export/format.ts'
import { LIKED_SONGS_NAME } from '../src/core/export/format.ts'

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function at<T> (items: T[], index: number): T {
  const { [index]: item } = items
  assert.ok(item !== undefined, `expected an item at index ${index}`)
  return item
}

function asArray (value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(message)
  }
  return value
}

function readSchema (path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!isRecord(parsed)) {
    throw new TypeError(`expected ${path} to contain a JSON object`)
  }
  return parsed
}

const SCHEMA_PATH = fileURLToPath(new URL('./canonical-playlist.v1.schema.json', import.meta.url))
const schema = readSchema(SCHEMA_PATH)

const ajv = new Ajv2020({ strict: true })
const validate: ValidateFunction = ajv.compile(schema)

function cloneAsRecord (file: CanonicalPlaylistFile): Record<string, unknown> {
  const parsed: unknown = JSON.parse(JSON.stringify(file))
  if (!isRecord(parsed)) {
    throw new TypeError('expected a JSON object')
  }
  return parsed
}

function firstTrackRecord (file: Record<string, unknown>): Record<string, unknown> {
  const tracks = asArray(file.tracks, 'expected file.tracks to be an array')
  const track = at(tracks, 0)
  if (!isRecord(track)) {
    throw new TypeError('expected file.tracks[0] to be an object')
  }
  return track
}

function regularPlaylistFixture (): CanonicalPlaylistFile {
  return {
    schemaVersion: 1,
    exportedAt: '2026-09-01T12:34:56Z',
    generator: { name: 'sple', version: '0.1.0' },
    source: { provider: 'spotify', kind: 'playlist', userId: 'user-1' },
    playlist: {
      ref: 'spotify:playlist:abc123',
      id: 'abc123',
      name: 'My Playlist',
      description: 'A test playlist',
      owner: { id: 'owner-1', displayName: 'Rido' },
      public: true,
      collaborative: false,
      url: 'https://open.spotify.com/playlist/abc123',
      trackCount: 3
    },
    tracks: [
      {
        title: 'Track A',
        artists: ['Artist A'],
        album: 'Album A',
        durationMs: 210000,
        isrc: 'USABC1234567',
        refs: { spotify: 'spotify:track:aaa' },
        addedAt: '2026-08-01T00:00:00Z',
        position: 1
      },
      {
        title: 'Track B',
        artists: ['Artist B', 'Artist C'],
        isrc: null,
        refs: { spotify: 'spotify:track:bbb', 'youtube-music': 'dQw4w9WgXcQ' },
        position: 2
      }
    ],
    unsupportedItems: [
      { position: 3, kind: 'local', name: 'local-file.mp3' }
    ]
  }
}

function likedSongsFixture (): CanonicalPlaylistFile {
  return {
    schemaVersion: 1,
    exportedAt: '2026-09-01T12:34:56Z',
    generator: { name: 'sple', version: '0.1.0' },
    source: { provider: 'spotify', kind: 'liked' },
    playlist: {
      name: LIKED_SONGS_NAME,
      trackCount: 1
    },
    tracks: [
      { title: 'Track A', artists: ['Artist A'], refs: { spotify: 'spotify:track:aaa' }, position: 1 }
    ],
    unsupportedItems: []
  }
}

test('Ajv compiles the schema in strict mode without errors', () => {
  assert.equal(typeof validate, 'function')
})

test('accepts a regular playlist export with tracks and unsupportedItems', () => {
  const valid = validate(regularPlaylistFixture())
  assert.equal(valid, true, JSON.stringify(validate.errors))
})

test('accepts a Liked Songs export', () => {
  const valid = validate(likedSongsFixture())
  assert.equal(valid, true, JSON.stringify(validate.errors))
})

test('rejects a Liked Songs export with the wrong playlist.name', () => {
  const file = likedSongsFixture()
  file.playlist.name = 'Not Liked Songs'
  const valid = validate(file)
  assert.equal(valid, false)
})

test('rejects an extra unknown top-level property', () => {
  const file: Record<string, unknown> = { ...regularPlaylistFixture(), extra: true }
  const valid = validate(file)
  assert.equal(valid, false)
})

test('rejects an extra unknown property on a track', () => {
  const file = cloneAsRecord(regularPlaylistFixture())
  const tracks = asArray(file.tracks, 'expected file.tracks to be an array')
  tracks[0] = { ...firstTrackRecord(file), bogus: 'nope' }
  const valid = validate(file)
  assert.equal(valid, false)
})

test('allows arbitrary provider keys inside refs', () => {
  const file = regularPlaylistFixture()
  const firstTrack = at(file.tracks, 0)
  firstTrack.refs = { spotify: 'spotify:track:aaa', 'some-new-provider': 'xyz' }
  const valid = validate(file)
  assert.equal(valid, true, JSON.stringify(validate.errors))
})

test('rejects isrc values that are neither a string nor null', () => {
  const file = cloneAsRecord(regularPlaylistFixture())
  const tracks = asArray(file.tracks, 'expected file.tracks to be an array')
  tracks[0] = { ...firstTrackRecord(file), isrc: 42 }
  const valid = validate(file)
  assert.equal(valid, false)
})
