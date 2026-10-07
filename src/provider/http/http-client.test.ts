// Mock-server tests for the HTTP client's retry/backoff/401-refresh
// behavior (ADR-0010 §1, §3; issue #8). Uses `node:http` directly, no live
// Spotify/YouTube calls.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { HttpClient, type HttpClientToken } from './http-client.ts'
import { AccessRestrictedError, AuthRequiredError, NotFoundError, ProviderError, RateLimitError } from '../../core/provider/errors.ts'

interface RouteResult {
  status: number
  body?: string
  headers?: Record<string, string>
}

type Handler = (req: IncomingMessage) => RouteResult | Promise<RouteResult>

function addressPort (server: Server): number {
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('expected server to be listening on a TCP port')
  }
  return address.port
}

async function startServer (handler: Handler): Promise<{ url: string, close: () => Promise<void>, requests: string[] }> {
  const requests: string[] = []
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    requests.push(`${req.method ?? ''} ${req.url ?? ''} auth=${req.headers.authorization ?? ''}`)
    void (async () => {
      const result = await handler(req)
      res.writeHead(result.status, result.headers ?? {})
      res.end(result.body ?? '')
    })()
  })
  // eslint-disable-next-line promise/avoid-new -- wraps the callback-style net.Server#listen API
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    url: `http://127.0.0.1:${String(addressPort(server))}`,
    requests,
    close: async () => {
      // eslint-disable-next-line promise/avoid-new -- wraps the callback-style net.Server#close API
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err !== undefined) { reject(err); return }
          resolve()
        })
      })
    }
  }
}

function sampleToken (overrides: Partial<HttpClientToken> = {}): HttpClientToken {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: '2099-01-01T00:00:00Z',
    ...overrides
  }
}

// Tests drive a fake clock/sleep so the suite runs instantly: `sleep` just
// records the requested delay instead of waiting, and `now()` advances by
// that amount so duration math and proactive-refresh checks stay coherent.
function fakeClock (): { now: () => number, sleep: (ms: number) => Promise<void>, sleptMs: number[] } {
  let current = 0
  const sleptMs: number[] = []
  return {
    now: () => current,
    sleep: async (ms: number) => {
      sleptMs.push(ms)
      current += ms
      await Promise.resolve()
    },
    sleptMs
  }
}

describe('HttpClient: successful request passthrough', () => {
  it('returns the response on a 2xx with no retries', async () => {
    const server = await startServer(() => ({ status: 200, body: 'ok' }))
    const clock = fakeClock()
    const client = new HttpClient({
      loadToken: async () => await Promise.resolve(sampleToken()),
      now: clock.now,
      sleep: clock.sleep
    })

    const response = await client.request('GET', `${server.url}/playlists`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'ok')
    assert.deepEqual(server.requests, ['GET /playlists auth=Bearer access-1'])

    await server.close()
  })
})

