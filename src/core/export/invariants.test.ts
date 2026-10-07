import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CanonicalPlaylistFile } from './format.ts'
import { assertPlaylistFile, checkPlaylistFile, ExportFormatError } from './invariants.ts'

function at<T> (items: T[], index: number): T {
  const { [index]: item } = items
  assert.ok(item !== undefined, `expected an item at index ${index}`)
  return item
}

function validFile (): CanonicalPlaylistFile {
  return {
    schemaVersion: 1,
    exportedAt: '2026-09-01T12:34:56Z',
    generator: { name: 'sple', version: '0.1.0' },
    source: { provider: 'spotify', kind: 'playlist' },
    playlist: {
      name: 'My Playlist',
      trackCount: 2
    },
    tracks: [
      { title: 'Track A', artists: ['Artist A'], refs: { spotify: 'spotify:track:aaa' }, position: 1 },
      { title: 'Track B', artists: ['Artist B'], refs: { spotify: 'spotify:track:bbb' }, position: 2 }
    ],
    unsupportedItems: []
  }
}

test('checkPlaylistFile accepts a well-formed v1 file', () => {
  const result = checkPlaylistFile(validFile())
  assert.deepEqual(result, { valid: true, problems: [] })
})

test('assertPlaylistFile does not throw for a well-formed v1 file', () => {
  assert.doesNotThrow(() => { assertPlaylistFile(validFile()) })
})

test('assertPlaylistFile throws ExportFormatError for an invalid file', () => {
  const file = validFile()
  // @ts-expect-error -- intentionally invalid for the test
  file.schemaVersion = 2
  assert.throws(() => { assertPlaylistFile(file) }, ExportFormatError)
})

test('rejects duplicate track positions', () => {
  const file = validFile()
  at(file.tracks, 1).position = 1
  const result = checkPlaylistFile(file)
  assert.equal(result.valid, false)
  assert.ok(result.problems.some((p) => p.includes('unique') && p.includes('duplicated: 1')))
})

test('rejects positions that do not cover 1..trackCount', () => {
  const file = validFile()
  at(file.tracks, 1).position = 3
  const result = checkPlaylistFile(file)
  assert.equal(result.valid, false)
  assert.ok(result.problems.some((p) => p.includes('must cover 1..2')))
})

test('unsupportedItems share the position space with tracks', () => {
  const file = validFile()
  file.tracks = [at(file.tracks, 0)]
  file.unsupportedItems = [{ position: 2, kind: 'local', name: 'local-file.mp3' }]
  file.playlist.trackCount = 2
  const result = checkPlaylistFile(file)
  assert.deepEqual(result, { valid: true, problems: [] })
})

test('rejects trackCount that disagrees with tracks.length + unsupportedItems.length', () => {
  const file = validFile()
  file.playlist.trackCount = 5
  const result = checkPlaylistFile(file)
  assert.equal(result.valid, false)
  assert.ok(result.problems.some((p) => p.includes('trackCount (5) must equal')))
})

test('Liked Songs rule: source.kind "liked" requires playlist.name "Liked Songs"', () => {
  const file = validFile()
  file.source.kind = 'liked'
  file.playlist.name = 'My Playlist'
  const result = checkPlaylistFile(file)
  assert.equal(result.valid, false)
  assert.ok(result.problems.some((p) => p.includes("must be 'Liked Songs'")))
})

test('Liked Songs rule: passes when kind is "liked" and name is "Liked Songs"', () => {
  const file = validFile()
  file.source.kind = 'liked'
  file.playlist.name = 'Liked Songs'
  const result = checkPlaylistFile(file)
  assert.deepEqual(result, { valid: true, problems: [] })
})

test('Liked Songs rule does not apply when source.kind is "playlist"', () => {
  const file = validFile()
  file.playlist.name = 'Liked Songs'
  const result = checkPlaylistFile(file)
  assert.deepEqual(result, { valid: true, problems: [] })
})

test('rejects an empty artists array', () => {
  const file = validFile()
  at(file.tracks, 0).artists = []
  const result = checkPlaylistFile(file)
  assert.equal(result.valid, false)
  assert.ok(result.problems.some((p) => p.includes('tracks[0].artists must be a non-empty array')))
})

test('rejects a track with no provider refs', () => {
  const file = validFile()
  at(file.tracks, 0).refs = {}
  const result = checkPlaylistFile(file)
  assert.equal(result.valid, false)
  assert.ok(result.problems.some((p) => p.includes('tracks[0].refs must have at least one entry')))
})

test('rejects an unsupported schemaVersion', () => {
  const file = validFile()
  // @ts-expect-error -- intentionally invalid for the test
  file.schemaVersion = 2
  const result = checkPlaylistFile(file)
  assert.equal(result.valid, false)
  assert.ok(result.problems.some((p) => p.includes('Unsupported schema version: 2')))
})

test('rejects a non-ISO-8601 exportedAt', () => {
  const file = validFile()
  file.exportedAt = 'not-a-date'
  const result = checkPlaylistFile(file)
  assert.equal(result.valid, false)
  assert.ok(result.problems.some((p) => p.includes('exportedAt')))
})

test('rejects a generator.name other than "sple"', () => {
  const file = validFile()
  // @ts-expect-error -- intentionally invalid for the test
  file.generator.name = 'other-tool'
  const result = checkPlaylistFile(file)
  assert.equal(result.valid, false)
  assert.ok(result.problems.some((p) => p.includes("generator.name must be 'sple'")))
})

test('rejects an unknown source.kind', () => {
  const file = validFile()
  // @ts-expect-error -- intentionally invalid for the test
  file.source.kind = 'album'
  const result = checkPlaylistFile(file)
  assert.equal(result.valid, false)
  assert.ok(result.problems.some((p) => p.includes('source.kind')))
})

test('accumulates multiple problems in a single call', () => {
  const file = validFile()
  // @ts-expect-error -- intentionally invalid for the test
  file.schemaVersion = 2
  at(file.tracks, 0).artists = []
  const result = checkPlaylistFile(file)
  assert.equal(result.valid, false)
  assert.ok(result.problems.length >= 2)
})

test('checkPlaylistFile rejects non-object input without throwing', () => {
  const result = checkPlaylistFile('not a file')
  assert.equal(result.valid, false)
  assert.ok(result.problems.length > 0)
})
