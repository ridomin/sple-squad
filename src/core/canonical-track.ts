// Canonical track model (ADR-0005). Provider-neutral description of a track,
// used by export (ADR-0008), matching (ADR-0009) and migration (FR-MIG-1/2/4).

/**
 * A provider-neutral track.
 *
 * `isrc` is a three-state field per ADR-0005 §5:
 * - absent (`undefined`): not yet resolved or not applicable
 * - `null`: the provider confirmed it has no ISRC for this track
 * - `string`: a resolved ISRC value
 */
export interface CanonicalTrack {
  /** The track's canonical title. Never empty; a missing title maps to '(untitled)' (ADR-0005 Amendment 1). */
  title: string
  /** Artist display names, in provider order. Never empty; a missing artist maps to ['Unknown Artist'] (ADR-0005 Amendment 1). */
  artists: string[]
  /** Album display name (not an album ID). Absent if the provider has no album context. */
  album?: string
  /** Track duration in milliseconds. Absent if the provider doesn't report duration. */
  durationMs?: number
  /** ISRC code. See the three-state note above. */
  isrc?: string | null
  /** Provider ID -> provider-specific track ref (ADR-0003 §3.1 canonical ref forms). At minimum includes the source provider. */
  refs: Record<string, string>
  /** ISO 8601 UTC timestamp of when the track was added to the source playlist. */
  addedAt?: string
}