describe('HttpClient: 429 rate limiting', () => {
  it('waits for a delta-seconds Retry-After then retries', async () => {
    let calls = 0
    const server = await startServer(() => {
      calls += 1
      if (calls === 1) {
        return { status: 429, headers: { 'retry-after': '2' } }
      }
      return { status: 200, body: 'ok' }
    })
    const clock = fakeClock()
    const client = new HttpClient({
      loadToken: async () => await Promise.resolve(sampleToken()),
      now: clock.now,
      sleep: clock.sleep
    })

    const response = await client.request('GET', `${server.url}/x`)
    assert.equal(response.status, 200)
    assert.deepEqual(clock.sleptMs, [2000])

    await server.close()
  })

  it('waits for an HTTP-date Retry-After then retries', async () => {
    let calls = 0
    const retryAtMs = 5000
    const server = await startServer(() => {
      calls += 1
      if (calls === 1) {
        return { status: 429, headers: { 'retry-after': new Date(retryAtMs).toUTCString() } }
      }
      return { status: 200, body: 'ok' }
    })
    const clock = fakeClock()
    const client = new HttpClient({
      loadToken: async () => await Promise.resolve(sampleToken()),
      now: clock.now,
      sleep: clock.sleep
    })

    const response = await client.request('GET', `${server.url}/x`)
    assert.equal(response.status, 200)
    assert.deepEqual(clock.sleptMs, [retryAtMs])

    await server.close()
  })

  it('fails immediately with RateLimitError when Retry-After exceeds maxWait', async () => {
    const server = await startServer(() => ({ status: 429, headers: { 'retry-after': '200' } }))
    const clock = fakeClock()
    const client = new HttpClient({
      loadToken: async () => await Promise.resolve(sampleToken()),
      now: clock.now,
      sleep: clock.sleep,
      maxWaitMs: 120_000
    })

    await assert.rejects(
      async () => await client.request('GET', `${server.url}/x`),
      (err: unknown) => {
        assert.ok(err instanceof RateLimitError)
        assert.equal(err.retryAfterMs, 200_000)
        return true
      }
    )
    assert.deepEqual(clock.sleptMs, [])

    await server.close()
  })

  it('fails with RateLimitError after exhausting retries', async () => {
    const server = await startServer(() => ({ status: 429, headers: { 'retry-after': '1' } }))
    const clock = fakeClock()
    const client = new HttpClient({
      loadToken: async () => await Promise.resolve(sampleToken()),
      now: clock.now,
      sleep: clock.sleep,
      maxRetries: 2
    })

    await assert.rejects(
      async () => await client.request('GET', `${server.url}/x`),
      (err: unknown) => err instanceof RateLimitError
    )
    assert.equal(clock.sleptMs.length, 2)

    await server.close()
  })
})

describe('HttpClient: 5xx and network errors', () => {
  it('retries a 500 with backoff up to maxRetries, then fails mapped', async () => {
    const server = await startServer(() => ({ status: 503 }))
    const clock = fakeClock()
    const client = new HttpClient({
      loadToken: async () => await Promise.resolve(sampleToken()),
      now: clock.now,
      sleep: clock.sleep,
      maxRetries: 3,
      baseDelayMs: 100,
      random: () => 0.5
    })

    await assert.rejects(
      async () => await client.request('GET', `${server.url}/x`),
      (err: unknown) => {
        assert.ok(err instanceof ProviderError)
        assert.ok(err.message.includes('HTTP 503'))
        assert.ok(err.message.includes('3 retries'))
        return true
      }
    )
    assert.equal(clock.sleptMs.length, 3)
    assert.equal(server.requests.length, 4)

    await server.close()
  })

  it('uses a provided error mapper instead of the default', async () => {
    const server = await startServer(() => ({ status: 503 }))
    const clock = fakeClock()
    const client = new HttpClient({
      loadToken: async () => await Promise.resolve(sampleToken()),
      now: clock.now,
      sleep: clock.sleep,
      maxRetries: 0,
      mapError: ({ status }) => status === 503 ? new ProviderError('mapped-503') : undefined
    })

    await assert.rejects(
      async () => await client.request('GET', `${server.url}/x`),
      (err: unknown) => err instanceof ProviderError && err.message === 'mapped-503'
    )

    await server.close()
  })

  it('maps a plain 404 and 403 without a mapper', async () => {
    let status = 404
    const server = await startServer(() => ({ status }))
    const clock = fakeClock()
    const client = new HttpClient({
      loadToken: async () => await Promise.resolve(sampleToken()),
      now: clock.now,
      sleep: clock.sleep
    })

    await assert.rejects(
      async () => await client.request('GET', `${server.url}/x`),
      (err: unknown) => err instanceof NotFoundError
    )

    status = 403
    await assert.rejects(
      async () => await client.request('GET', `${server.url}/x`),
      (err: unknown) => err instanceof AccessRestrictedError
    )

    await server.close()
  })

  it('retries a network error the same as a 5xx, then propagates it', async () => {
    // Start a server, grab its URL, then close it: subsequent requests get
    // ECONNREFUSED (a network error with no response), not an HTTP status.
    const probe = await startServer(() => ({ status: 200 }))
    const { url: deadUrl } = probe
    await probe.close()

    const clock = fakeClock()
    const client = new HttpClient({
      loadToken: async () => await Promise.resolve(sampleToken()),
      now: clock.now,
      sleep: clock.sleep,
      maxRetries: 2
    })

    await assert.rejects(
      async () => await client.request('GET', `${deadUrl}/x`)
    )
    assert.equal(clock.sleptMs.length, 2)
  })
})

