import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CanonicalPlaylistFile } from './format.ts'
import { createExportSummary, createUnsupportedItemsWarning } from './summary.ts'

const file: CanonicalPlaylistFile = {
  schemaVersion: 1,
  exportedAt: '2026-09-01T12:34:56Z',
  generator: { name: 'sple', version: '0.1.0' },
  source: { provider: 'spotify', kind: 'playlist' },
  playlist: { id: 'playlist-id', name: 'Playlist', trackCount: 2 },
  tracks: [
    { title: 'Track', artists: ['Artist'], refs: { spotify: 'spotify:track:one' }, position: 1 }
  ],
  unsupportedItems: [{ position: 2, kind: 'episode', name: 'Podcast' }]
}

test('returns file metadata and unsupported-item counts for CLI integration', () => {
  assert.deepEqual(createExportSummary(file, 'json', '/exports/playlist.json', 2), {
    path: '/exports/playlist.json',
    format: 'json',
    source: { kind: 'playlist', id: 'playlist-id', name: 'Playlist' },
    trackCount: 1,
    unsupportedCount: 2
  })
})

test('builds warning data for dropped unsupported items', () => {
  assert.deepEqual(createUnsupportedItemsWarning(file.unsupportedItems), {
    count: 1,
    message: 'sple: warning: skipped 1 unsupported item and were not exported'
  })
  assert.equal(createUnsupportedItemsWarning(0), undefined)
  assert.throws(() => createUnsupportedItemsWarning(-1), RangeError)
})
