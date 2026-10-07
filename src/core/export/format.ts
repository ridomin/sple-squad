// Canonical playlist file v1 (ADR-0008 §1). The lossless, versioned export
// format used by `sple export` and read back by `sple import`/`sple migrate`.

import type { CanonicalTrack } from '../canonical-track.js'

/**
 * Provider ID (e.g. `'spotify'`, `'youtube-music'`). Kept as a plain string
 * (not a closed union) because the v1 JSON Schema accepts any lower-case ID
 * so new providers never need a schema change (ADR-0008 §1).
 */
export type ProviderId = string

export type PlaylistSourceKind = 'playlist' | 'liked'

export type UnsupportedItemKind = 'local' | 'episode' | 'unavailable'

/** An item that existed in the source playlist/library but could not be exported as a CanonicalTrack. */
export interface UnsupportedItem {
  /** 1-based position shared with `tracks[].position` (ADR-0008 §1). */
  position: number
  kind: UnsupportedItemKind
  name?: string
  ref?: string
}

/** The name `sple export --liked` always uses for the saved-tracks library (ADR-0008 §1). */
export const LIKED_SONGS_NAME = 'Liked Songs'

/** The only `schemaVersion` this ADR defines. Readers must reject other values unless they implement them. */
export const PLAYLIST_FILE_SCHEMA_VERSION = 1

/** CanonicalPlaylistFile v1 (ADR-0008 §1). */
export interface CanonicalPlaylistFile {
  schemaVersion: typeof PLAYLIST_FILE_SCHEMA_VERSION
  /** ISO 8601 UTC, e.g. `Date#toISOString()`. */
  exportedAt: string
  generator: { name: 'sple', version: string }
  source: { provider: ProviderId, kind: PlaylistSourceKind, userId?: string }
  playlist: {
    ref?: string
    id?: string
    name: string
    description?: string
    owner?: { id: string, displayName?: string }
    public?: boolean
    collaborative?: boolean
    url?: string
    /** `tracks.length + unsupportedItems.length` for *this file* -- not the provider's reported total (ADR-0008 §1). */
    trackCount: number
  }
  tracks: Array<CanonicalTrack & { position: number }>
  unsupportedItems: UnsupportedItem[]
}
