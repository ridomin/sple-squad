import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CanonicalPlaylistFile } from './format.ts'
import { serializePlaylistCSV } from './csv-writer.ts'

function fixture (): CanonicalPlaylistFile {
  return {
    schemaVersion: 1,
    exportedAt: '2026-09-01T12:34:56Z',
    generator: { name: 'sple', version: '0.1.0' },
    source: { provider: 'spotify', kind: 'playlist' },
    playlist: { name: 'CSV Test', trackCount: 1 },
    tracks: [
      {
        title: 'A "quoted", title\r\nnext line',
        artists: ['Artist, One', 'Artist "Two"\ncontinued'],
        album: 'Album, "quoted"',
        durationMs: 210000,
        isrc: null,
        refs: { spotify: 'spotify:track:abc' },
        addedAt: '2026-08-01T00:00:00Z',
        position: 1
      }
    ],
    unsupportedItems: []
  }
}

test('writes RFC 4180 headers, quote escaping and CRLF records', () => {
  const csv = serializePlaylistCSV(fixture())
  assert.equal(
    csv,
    'position,title,artists,album,duration_ms,added_at,isrc,ref\r\n' +
      '1,"A ""quoted"", title\r\nnext line","Artist, One; Artist ""Two""\ncontinued","Album, ""quoted""",210000,2026-08-01T00:00:00Z,,spotify:track:abc\r\n'
  )
  assert.equal(csv.includes('\uFEFF'), false)
})

test('uses empty cells for absent metadata and leaves formula-like values unchanged', () => {
  const file = fixture()
  const { tracks: [firstTrack] } = file
  assert.ok(firstTrack !== undefined)
  firstTrack.title = '=SUM(A1:A2)'
  firstTrack.artists = ['Artist']
  firstTrack.album = undefined
  firstTrack.durationMs = undefined
  firstTrack.isrc = undefined
  firstTrack.addedAt = undefined

  const [, row] = serializePlaylistCSV(file).split('\r\n')
  assert.equal(row, '1,=SUM(A1:A2),Artist,,,,,spotify:track:abc')
})

test('omits unsupported items without renumbering the remaining tracks', () => {
  const file = fixture()
  const { tracks: [track] } = file
  assert.ok(track !== undefined)
  track.position = 2
  file.playlist.trackCount = 2
  file.unsupportedItems = [{ position: 1, kind: 'episode', name: 'Podcast' }]

  const [header, row] = serializePlaylistCSV(file).split('\r\n')
  assert.equal(header, 'position,title,artists,album,duration_ms,added_at,isrc,ref')
  assert.equal(row?.startsWith('2,'), true)
})