describe('HttpClient: 401 refresh-and-retry', () => {
  it('reloads the stored token when another process already refreshed it', async () => {
    let calls = 0
    const server = await startServer(() => {
      calls += 1
      if (calls === 1) {
        return { status: 401 }
      }
      return { status: 200, body: 'ok' }
    })
    const clock = fakeClock()
    // First loadToken() call (before sending) returns the stale token this
    // process still holds; the reload triggered by the 401 (second call)
    // simulates another process having already refreshed it concurrently.
    let loadCalls = 0
    const client = new HttpClient({
      loadToken: async () => {
        loadCalls += 1
        const token = loadCalls === 1
          ? sampleToken({ accessToken: 'stale' })
          : sampleToken({ accessToken: 'fresh' })
        return await Promise.resolve(token)
      },
      now: clock.now,
      sleep: clock.sleep
    })

    const response = await client.request('GET', `${server.url}/x`)

    assert.equal(response.status, 200)
    assert.deepEqual(server.requests, [
      'GET /x auth=Bearer stale',
      'GET /x auth=Bearer fresh'
    ])

    await server.close()
  })

  it('refreshes via the refresh callback and retries once, not counted against maxRetries', async () => {
    let calls = 0
    const server = await startServer(() => {
      calls += 1
      if (calls === 1) {
        return { status: 401 }
      }
      return { status: 200, body: 'ok' }
    })
    const clock = fakeClock()
    let refreshCalls = 0
    const client = new HttpClient({
      loadToken: async () => await Promise.resolve(sampleToken()),
      refreshToken: async (token) => {
        refreshCalls += 1
        return await Promise.resolve({ ...token, accessToken: 'refreshed' })
      },
      saveToken: async () => { await Promise.resolve() },
      now: clock.now,
      sleep: clock.sleep,
      maxRetries: 0
    })

    const response = await client.request('GET', `${server.url}/x`)
    assert.equal(response.status, 200)
    assert.equal(refreshCalls, 1)
    assert.deepEqual(server.requests, [
      'GET /x auth=Bearer access-1',
      'GET /x auth=Bearer refreshed'
    ])

    await server.close()
  })

  it('fails on a second 401 after the refresh-and-retry', async () => {
    const server = await startServer(() => ({ status: 401 }))
    const clock = fakeClock()
    const client = new HttpClient({
      loadToken: async () => await Promise.resolve(sampleToken()),
      refreshToken: async (token) => await Promise.resolve({ ...token, accessToken: 'refreshed' }),
      saveToken: async () => { await Promise.resolve() },
      now: clock.now,
      sleep: clock.sleep
    })

    await assert.rejects(
      async () => await client.request('GET', `${server.url}/x`),
      (err: unknown) => err instanceof AuthRequiredError && err.reason === 'no-token'
    )

    await server.close()
  })

  it('throws AuthRequiredError(token-expired) when there is no refresh token and no refresh callback', async () => {
    const server = await startServer(() => ({ status: 401 }))
    const clock = fakeClock()
    const tokenWithoutRefresh: HttpClientToken = { accessToken: 'access-1', expiresAt: '2099-01-01T00:00:00Z' }
    const client = new HttpClient({
      loadToken: async () => await Promise.resolve(tokenWithoutRefresh),
      now: clock.now,
      sleep: clock.sleep
    })

    await assert.rejects(
      async () => await client.request('GET', `${server.url}/x`),
      (err: unknown) => err instanceof AuthRequiredError && err.reason === 'no-token'
    )

    await server.close()
  })
})

