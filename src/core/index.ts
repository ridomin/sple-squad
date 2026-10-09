// Provider-agnostic core (canonical model, matching engine, config/token
// store). The config/token store (issue #7) is implemented under
// `./config/`; canonical playlist file types (issue #5) under `./export/`;
// the `Provider` interface and capabilities (issue #3) under `./provider/`.
// Real adapters and the fake provider land in issues #4, #6, #8.
export * from './config/index.ts'

// `ProviderId` is intentionally NOT re-exported from `./export/format.ts`
// here: it would collide with the closed-union `ProviderId` already
// re-exported via `./config/index.ts` (see `config/types.ts`, which now
// re-exports the one true definition from `./provider/capabilities.ts`).
// Import the wide string version directly from `./export/format.ts` when you
// need it (ADR-0008 §1 deliberately keeps that one a plain `string`).
export type { CanonicalTrack } from './canonical-track.ts'

export type {
  ProviderOperation,
  QuotaBucket,
  QuotaCost,
  QuotaModel,
  ReadPageSize,
  LikedSongsCapability,
  ProviderCapabilities
} from './provider/capabilities.ts'
export type {
  PageRequest,
  Page,
  PlaylistSummary,
  SearchType,
  SearchItem,
  TrackQuery,
  TrackHit,
  MatchCandidate,
  AuthStatus,
  AuthLoginInteraction,
  ProviderAuth,
  Provider
} from './provider/provider.ts'
// `UsageError` is intentionally NOT re-exported from `./provider/errors.ts`
// here: it would collide with the general CLI `UsageError` already
// re-exported via `./config/index.ts` (see `config/config.ts`). The two are
// different errors at different layers (a bad flag vs. an ambiguous playlist
// name or an unsupported `--offset`) that happen to share exit code 2.
// Import the provider-layer one directly from `./provider/errors.ts`.
export {
  ProviderError,
  AuthRequiredError,
  NotFoundError,
  QuotaExhaustedError,
  RateLimitError,
  AccessRestrictedError,
  exitCodeForError
} from './provider/errors.ts'
export type {
  AuthRequiredReason,
  NotFoundResourceType,
  AccessRestrictedReason
} from './provider/errors.ts'
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
