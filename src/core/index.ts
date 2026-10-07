// Provider-agnostic core (canonical model, matching engine, config/token
// store). The config/token store (issue #7) is implemented under
// `./config/`; canonical playlist file types (issue #5) under `./export/`.
// Other real implementations land in issues #3, #4, #6, #8.
export * from './config/index.ts'

// `ProviderId` is intentionally NOT re-exported from `./export/format.ts`
// here: it would collide with the (temporary, closed-union) `ProviderId`
// already re-exported via `./config/index.ts` (see `config/types.ts`).
// Import it directly from `./export/format.ts` until issue #3 lands and the
// two definitions are unified.
export type { CanonicalTrack } from './canonical-track.ts'
export type {
  CanonicalPlaylistFile,
  PlaylistSourceKind,
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
