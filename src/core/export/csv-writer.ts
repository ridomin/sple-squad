import type { CanonicalPlaylistFile } from './format.ts'
import { assertPlaylistFile } from './invariants.ts'

const CSV_COLUMNS = ['position', 'title', 'artists', 'album', 'duration_ms', 'added_at', 'isrc', 'ref'] as const
const CSV_RECORD_SEPARATOR = '\r\n'
const EMPTY_CELL = ''
const ARTIST_SEPARATOR = '; '

function escapeCell (value: string): string {
  if (/[",\r\n]/v.test(value)) {
    return `"${value.replaceAll('"', '""')}"`
  }
  return value
}

function record (cells: string[]): string {
  return cells.map(escapeCell).join(',')
}

/** Serialize canonical tracks as the RFC 4180 CSV dialect from ADR-0008 §4. */
export function serializePlaylistCSV (file: CanonicalPlaylistFile): string {
  assertPlaylistFile(file)

  const lines = [record([...CSV_COLUMNS])]
  const tracks = [...file.tracks].sort((left, right) => left.position - right.position)

  for (const track of tracks) {
    lines.push(record([
      String(track.position),
      track.title,
      track.artists.join(ARTIST_SEPARATOR),
      track.album ?? EMPTY_CELL,
      track.durationMs === undefined ? EMPTY_CELL : String(track.durationMs),
      track.addedAt ?? EMPTY_CELL,
      track.isrc ?? EMPTY_CELL,
      track.refs[file.source.provider] ?? EMPTY_CELL
    ]))
  }

  return `${lines.join(CSV_RECORD_SEPARATOR)}${CSV_RECORD_SEPARATOR}`
}
