// Provider-agnostic core (canonical model, matching engine, config/token
// store). Remaining pieces land in issues #3-#8.

export type { CanonicalTrack } from './canonical-track.ts'
export type {
  CanonicalPlaylistFile,
  PlaylistSourceKind,
  ProviderId,
  UnsupportedItem,
  UnsupportedItemKind
} from './export/format.ts'
export { LIKED_SONGS_NAME } from './export/format.ts'
export {
  assertPlaylistFile,
  checkPlaylistFile,
  ExportFormatError
} from './export/invariants.ts'
export type { PlaylistFileCheckResult } from './export/invariants.ts'
