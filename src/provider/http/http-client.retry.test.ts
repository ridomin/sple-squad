import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpClient } from './http-client.ts'

test('honors Retry-After on a 5xx response before retrying', async () => {
  let calls = 0
  const waits: number[] = []
  const client = new HttpClient({
    loadToken: async () => await Promise.resolve(null),
    fetchImpl: async () => {
      calls += 1
      return await Promise.resolve(calls === 1
        ? new Response('', { status: 503, headers: { 'retry-after': '2' } })
        : new Response('recovered', { status: 200 }))
    },
    sleep: async (ms) => {
      waits.push(ms)
      await Promise.resolve()
    },
    random: () => 0.5
  })

  const response = await client.request('GET', 'https://provider.invalid/resource')

  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'recovered')
  assert.equal(calls, 2)
  assert.deepEqual(waits, [2000])
})
