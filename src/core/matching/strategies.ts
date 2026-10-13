import type { MatchCandidate, TrackQuery } from '../provider/provider.ts'
import type { MatchingStrategy, MetadataScorer } from './types.ts'

const PRIORITY_KNOWN_REF = 1
const PRIORITY_ISRC = 2
const PRIORITY_METADATA = 3
const CONFIDENCE_KNOWN_REF = 1.0
const CONFIDENCE_ISRC = 0.95
const ISRC_SEARCH_LIMIT = 5
const METADATA_SEARCH_LIMIT = 10

/** Placeholder until #27 lands: accepts nothing, so the metadata step never matches. */
export const unimplementedMetadataScorer: MetadataScorer = {
  pickBest: () => null
}

export const knownRefStrategy: MatchingStrategy = {
  name: 'known-ref',
  priority: PRIORITY_KNOWN_REF,
  isApplicable: () => true,
  async execute ({ track, provider, cache }) {
    // The ref is trusted without a lookup (ADR-0009 Amendment 1 §2).
    const ref = track.refs[provider.id] ?? await cache?.get(track, provider.id)
    if (ref === undefined || ref === '') return null
    return { ref, track, confidence: CONFIDENCE_KNOWN_REF, strategy: 'known-ref' }
  }
}

export const isrcStrategy: MatchingStrategy = {
  name: 'isrc',
  priority: PRIORITY_ISRC,
  isApplicable: ({ track, provider }) =>
    typeof track.isrc === 'string' && track.isrc !== '' && provider.capabilities.isrcSearchMode !== 'none',
  async execute ({ track, provider }) {
    if (typeof track.isrc !== 'string' || track.isrc === '') return null
    const hits = await provider.searchTracks({ kind: 'isrc', isrc: track.isrc }, { limit: ISRC_SEARCH_LIMIT })
    const [first] = hits
    if (first === undefined) return null
    return { ref: first.ref, track: first.track, confidence: CONFIDENCE_ISRC, strategy: 'isrc' }
  }
}

export function createMetadataStrategy (scorer: MetadataScorer = unimplementedMetadataScorer): MatchingStrategy {
  return {
    name: 'metadata',
    priority: PRIORITY_METADATA,
    isApplicable: ({ track }) => track.title.trim() !== '',
    async execute ({ track, provider }): Promise<MatchCandidate | null> {
      const query: Extract<TrackQuery, { kind: 'metadata' }> = { kind: 'metadata', title: track.title, artists: track.artists }
      const { album, durationMs } = track
      if (album !== undefined) query.album = album
      if (durationMs !== undefined) query.durationMs = durationMs
      const hits = await provider.searchTracks(query, { limit: METADATA_SEARCH_LIMIT })
      const best = scorer.pickBest(track, hits)
      if (best === null) return null
      return { ref: best.hit.ref, track: best.hit.track, confidence: best.confidence, strategy: 'metadata' }
    }
  }
}
