// Invariant checks for CanonicalPlaylistFile v1 (ADR-0008 §2 and Amendment 1
// "Reading (import)"). These cover rules the JSON Schema (issue #6) can't
// express on its own: unique/complete positions, trackCount consistency, the
// Liked Songs name rule, and per-track shape (non-empty artists, at least one
// ref).

import type { CanonicalPlaylistFile } from './format.ts'
import { LIKED_SONGS_NAME, PLAYLIST_FILE_SCHEMA_VERSION } from './format.ts'

// prefer-regex-literals wants a /.../v literal, but the v flag needs
// tsconfig target es2024+; the project targets es2022, so build with the
// constructor instead (require-unicode-regexp still enforces the v flag).
// eslint-disable-next-line prefer-regex-literals -- the v flag literal needs tsconfig target es2024+; project targets es2022
const ISO_8601_UTC = new RegExp('^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?<fraction>\\.\\d+)?Z$', 'v')

const EMPTY = 0
const MIN_POSITION = 1
const POSITION_STEP = 1

export interface PlaylistFileCheckResult {
  valid: boolean
  problems: string[]
}

/** Thrown by `assertPlaylistFile` when one or more v1 invariants are violated. */
export class ExportFormatError extends Error {
  readonly problems: string[]

  constructor (problems: string[]) {
    super(`Invalid canonical playlist file: ${problems.join('; ')}`)
    this.name = 'ExportFormatError'
    this.problems = problems
  }
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString (value: unknown): value is string {
  return typeof value === 'string' && value.length > EMPTY
}

function isPositiveInteger (value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_POSITION
}

function checkSchemaVersion (version: unknown, problems: string[]): void {
  if (version !== PLAYLIST_FILE_SCHEMA_VERSION) {
    problems.push(`Unsupported schema version: ${String(version)}. This version of sple supports v1 only.`)
  }
}

function checkExportedAt (exportedAt: unknown, problems: string[]): void {
  if (!isNonEmptyString(exportedAt) || !ISO_8601_UTC.test(exportedAt)) {
    problems.push('exportedAt must be an ISO 8601 UTC timestamp (e.g. 2026-09-01T12:34:56Z)')
  }
}

function checkGenerator (generator: unknown, problems: string[]): void {
  if (!isRecord(generator)) {
    problems.push('generator must be an object')
    return
  }
  if (generator.name !== 'sple') {
    problems.push("generator.name must be 'sple'")
  }
  if (!isNonEmptyString(generator.version)) {
    problems.push('generator.version must be a non-empty string')
  }
}

interface SourceCheck {
  kind?: unknown
}

function checkSource (source: unknown, problems: string[]): SourceCheck {
  if (!isRecord(source)) {
    problems.push('source must be an object')
    return {}
  }
  if (!isNonEmptyString(source.provider)) {
    problems.push('source.provider must be a non-empty string')
  }
  if (source.kind !== 'playlist' && source.kind !== 'liked') {
    problems.push("source.kind must be 'playlist' or 'liked'")
  }
  return { kind: source.kind }
}

interface PlaylistCheck {
  trackCount?: number
}

function checkPlaylistName (playlist: Record<string, unknown>, sourceKind: unknown, problems: string[]): void {
  if (!isNonEmptyString(playlist.name)) {
    problems.push('playlist.name must be a non-empty string')
    return
  }
  // ADR-0008 §1: Liked Songs exports must use the fixed name "Liked Songs".
  if (sourceKind === 'liked' && playlist.name !== LIKED_SONGS_NAME) {
    problems.push(`playlist.name must be '${LIKED_SONGS_NAME}' when source.kind is 'liked'`)
  }
}

function checkPlaylist (playlist: unknown, sourceKind: unknown, problems: string[]): PlaylistCheck {
  if (!isRecord(playlist)) {
    problems.push('playlist must be an object')
    return {}
  }
  checkPlaylistName(playlist, sourceKind, problems)
  if (typeof playlist.trackCount !== 'number' || !Number.isInteger(playlist.trackCount) || playlist.trackCount < EMPTY) {
    problems.push('playlist.trackCount must be a non-negative integer')
    return {}
  }
  return { trackCount: playlist.trackCount }
}

function hasValidArtists (track: Record<string, unknown>): boolean {
  return Array.isArray(track.artists) && track.artists.length > EMPTY && track.artists.every(isNonEmptyString)
}

function hasValidRefs (track: Record<string, unknown>): boolean {
  return isRecord(track.refs) && Object.keys(track.refs).length > EMPTY
}

function checkTrack (track: unknown, index: number, problems: string[]): number | undefined {
  if (!isRecord(track)) {
    problems.push(`tracks[${index}] must be an object`)
    return undefined
  }
  if (!isNonEmptyString(track.title)) {
    problems.push(`tracks[${index}].title must be a non-empty string`)
  }
  if (!hasValidArtists(track)) {
    problems.push(`tracks[${index}].artists must be a non-empty array of non-empty strings`)
  }
  if (!hasValidRefs(track)) {
    problems.push(`tracks[${index}].refs must have at least one entry`)
  }
  if (!isPositiveInteger(track.position)) {
    problems.push(`tracks[${index}].position must be a positive integer`)
    return undefined
  }
  return track.position
}

function isUnsupportedKind (kind: unknown): boolean {
  return kind === 'local' || kind === 'episode' || kind === 'unavailable'
}

function checkUnsupportedItem (item: unknown, index: number, problems: string[]): number | undefined {
  if (!isRecord(item)) {
    problems.push(`unsupportedItems[${index}] must be an object`)
    return undefined
  }
  if (!isUnsupportedKind(item.kind)) {
    problems.push(`unsupportedItems[${index}].kind must be 'local', 'episode' or 'unavailable'`)
  }
  if (!isPositiveInteger(item.position)) {
    problems.push(`unsupportedItems[${index}].position must be a positive integer`)
    return undefined
  }
  return item.position
}

function resolveArray (value: unknown, name: string, problems: string[]): unknown[] {
  if (!Array.isArray(value)) {
    problems.push(`${name} must be an array`)
    return []
  }
  return value
}

function collectPositions (tracks: unknown[], unsupportedItems: unknown[], problems: string[]): number[] {
  const positions: number[] = []
  tracks.forEach((track, index) => {
    const position = checkTrack(track, index, problems)
    if (position !== undefined) {
      positions.push(position)
    }
  })
  unsupportedItems.forEach((item, index) => {
    const position = checkUnsupportedItem(item, index, problems)
    if (position !== undefined) {
      positions.push(position)
    }
  })
  return positions
}

function checkTrackCount (expected: number | undefined, tracksLength: number, itemsLength: number, problems: string[]): void {
  if (expected === undefined) {
    return
  }
  const actual = tracksLength + itemsLength
  if (expected !== actual) {
    problems.push(`playlist.trackCount (${expected}) must equal tracks.length + unsupportedItems.length (${actual})`)
  }
}

function findDuplicates (positions: number[]): number[] {
  const seen = new Set<number>()
  const duplicates = new Set<number>()
  for (const position of positions) {
    if (seen.has(position)) {
      duplicates.add(position)
    }
    seen.add(position)
  }
  return [...duplicates].sort((a, b) => a - b)
}

function findMissing (seen: Set<number>, trackCount: number): number[] {
  const missing: number[] = []
  for (let position = MIN_POSITION; position <= trackCount; position += POSITION_STEP) {
    if (!seen.has(position)) {
      missing.push(position)
    }
  }
  return missing
}

function findOutOfRange (seen: Set<number>, trackCount: number): number[] {
  return [...seen].filter((position) => position < MIN_POSITION || position > trackCount).sort((a, b) => a - b)
}

// ADR-0008 §1: tracks and unsupportedItems share one position space and
// together cover 1..trackCount without duplicates.
function checkPositions (positions: number[], trackCount: number | undefined, problems: string[]): void {
  const duplicates = findDuplicates(positions)
  if (duplicates.length > EMPTY) {
    problems.push(`positions must be unique, duplicated: ${duplicates.join(', ')}`)
  }
  if (trackCount === undefined) {
    return
  }
  const seen = new Set(positions)
  const missing = findMissing(seen, trackCount)
  if (missing.length > EMPTY) {
    problems.push(`positions must cover 1..${trackCount} without gaps, missing: ${missing.join(', ')}`)
  }
  const outOfRange = findOutOfRange(seen, trackCount)
  if (outOfRange.length > EMPTY) {
    problems.push(`positions must be within 1..${trackCount}, out of range: ${outOfRange.join(', ')}`)
  }
}

/**
 * Checks every v1 invariant from ADR-0008 §2 and Amendment 1 that a JSON
 * Schema can't express on its own (e.g. unique/complete positions,
 * `trackCount` consistency) alongside the basic shape checks a reader needs
 * (`schemaVersion`, `exportedAt`, `generator`, `source`, the Liked Songs name
 * rule, non-empty `artists`, at least one ref per track).
 *
 * Never throws; returns every problem found so callers can report them all
 * at once (ADR-0008 Amendment 1: "Any violation -> exit 2 listing the
 * problems").
 */
export function checkPlaylistFile (file: unknown): PlaylistFileCheckResult {
  if (!isRecord(file)) {
    return { valid: false, problems: ['playlist file must be an object'] }
  }

  const problems: string[] = []
  checkSchemaVersion(file.schemaVersion, problems)
  checkExportedAt(file.exportedAt, problems)
  checkGenerator(file.generator, problems)
  const sourceCheck = checkSource(file.source, problems)
  const playlistCheck = checkPlaylist(file.playlist, sourceCheck.kind, problems)

  const tracks = resolveArray(file.tracks, 'tracks', problems)
  const unsupportedItems = resolveArray(file.unsupportedItems, 'unsupportedItems', problems)
  const positions = collectPositions(tracks, unsupportedItems, problems)

  checkTrackCount(playlistCheck.trackCount, tracks.length, unsupportedItems.length, problems)
  checkPositions(positions, playlistCheck.trackCount, problems)

  return problems.length === EMPTY ? { valid: true, problems: [] } : { valid: false, problems }
}

/**
 * Asserts that `file` satisfies every v1 invariant, narrowing its type to
 * `CanonicalPlaylistFile` on success. Throws `ExportFormatError` listing
 * every violation otherwise.
 */
export function assertPlaylistFile (file: unknown): asserts file is CanonicalPlaylistFile {
  const result = checkPlaylistFile(file)
  if (!result.valid) {
    throw new ExportFormatError(result.problems)
  }
}
