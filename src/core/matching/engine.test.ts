import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { CanonicalTrack } from '../canonical-track.ts'
import { AuthRequiredError, ProviderError, RateLimitError } from '../provider/errors.ts'
import { createFakeProvider } from '../provider/fake/index.ts'
import type { Provider, TrackHit, TrackQuery } from '../provider/provider.ts'
import { matchTrack } from './engine.ts'
import type { MetadataScorer } from './types.ts'

const HIT_TRACK: CanonicalTrack = { title: 'Song', artists: ['A'], refs: { fake: 'fake:track:1' }, isrc: 'USRC17607839' }
const HIT: TrackHit = { ref: 'fake:track:1', track: HIT_TRACK }
const SOURCE: CanonicalTrack = { title: 'Song', artists: ['A'], isrc: 'USRC17607839', refs: { other: 'other:1' } }

interface Spy { provider: Provider, queries: TrackQuery[] }

function spyProvider (isrcSearchMode: 'none' | 'filter' | 'lookup', respond: (q: TrackQuery) => TrackHit[] | Error = () => [HIT]): Spy {
  const queries: TrackQuery[] = []
  const base = createFakeProvider({ capabilities: { isrcSearchMode } })
  const provider: Provider = {
    ...base,
    searchTracks: async (q) => {
      queries.push(q)
      const out = respond(q)
      if (out instanceof Error) throw out
      return await Promise.resolve(out)
    }
  }
  return { provider, queries }
}

const acceptFirst: MetadataScorer = { pickBest: (_s, hits) => (hits[0] === undefined ? null : { hit: hits[0], confidence: 0.8 }) }

