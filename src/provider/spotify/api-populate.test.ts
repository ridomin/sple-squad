// Fake-requester tests for `populatePlaylist` (internal to import/migrate).
// No network; see `api-test-support.ts`.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AuthRequiredError, NotFoundError, ProviderError, QuotaExhaustedError, RateLimitError } from '../../core/provider/errors.ts'
import { FIRST_CALL, HTTP_CREATED, PL_ID, TRACK_ID, TRACK_URI, at, failing, json, setup, track } from './api-test-support.ts'

function bodyUris (body: unknown): unknown {
  assert.ok(typeof body === 'object' && body !== null && 'uris' in body)
  return body.uris
}

describe('populatePlaylist', () => {
  const refs = (n: number): string[] => Array.from({ length: n }, (_, i) => `spotify:track:${String(i).padStart(22, 'x')}`)

  it('adds in order in batches of 100 and fails invalid refs without a request', async () => {
    const { api, calls } = setup(() => json({ snapshot_id: 's' }, HTTP_CREATED))
    const input = [...refs(150), 'spotify:album:foo', TRACK_ID]
    const result = await api.populatePlaylist(PL_ID, input, { skipExisting: false })
    assert.equal(calls.length, 2)
    assert.equal(at(calls, FIRST_CALL).operation, 'populatePlaylist')
    assert.equal(at(calls, FIRST_CALL).url.pathname, `/v1/playlists/${PL_ID}/items`)
    assert.deepEqual(bodyUris(at(calls, FIRST_CALL).body), refs(150).slice(0, 100))
    assert.equal(result.added.length, 150)
    assert.deepEqual(result.failed, [
      { ref: 'spotify:album:foo', error: 'Not a Spotify track URI' },
      { ref: TRACK_ID, error: 'Not a Spotify track URI' }
    ])
  })

  it('records a failed batch and continues; propagates auth/quota/rate-limit', async () => {
    let n = 0
    const { api } = setup(() => {
      n += 1
      return n === 1 ? new ProviderError('bad batch') : json({}, HTTP_CREATED)
    })
    const result = await api.populatePlaylist(PL_ID, refs(101), { skipExisting: false })
    assert.equal(result.failed.length, 100)
    assert.equal(at(result.failed, FIRST_CALL).error, 'bad batch')
    assert.deepEqual(result.added, refs(101).slice(100))
    await Promise.all([new AuthRequiredError('missing-scope', 's'), new QuotaExhaustedError('b'), new RateLimitError(1)].map(async (error) => {
      await assert.rejects(failing(error).api.populatePlaylist(PL_ID, refs(1), { skipExisting: false }), error)
    }))
  })

  it('skipExisting pages through current items and leaves existing refs out', async () => {
    const existing = refs(2)
    const { api, calls } = setup((call) => {
      if (call.method === 'POST') {
        return json({}, HTTP_CREATED)
      }
      return call.url.searchParams.get('offset') === '0'
        ? json({ items: [{ item: track('x'.repeat(22).replace(/^x{22}$/v, `${'x'.repeat(21)  }0`)) }], next: 'n' })
        : json({ items: [{ item: track(`${'x'.repeat(21)  }1`) }] })
    })
    const result = await api.populatePlaylist(PL_ID, [...existing, `spotify:track:${TRACK_ID}`], { skipExisting: true })
    assert.deepEqual(result, { added: [TRACK_URI], failed: [] })
    assert.equal(calls.filter((c) => c.method === 'GET').length, 2)
    assert.deepEqual(bodyUris(at(calls, calls.length - 1).body), [TRACK_URI])
  })

  it('skipExisting drops unavailable items in the scan, compares canonical ids and submits each track once', async () => {
    const present = refs(1)[0] ?? ''
    const { api, calls } = setup((call) => call.method === 'POST'
      ? json({}, HTTP_CREATED)
      : json({ items: [{ item: { name: 'unavailable' } }, null, { item: track(present.slice('spotify:track:'.length), { uri: undefined }) }] }))
    const input = [present, TRACK_URI, TRACK_URI, present]
    const result = await api.populatePlaylist(PL_ID, input, { skipExisting: true })
    assert.deepEqual(result, { added: [TRACK_URI], failed: [] })
    assert.deepEqual(bodyUris(at(calls, calls.length - 1).body), [TRACK_URI])
  })

  it('rejects a bad playlist ref', async () => {
    const { api } = setup(() => json({}))
    await assert.rejects(api.populatePlaylist('bad', refs(1), { skipExisting: false }), NotFoundError)
  })
})
