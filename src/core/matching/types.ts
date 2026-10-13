// Matching strategy chain types (ADR-0009 + Amendment 1). `MatchCandidate`
// is the single shared type from `../provider/provider.ts`, not redeclared.

import type { CanonicalTrack } from '../canonical-track.ts'
import type { MatchCandidate, Provider, TrackHit } from '../provider/provider.ts'

export interface MatchRequest {
  track: CanonicalTrack
  provider: Provider
  /** Optional match cache consulted by the known-ref strategy after the file's own refs. */
  cache?: MatchCache
}

/** Previously confirmed source-track -> target-ref mappings. The cache itself is out of scope for #28. */
export interface MatchCache {
  get: (track: CanonicalTrack, providerId: string) => string | undefined | Promise<string | undefined>
}

export interface MatchingStrategy {
  readonly name: MatchCandidate['strategy']
  /** 1 (highest) to 3 (lowest). */
  readonly priority: number
  isApplicable: (request: MatchRequest) => boolean
  execute: (request: MatchRequest) => Promise<MatchCandidate | null>
}

/**
 * Plug-in point for metadata scoring (#27, ADR-0009 Amendment 1 §3-4).
 * Returns the best accepted hit with its confidence, or `null` if none is accepted.
 */
export interface MetadataScorer {
  pickBest: (source: CanonicalTrack, hits: TrackHit[]) => { hit: TrackHit, confidence: number } | null
}

export type MatchStatus = 'matched' | 'low-confidence' | 'unmatched'

export interface MatchResult {
  status: MatchStatus
  candidate?: MatchCandidate
  /** Last non-fatal strategy error message, set only when unmatched. */
  error?: string
  /** Names of the strategies that actually ran, in order. */
  tried: Array<MatchCandidate['strategy']>
}
