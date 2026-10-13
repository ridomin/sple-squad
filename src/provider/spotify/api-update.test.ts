// Fake-requester tests for Spotify updatePlaylist (PUT /v1/playlists/{id}). No network.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { AccessRestrictedError, AuthRequiredError, ProviderError, UsageError } from '../../core/provider/errors.ts'
import { HTTP_OK, HTTP_SERVER_ERROR, PL_ID, json, me, playlist, setup, type Call } from './api-test-support.ts'

type Api = ReturnType<typeof setup>['api']
interface Patch { name?: string, description?: string, public?: boolean }

const ok = (call: Call): Response | undefined => call.method === 'PUT' ? new Response(null, { status: HTTP_OK }) : undefined

async function update (api: Api, patch: Patch): Promise<{ name: string, owned: boolean }> {
  assert.ok(api.updatePlaylist !== undefined)
  const { name, owned } = await api.updatePlaylist(PL_ID, patch)
  return { name, owned }
}

describe('updatePlaylist', () => {
  it('PUTs only the supplied fields, then returns the re-read playlist', async () => {
    const { api, calls } = setup((call) => me(call) ?? ok(call) ?? json(playlist(PL_ID, 'me', { name: 'New' })))
    const updated = await update(api, { name: 'New', public: false })
    const put = calls.find((call) => call.method === 'PUT')
    assert.ok(put !== undefined)
    assert.equal(put.operation, 'updatePlaylist')
    assert.equal(put.url.pathname, `/v1/playlists/${PL_ID}`)
    assert.deepEqual(put.body, { name: 'New', public: false })
    assert.deepEqual(updated, { name: 'New', owned: true })
  })

  it('sends an explicit empty description', async () => {
    const { api, calls } = setup((call) => me(call) ?? ok(call) ?? json(playlist(PL_ID, 'me')))
    await update(api, { description: '' })
    assert.deepEqual(calls.find((call) => call.method === 'PUT')?.body, { description: '' })
  })

  it('rejects an empty patch without a request', async () => {
    const { api, calls } = setup(() => json({}))
    await assert.rejects(update(api, {}), UsageError)
    assert.equal(calls.length, 0)
  })

  it('surfaces scope, API and HTTP failures', async () => {
    await assert.rejects(update(setup(() => new AuthRequiredError('missing-scope', 'playlist-modify-public')).api, { name: 'x' }), AuthRequiredError)
    await assert.rejects(update(setup(() => new AccessRestrictedError('other')).api, { name: 'x' }), AccessRestrictedError)
    await assert.rejects(update(setup(() => json({}, HTTP_SERVER_ERROR)).api, { name: 'x' }), ProviderError)
  })
})