describe('HttpClient: single-flight refresh', () => {
  it('dedups concurrent refreshes: only one refreshToken() call for two concurrent 401s', async () => {
    const server = await startServer((req) => {
      const auth = req.headers.authorization ?? ''
      return auth === 'Bearer fresh-shared'
        ? { status: 200, body: 'ok' }
        : { status: 401 }
    })
    const clock = fakeClock()
    let refreshCalls = 0
    const client = new HttpClient({
      loadToken: async () => await Promise.resolve(sampleToken()),
      refreshToken: async (token) => {
        refreshCalls += 1
        await Promise.resolve()
        return { ...token, accessToken: 'fresh-shared' }
      },
      saveToken: async () => { await Promise.resolve() },
      now: clock.now,
      sleep: clock.sleep,
      maxRetries: 0
    })

    const [r1, r2] = await Promise.all([
      client.request('GET', `${server.url}/a`),
      client.request('GET', `${server.url}/b`)
    ])
    assert.equal(r1.status, 200)
    assert.equal(r2.status, 200)
    assert.equal(refreshCalls, 1)

    await server.close()
  })

  it('a later request still holding the pre-refresh token reuses the last completed refresh', async () => {
    const server = await startServer((req) => {
      const auth = req.headers.authorization ?? ''
      return auth === 'Bearer fresh-shared'
        ? { status: 200, body: 'ok' }
        : { status: 401 }
    })
    const clock = fakeClock()
    let refreshCalls = 0
    const client = new HttpClient({
      // Always returns the original, pre-refresh token: this client never
      // sees the token store update (as if another request's save hasn't
      // been reloaded yet), so the second call must reuse the last
      // completed refresh instead of refreshing again (ADR-0010 §3).
      loadToken: async () => await Promise.resolve(sampleToken()),
      refreshToken: async (token) => {
        refreshCalls += 1
        await Promise.resolve()
        return { ...token, accessToken: 'fresh-shared' }
      },
      saveToken: async () => { await Promise.resolve() },
      now: clock.now,
      sleep: clock.sleep,
      maxRetries: 0
    })

    const first = await client.request('GET', `${server.url}/a`)
    assert.equal(first.status, 200)
    assert.equal(refreshCalls, 1)

    const second = await client.request('GET', `${server.url}/b`)
    assert.equal(second.status, 200)
    assert.equal(refreshCalls, 1)

    await server.close()
  })
})

describe('HttpClient: proactive refresh', () => {
  it('refreshes before sending when the token expires within the proactive window', async () => {
    const server = await startServer(() => ({ status: 200, body: 'ok' }))
    const clock = fakeClock()
    let refreshCalls = 0
    const client = new HttpClient({
      loadToken: async () => await Promise.resolve(sampleToken({ expiresAt: new Date(30_000).toISOString() })),
      refreshToken: async (token) => {
        refreshCalls += 1
        return await Promise.resolve({ ...token, accessToken: 'proactively-refreshed' })
      },
      saveToken: async () => { await Promise.resolve() },
      now: clock.now,
      sleep: clock.sleep,
      proactiveRefreshWindowMs: 60_000
    })

    const response = await client.request('GET', `${server.url}/x`)
    assert.equal(response.status, 200)
    assert.equal(refreshCalls, 1)
    assert.deepEqual(server.requests, ['GET /x auth=Bearer proactively-refreshed'])

    await server.close()
  })

  it('does not refresh when the token is not close to expiry', async () => {
    const server = await startServer(() => ({ status: 200, body: 'ok' }))
    const clock = fakeClock()
    let refreshCalls = 0
    const client = new HttpClient({
      loadToken: async () => await Promise.resolve(sampleToken({ expiresAt: new Date(10 * 60_000).toISOString() })),
      refreshToken: async (token) => {
        refreshCalls += 1
        return await Promise.resolve({ ...token, accessToken: 'should-not-happen' })
      },
      saveToken: async () => { await Promise.resolve() },
      now: clock.now,
      sleep: clock.sleep,
      proactiveRefreshWindowMs: 60_000
    })

    const response = await client.request('GET', `${server.url}/x`)
    assert.equal(response.status, 200)
    assert.equal(refreshCalls, 0)

    await server.close()
  })
})