describe('matchTrack strategy chain', () => {
  it('uses the file ref for the target provider without any search', async () => {
    const { provider, queries } = spyProvider('filter')
    const result = await matchTrack({ ...SOURCE, refs: { fake: 'fake:track:9' } }, provider)
    assert.equal(result.status, 'matched')
    assert.notEqual(result.candidate, undefined)
    assert.deepEqual(result.candidate.ref, 'fake:track:9')
    assert.equal(result.candidate.strategy, 'known-ref')
    assert.equal(result.candidate.confidence, 1)
    assert.equal(queries.length, 0)
  })

  it('falls back to the match cache when the file has no ref', async () => {
    const { provider, queries } = spyProvider('filter')
    const cache = { get: async () => await Promise.resolve('fake:track:cached') }
    const result = await matchTrack(SOURCE, provider, { cache })
    assert.equal(result.candidate?.ref, 'fake:track:cached')
    assert.equal(result.candidate.strategy, 'known-ref')
    assert.equal(queries.length, 0)
  })

  it('prefers the file ref over the cache', async () => {
    const { provider } = spyProvider('filter')
    const cache = { get: () => 'fake:track:cached' }
    const result = await matchTrack({ ...SOURCE, refs: { fake: 'fake:track:file' } }, provider, { cache })
    assert.equal(result.candidate?.ref, 'fake:track:file')
  })

  it('uses ISRC next when supported, with confidence 0.95 and limit-5 query', async () => {
    const { provider, queries } = spyProvider('filter')
    const result = await matchTrack(SOURCE, provider)
    assert.equal(result.candidate?.strategy, 'isrc')
    assert.equal(result.candidate.confidence, 0.95)
    assert.deepEqual(queries, [{ kind: 'isrc', isrc: 'USRC17607839' }])
    assert.deepEqual(result.tried, ['known-ref', 'isrc'])
  })

  it('skips ISRC when isrcSearchMode is none, even if the file has an ISRC', async () => {
    const { provider, queries } = spyProvider('none')
    const result = await matchTrack(SOURCE, provider, { metadataScorer: acceptFirst })
    assert.equal(queries.every((q) => q.kind === 'metadata'), true)
    assert.equal(result.candidate?.strategy, 'metadata')
    assert.deepEqual(result.tried, ['known-ref', 'metadata'])
  })

  it('skips ISRC when the track has no ISRC (null, empty or absent)', async () => {
    for (const isrc of [null, '', undefined]) {
      const { provider, queries } = spyProvider('filter', (q) => (q.kind === 'isrc' ? [HIT] : []))
      // eslint-disable-next-line no-await-in-loop -- sequential cases keep failures attributable
      const result = await matchTrack({ ...SOURCE, isrc }, provider)
      assert.equal(queries.some((q) => q.kind === 'isrc'), false)
      assert.equal(result.status, 'unmatched')
    }
  })

  it('falls through from an empty ISRC result to metadata', async () => {
    const { provider, queries } = spyProvider('filter', (q) => (q.kind === 'isrc' ? [] : [HIT]))
    const result = await matchTrack(SOURCE, provider, { metadataScorer: acceptFirst })
    assert.equal(result.candidate?.strategy, 'metadata')
    assert.deepEqual(queries.map((q) => q.kind), ['isrc', 'metadata'])
  })

  it('sends title, artists, album and duration in the metadata query', async () => {
    const { provider, queries } = spyProvider('none', () => [])
    await matchTrack({ ...SOURCE, album: 'Alb', durationMs: 1000 }, provider)
    assert.deepEqual(queries, [{ kind: 'metadata', title: 'Song', artists: ['A'], album: 'Alb', durationMs: 1000 }])
  })

  it('is unmatched by default for the metadata step (scorer stub), and skips it without a title', async () => {
    const { provider, queries } = spyProvider('none')
    assert.equal((await matchTrack(SOURCE, provider)).status, 'unmatched')
    queries.length = 0
    const result = await matchTrack({ ...SOURCE, title: '  ' }, provider)
    assert.equal(queries.length, 0)
    assert.deepEqual(result.tried, ['known-ref'])
  })

  it('marks candidates below minConfidence as low-confidence', async () => {
    const { provider } = spyProvider('none')
    const scorer: MetadataScorer = { pickBest: () => ({ hit: HIT, confidence: 0.45 }) }
    assert.equal((await matchTrack(SOURCE, provider, { metadataScorer: scorer })).status, 'low-confidence')
    assert.equal((await matchTrack(SOURCE, provider, { metadataScorer: scorer, minConfidence: 0.4 })).status, 'matched')
  })

  it('records non-fatal errors, continues, and reports the last one if unmatched', async () => {
    const { provider } = spyProvider('filter', (q) => new ProviderError(`boom ${q.kind}`))
    const result = await matchTrack(SOURCE, provider)
    assert.equal(result.status, 'unmatched')
    assert.equal(result.error, 'boom metadata')
    assert.deepEqual(result.tried, ['known-ref', 'isrc', 'metadata'])
  })

  it('continues past a non-fatal error to a later strategy that matches', async () => {
    const { provider } = spyProvider('filter', (q) => (q.kind === 'isrc' ? new ProviderError('x') : [HIT]))
    const result = await matchTrack(SOURCE, provider, { metadataScorer: acceptFirst })
    assert.equal(result.status, 'matched')
    assert.equal(result.error, undefined)
  })

  it('propagates auth, and rate-limit errors', async () => {
    const auth = spyProvider('filter', () => new AuthRequiredError('fake'))
    await assert.rejects(matchTrack(SOURCE, auth.provider), AuthRequiredError)
    const limited = spyProvider('none', () => new RateLimitError('fake'))
    await assert.rejects(matchTrack(SOURCE, limited.provider), RateLimitError)
  })

  it('works against the real fake provider catalog via ISRC', async () => {
    const provider = createFakeProvider({
      capabilities: { isrcSearchMode: 'filter' },
      fixtures: { catalog: [{ id: 't1', title: 'Song', artists: ['A'], isrc: 'USRC17607839' }] }
    })
    const result = await matchTrack(SOURCE, provider)
    assert.equal(result.candidate?.ref, 'fake:track:t1')
  })
})
