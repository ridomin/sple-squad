/* eslint-disable @typescript-eslint/require-await -- test doubles are async to match the dependency interfaces, even when their mocked response is immediate */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { request } from 'node:http'
import { describe, it } from 'node:test'
import { AccessRestrictedError, ProviderError, RateLimitError } from '../../core/provider/errors.ts'
import { loginSpotify } from './auth.ts'

const CLIENT_ID = 'test-client-id'
const ACCESS_TOKEN = 'mock-access-token'
const REFRESH_TOKEN = 'mock-refresh-token'
const FIXED_NOW = Date.UTC(2026, 9, 10, 18)

interface MockRequest {
  url: string
  init?: RequestInit
}

function makeSuccessfulFetch (requests: MockRequest[]): typeof fetch {
  return async (input, init) => {
    const url = requestUrl(input)
    requests.push({ url, init })
    if (url === 'https://accounts.spotify.com/api/token') {
      return Response.json({
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
        expires_in: 3600,
        scope: 'playlist-read-private user-library-read'
      })
    }
    if (url === 'https://api.spotify.com/v1/me') {
      return Response.json({ id: 'spotify-user-id', display_name: 'Test User' })
    }
    throw new Error(`Unexpected mock request: ${url}`)
  }
}

function requestUrl (input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input
  }
  return input instanceof URL ? input.href : input.url
}

function requestBody (request: MockRequest): URLSearchParams {
  const body = request.init?.body
  assert.ok(body instanceof URLSearchParams)
  return body
}

function getAuthorizationUrl (messages: string[]): URL {
  const url = messages.find((message) => message.startsWith('https://accounts.spotify.com/authorize?'))
  assert.ok(url !== undefined, 'authorization URL should be printed for the user')
  return new URL(url)
}

