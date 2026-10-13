import type { CanonicalTrack } from '../canonical-track.ts'
import { AuthRequiredError, QuotaExhaustedError, RateLimitError } from '../provider/errors.ts'
import type { MatchCandidate, Provider } from '../provider/provider.ts'
import { createMetadataStrategy, isrcStrategy, knownRefStrategy } from './strategies.ts'
import type { MatchCache, MatchingStrategy, MatchRequest, MatchResult, MatchStatus, MetadataScorer } from './types.ts'

export const DEFAULT_MIN_CONFIDENCE = 0.5

export interface MatchOptions {
  /** Candidates below this are `low-confidence` (default 0.5). */
  minConfidence?: number
  cache?: MatchCache
  /** Overrides the default chain (ref -> ISRC -> metadata). */
  strategies?: MatchingStrategy[]
  /** Used by the default chain's metadata step; ignored if `strategies` is given. */
  metadataScorer?: MetadataScorer
}

export function defaultStrategies (metadataScorer?: MetadataScorer): MatchingStrategy[] {
  return [knownRefStrategy, isrcStrategy, createMetadataStrategy(metadataScorer)]
}

// Auth, quota and rate-limit errors stop the whole run (ADR-0009 Amendment 1 §1.4).
function isFatal (error: unknown): boolean {
  return error instanceof AuthRequiredError || error instanceof QuotaExhaustedError || error instanceof RateLimitError
}

function classify (candidate: MatchCandidate, minConfidence: number): MatchStatus {
  return candidate.confidence < minConfidence ? 'low-confidence' : 'matched'
}

function errorMessage (error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function buildRequest (track: CanonicalTrack, provider: Provider, cache: MatchCache | undefined): MatchRequest {
  return cache === undefined ? { track, provider } : { track, provider, cache }
}

/** Runs applicable strategies in priority order and stops at the first candidate. */
export async function matchTrack (track: CanonicalTrack, provider: Provider, options: MatchOptions = {}): Promise<MatchResult> {
  const { minConfidence = DEFAULT_MIN_CONFIDENCE, strategies = defaultStrategies(options.metadataScorer) } = options
  const chain = [...strategies].sort((a, b) => a.priority - b.priority)
  const request = buildRequest(track, provider, options.cache)
  const tried: Array<MatchCandidate['strategy']> = []
  let lastError: string | undefined = undefined

  for (const strategy of chain) {
    if (!strategy.isApplicable(request)) continue
    tried.push(strategy.name)
    try {
      // Strategies run sequentially by design: each may cost API quota.
      // eslint-disable-next-line no-await-in-loop -- sequential on purpose
      const candidate = await strategy.execute(request)
      if (candidate !== null) {
        return { status: classify(candidate, minConfidence), candidate, tried }
      }
    } catch (error) {
      if (isFatal(error)) throw error
      lastError = errorMessage(error)
    }
  }
  return lastError === undefined ? { status: 'unmatched', tried } : { status: 'unmatched', error: lastError, tried }
}