async function localRedirect (redirectUri: string, state: string, code: string): Promise<number> {
  const redirect = new URL(redirectUri)
  redirect.searchParams.set('state', state)
  redirect.searchParams.set('code', code)

  // eslint-disable-next-line promise/avoid-new -- wrap the Node HTTP callback in a promise for the test
  return await new Promise((resolve, reject) => {
    const callback = request({
      hostname: redirect.hostname,
      port: Number(redirect.port),
      path: `${redirect.pathname}${redirect.search}`,
      method: 'GET'
    }, (response) => {
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    callback.once('error', reject)
    callback.end()
  })
}

describe('loginSpotify', () => {
  it('completes manual PKCE authorization, exchanges the code, gets identity, and saves only then', async () => {
    const messages: string[] = []
    const requests: MockRequest[] = []
    let savedToken: unknown = undefined

    const result = await loginSpotify({ clientId: CLIENT_ID, mode: 'manual' }, {
      fetchImpl: makeSuccessfulFetch(requests),
      writeStderr: (message) => { messages.push(message) },
      readLine: async () => {
        const authorizationUrl = getAuthorizationUrl(messages)
        const redirect = authorizationUrl.searchParams.get('redirect_uri')
        const state = authorizationUrl.searchParams.get('state')
        assert.equal(redirect, 'http://127.0.0.1/callback')
        assert.ok(state !== null)
        return `${redirect}?code=mock-authorization-code&state=${state}`
      },
      saveToken: async (token) => { savedToken = token },
      now: () => FIXED_NOW
    })

    const authorizationUrl = getAuthorizationUrl(messages)
    const tokenRequest = requests.at(0)
    assert.ok(tokenRequest !== undefined)
    const verifier = requestBody(tokenRequest).get('code_verifier')
    assert.ok(verifier !== null)
    assert.match(verifier, /^[A-Za-z0-9_\x2d]{43}$/v)
    assert.equal(authorizationUrl.searchParams.get('client_id'), CLIENT_ID)
    assert.equal(authorizationUrl.searchParams.get('response_type'), 'code')
    assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(
      authorizationUrl.searchParams.get('code_challenge'),
      createChallenge(verifier)
    )
    assert.equal(
      authorizationUrl.searchParams.get('scope'),
      'playlist-read-private playlist-read-collaborative user-library-read playlist-modify-public playlist-modify-private'
    )

    assert.equal(requests.length, 2)
    assert.equal(tokenRequest.url, 'https://accounts.spotify.com/api/token')
    const tokenForm = requestBody(tokenRequest)
    assert.equal(tokenForm.get('grant_type'), 'authorization_code')
    assert.equal(tokenForm.get('code'), 'mock-authorization-code')
    assert.equal(tokenForm.get('client_id'), CLIENT_ID)
    assert.equal(tokenForm.get('redirect_uri'), authorizationUrl.searchParams.get('redirect_uri'))
    assert.equal(tokenForm.has('client_secret'), false)
    const identityRequest = requests.at(1)
    assert.ok(identityRequest !== undefined)
    assert.equal(identityRequest.url, 'https://api.spotify.com/v1/me')
    assert.equal(new Headers(identityRequest.init?.headers).get('authorization'), `Bearer ${ACCESS_TOKEN}`)
    assert.deepEqual(savedToken, {
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      expiresAt: new Date(FIXED_NOW + 3_600_000).toISOString(),
      scopes: ['playlist-read-private', 'user-library-read'],
      userId: 'spotify-user-id',
      displayName: 'Test User',
      grantedAt: new Date(FIXED_NOW).toISOString()
    })
    assert.deepEqual(result, {
      userId: 'spotify-user-id',
      displayName: 'Test User',
      scopes: ['playlist-read-private', 'user-library-read'],
      expiresAt: new Date(FIXED_NOW + 3_600_000).toISOString()
    })
  })

  it('opens a dynamically assigned loopback callback in browser mode', async () => {
    const messages: string[] = []
    const requests: MockRequest[] = []
    let saved = false

    const result = await loginSpotify({ clientId: CLIENT_ID }, {
      fetchImpl: makeSuccessfulFetch(requests),
      writeStderr: (message) => { messages.push(message) },
      openBrowser: async (url) => {
        const authorizationUrl = new URL(url)
        const redirect = authorizationUrl.searchParams.get('redirect_uri')
        const state = authorizationUrl.searchParams.get('state')
        assert.ok(redirect !== null)
        assert.ok(state !== null)
        const callback = new URL(redirect)
        assert.equal(callback.hostname, '127.0.0.1')
        assert.notEqual(callback.port, '')
        assert.equal(await localRedirect(redirect, state, 'loopback-code'), 200)
      },
      saveToken: async () => { saved = true },
      now: () => FIXED_NOW
    })

    assert.equal(saved, true)
    assert.equal(result.userId, 'spotify-user-id')
    assert.equal(requests.length, 2)
    assert.ok(messages.includes('Waiting for authorization...'))
  })

  it('continues with the printed URL when opening the browser fails', async () => {
    const messages: string[] = []
    const requests: MockRequest[] = []

    const result = await loginSpotify({ clientId: CLIENT_ID }, {
      fetchImpl: makeSuccessfulFetch(requests),
      writeStderr: (message) => { messages.push(message) },
      openBrowser: async (url) => {
        const authorizationUrl = new URL(url)
        const redirect = authorizationUrl.searchParams.get('redirect_uri')
        const state = authorizationUrl.searchParams.get('state')
        assert.ok(redirect !== null)
        assert.ok(state !== null)
        assert.equal(await localRedirect(redirect, state, 'browser-fallback-code'), 200)
        throw new Error('Browser unavailable')
      },
      saveToken: async () => { await Promise.resolve() },
      now: () => FIXED_NOW
    })

    assert.equal(result.userId, 'spotify-user-id')
    assert.ok(messages.some((message) => message.includes('Could not open a browser')))
    assert.equal(requests.length, 2)
  })

  it('does not open a browser in no-browser mode and uses an ephemeral loopback port', async () => {
    const messages: string[] = []
    const requests: MockRequest[] = []
    let openedBrowser = false
    const { promise: authorizationUrlReady, resolve: authorizationUrlResolve } = Promise.withResolvers<URL>()

    const login = loginSpotify({ clientId: CLIENT_ID, mode: 'no-browser' }, {
      fetchImpl: makeSuccessfulFetch(requests),
      writeStderr: (message) => {
        messages.push(message)
        if (message.startsWith('https://accounts.spotify.com/authorize?')) {
          authorizationUrlResolve(new URL(message))
        }
      },
      openBrowser: async () => { openedBrowser = true },
      now: () => FIXED_NOW
    })
    const authorizationUrl = await authorizationUrlReady
    const redirect = authorizationUrl.searchParams.get('redirect_uri')
    const state = authorizationUrl.searchParams.get('state')
    assert.ok(redirect !== null)
    assert.ok(state !== null)
    assert.notEqual(new URL(redirect).port, '')
    assert.equal(await localRedirect(redirect, state, 'no-browser-code'), 200)

    const result = await login
    assert.equal(openedBrowser, false)
    assert.equal(result.userId, 'spotify-user-id')
    assert.equal(requests.length, 2)
  })

  it('rejects a manual redirect with invalid state before any provider request', async () => {
    const messages: string[] = []
    const requests: MockRequest[] = []
    let saved = false

    await assert.rejects(
      loginSpotify({ clientId: CLIENT_ID, mode: 'manual' }, {
        fetchImpl: makeSuccessfulFetch(requests),
        writeStderr: (message) => { messages.push(message) },
        readLine: async () => {
          const authorizationUrl = getAuthorizationUrl(messages)
          return `http://127.0.0.1/callback?code=must-not-exchange&state=${authorizationUrl.searchParams.get('state')}-wrong`
        },
        saveToken: async () => { saved = true }
      }),
      (error: unknown) => error instanceof ProviderError && error.message === 'State validation failed'
    )
    assert.equal(requests.length, 0)
    assert.equal(saved, false)
  })

  it('rejects a loopback callback with invalid state before any provider request', async () => {
    const requests: MockRequest[] = []
    const messages: string[] = []
    let saved = false

    await assert.rejects(
      loginSpotify({ clientId: CLIENT_ID }, {
        fetchImpl: makeSuccessfulFetch(requests),
        writeStderr: (message) => { messages.push(message) },
        openBrowser: async (url) => {
          const authorizationUrl = new URL(url)
          const redirect = authorizationUrl.searchParams.get('redirect_uri')
          const state = authorizationUrl.searchParams.get('state')
          assert.ok(redirect !== null)
          assert.ok(state !== null)
          assert.equal(await localRedirect(redirect, `${state}-wrong`, 'invalid-state-code'), 400)
        },
        saveToken: async () => { saved = true }
      }),
      (error: unknown) => error instanceof ProviderError && error.message === 'State validation failed'
    )
    assert.equal(requests.length, 0)
    assert.equal(saved, false)
  })

  it('maps an authorization-code token failure without saving credentials', async () => {
    const messages: string[] = []
    let saved = false
    let identityRequested = false

    await assert.rejects(
      loginSpotify({ clientId: CLIENT_ID, mode: 'manual' }, {
        fetchImpl: async (input) => {
          if (requestUrl(input) === 'https://accounts.spotify.com/api/token') {
            return Response.json({ error: 'invalid_grant' }, { status: 400 })
          }
          identityRequested = true
          return Response.json({})
        },
        writeStderr: (message) => { messages.push(message) },
        readLine: async () => {
          const authorizationUrl = getAuthorizationUrl(messages)
          return `http://127.0.0.1/callback?code=expired&state=${authorizationUrl.searchParams.get('state')}`
        },
        saveToken: async () => { saved = true }
      }),
      (error: unknown) => error instanceof ProviderError && error.message.includes('rejected the authorization code')
    )
    assert.equal(identityRequested, false)
    assert.equal(saved, false)
  })

  it('maps token-endpoint network errors without exposing details or saving credentials', async () => {
    const messages: string[] = []
    let saved = false
    let identityRequested = false

    await assert.rejects(
      loginSpotify({ clientId: CLIENT_ID, mode: 'manual' }, {
        fetchImpl: async (input) => {
          if (requestUrl(input) === 'https://accounts.spotify.com/api/token') {
            throw new Error('network failure details')
          }
          identityRequested = true
          return Response.json({})
        },
        writeStderr: (message) => { messages.push(message) },
        readLine: async () => {
          const authorizationUrl = getAuthorizationUrl(messages)
          const redirect = authorizationUrl.searchParams.get('redirect_uri')
          const state = authorizationUrl.searchParams.get('state')
          assert.ok(redirect !== null)
          assert.ok(state !== null)
          return `${redirect}?code=network-failure-code&state=${state}`
        },
        saveToken: async () => { saved = true }
      }),
      (error: unknown) => error instanceof ProviderError &&
        error.message === 'Spotify token endpoint request failed'
    )
    assert.equal(identityRequested, false)
    assert.equal(saved, false)
  })

  it('maps Spotify API network and provider errors without saving credentials', async () => {
    const apiResponses = [
      async () => await Promise.reject<Response>(new Error('network failure details')),
      async () => await Promise.resolve(Response.json({ error: { message: 'Provider unavailable' } }, { status: 503 })),
      async () => await Promise.resolve(Response.json({ error: { message: 'Insufficient access' } }, { status: 403 })),
      async () => await Promise.resolve(Response.json({}, { status: 429, headers: { 'retry-after': '2' } }))
    ]
    await Promise.all(apiResponses.map(async (apiResponse) => {
      const messages: string[] = []
      let saved = false

      await assert.rejects(
        loginSpotify({ clientId: CLIENT_ID, mode: 'manual' }, {
          fetchImpl: async (input) => {
            if (requestUrl(input) === 'https://accounts.spotify.com/api/token') {
              return await Promise.resolve(Response.json({ access_token: ACCESS_TOKEN, expires_in: 3600 }))
            }
            return await apiResponse()
          },
          writeStderr: (message) => { messages.push(message) },
          readLine: async () => {
            const authorizationUrl = getAuthorizationUrl(messages)
            const redirect = authorizationUrl.searchParams.get('redirect_uri')
            const state = authorizationUrl.searchParams.get('state')
            assert.ok(redirect !== null)
            assert.ok(state !== null)
            return `${redirect}?code=provider-failure-code&state=${state}`
          },
          saveToken: async () => { saved = true }
        }),
        // eslint-disable-next-line max-nested-callbacks -- keep each provider failure isolated in the mocked flow
        (error: unknown) => {
          if (error instanceof RateLimitError) {
            assert.equal(error.retryAfterMs, 2000)
            return true
          }
          if (error instanceof AccessRestrictedError) {
            assert.equal(error.reason, 'other')
            return true
          }
          assert.ok(error instanceof ProviderError)
          assert.ok(error.message.includes('Spotify API request failed'))
          return true
        }
      )
      assert.equal(saved, false)
    }))
  })

  it('maps Spotify Premium 403 to an actionable restriction and does not save', async () => {
    const messages: string[] = []
    let saved = false

    await assert.rejects(
      loginSpotify({ clientId: CLIENT_ID, mode: 'manual' }, {
        fetchImpl: async (input) => {
          if (requestUrl(input) === 'https://accounts.spotify.com/api/token') {
            return Response.json({ access_token: ACCESS_TOKEN, expires_in: 3600 })
          }
          return Response.json({ error: { message: 'Premium is required' } }, { status: 403 })
        },
        writeStderr: (message) => { messages.push(message) },
        readLine: async () => {
          const authorizationUrl = getAuthorizationUrl(messages)
          return `http://127.0.0.1/callback?code=code&state=${authorizationUrl.searchParams.get('state')}`
        },
        saveToken: async () => { saved = true }
      }),
      (error: unknown) => {
        assert.ok(error instanceof AccessRestrictedError)
        assert.equal(error.reason, 'premium-required')
        assert.match(error.message, /Spotify Premium/iv)
        assert.match(error.message, /https:\/\/www\.spotify\.com\/premium\//v)
        return true
      }
    )
    assert.equal(saved, false)
  })

  it('rejects stdin closure and missing client configuration without provider requests', async () => {
    const requests: MockRequest[] = []

    await assert.rejects(
      loginSpotify({ clientId: CLIENT_ID, mode: 'manual' }, {
        fetchImpl: makeSuccessfulFetch(requests),
        readLine: async () => null,
        writeStderr: () => undefined
      }),
      (error: unknown) => error instanceof ProviderError && error.message === 'No redirect URL received (stdin closed)'
    )
    await assert.rejects(
      loginSpotify({ clientId: '  ', mode: 'manual' }, { writeStderr: () => undefined }),
      (error: unknown) => error instanceof Error && error.message.includes('SPLE_SPOTIFY_CLIENT_ID')
    )
    assert.equal(requests.length, 0)
  })
})

function createChallenge (verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}
