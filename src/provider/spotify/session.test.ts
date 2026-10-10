/* eslint-disable @typescript-eslint/require-await -- fake stores and fetch functions mirror asynchronous provider interfaces */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { StoredToken } from '../../core/config/types.ts'
import { AuthRequiredError } from '../../core/provider/errors.ts'
import { createSpotifyApiClient } from './client.ts'
import { getSpotifyAuthStatus, logoutSpotify, requiredSpotifyScopes } from './session.ts'

const FIXED_NOW = Date.UTC(2026, 9, 10, 18)

function storedToken (overrides: Partial<StoredToken> = {}): StoredToken {
  return {
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    expiresAt: '2020-01-01T00:00:00.000Z',
    scopes: ['playlist-read-private'],
    userId: 'mock-user-id',
    displayName: 'Mock User',
    grantedAt: '2026-10-10T18:00:00.000Z',
    ...overrides
  }
}

function requestUrl (input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input
  }
  return input instanceof URL ? input.href : input.url
}

describe('Spotify auth status and logout', () => {
  it('returns stored identity and token metadata without making a network request', async () => {
    let tokenReads = 0
    const status = await getSpotifyAuthStatus({
      loadToken: async () => {
        tokenReads += 1
        return storedToken({
          scopes: ['playlist-read-private', 'user-library-read'],
          refreshTokenExpiresAt: '2026-11-10T18:00:00.000Z'
        })
      }
    })

    assert.deepEqual(status, {
      loggedIn: true,
      user: { id: 'mock-user-id', displayName: 'Mock User' },
      scopes: ['playlist-read-private', 'user-library-read'],
      expiresAt: '2020-01-01T00:00:00.000Z',
      refreshTokenExpiresAt: '2026-11-10T18:00:00.000Z'
    })
    assert.equal(tokenReads, 1)
  })

  it('reports logged out from an empty token store', async () => {
    assert.deepEqual(await getSpotifyAuthStatus({ loadToken: async () => null }), {
      loggedIn: false,
      scopes: []
    })
  })

  it('deletes local tokens and reports that Spotify revocation is unsupported', async () => {
    let deleted = false
    const result = await logoutSpotify({
      deleteToken: async () => { deleted = true }
    })

    assert.equal(deleted, true)
    assert.equal(result.revoked, false)
    assert.deepEqual(result.deletedData, ['Spotify tokens'])
    assert.match(result.notice, /does not support token revocation/v)
    assert.match(result.notice, /https:\/\/www\.spotify\.com\/account\/apps\//v)
  })
})

describe('Spotify API token wiring', () => {
  it('refreshes an expired access token before the API request and persists the rotated token', async () => {
    let current = storedToken()
    const requests: Array<{ url: string, init: RequestInit }> = []
    const saved: StoredToken[] = []
    const client = createSpotifyApiClient({
      clientId: 'mock-client-id',
      loadToken: async () => current,
      saveToken: async (token) => {
        current = token
        saved.push(token)
      },
      now: () => FIXED_NOW,
      fetchImpl: async (input, init) => {
        const url = requestUrl(input)
        requests.push({ url, init: init ?? {} })
        if (url === 'https://accounts.spotify.com/api/token') {
          return Response.json({
            access_token: 'mock-refreshed-access-token',
            refresh_token: 'mock-rotated-refresh-token',
            expires_in: 3600,
            scope: 'playlist-read-private user-library-read'
          })
        }
        return Response.json({ ok: true })
      }
    })

    const response = await client.request('getPlaylist', 'GET', '/v1/playlists/mock-playlist')
    assert.equal(response.status, 200)
    assert.deepEqual(requests.map(({ url }) => url), [
      'https://accounts.spotify.com/api/token',
      'https://api.spotify.com/v1/playlists/mock-playlist'
    ])
    const [tokenRequest, apiRequest] = requests
    assert.ok(tokenRequest !== undefined)
    assert.ok(apiRequest !== undefined)
    assert.equal(tokenRequest.init.method, 'POST')
    const { init: { body: form } } = tokenRequest
    assert.ok(form instanceof URLSearchParams)
    assert.equal(form.get('grant_type'), 'refresh_token')
    assert.equal(form.get('refresh_token'), 'mock-refresh-token')
    assert.equal(form.get('client_id'), 'mock-client-id')
    const { init: apiInit } = apiRequest
    assert.equal(
      new Headers(apiInit.headers).get('authorization'),
      'Bearer mock-refreshed-access-token'
    )
    assert.equal(saved.length, 1)
    const [savedToken] = saved
    assert.deepEqual(savedToken, {
      ...storedToken(),
      accessToken: 'mock-refreshed-access-token',
      refreshToken: 'mock-rotated-refresh-token',
      expiresAt: new Date(FIXED_NOW + 3_600_000).toISOString(),
      scopes: ['playlist-read-private', 'user-library-read']
    })
  })

  it('preserves the stored refresh token and scopes when Spotify omits them on refresh', async () => {
    let current = storedToken()
    const client = createSpotifyApiClient({
      clientId: 'mock-client-id',
      loadToken: async () => current,
      saveToken: async (token) => { current = token },
      now: () => FIXED_NOW,
      fetchImpl: async (input) => {
        if (requestUrl(input) === 'https://accounts.spotify.com/api/token') {
          return Response.json({
            access_token: 'mock-refreshed-access-token',
            expires_in: 3600
          })
        }
        return Response.json({})
      }
    })

    await client.request('getPlaylist', 'GET', '/v1/playlists/mock-playlist')

    assert.equal(current.refreshToken, 'mock-refresh-token')
    assert.deepEqual(current.scopes, ['playlist-read-private'])
  })

  it('propagates invalid_grant as a revoked-auth error and does not call the provider', async () => {
    const requests: string[] = []
    const client = createSpotifyApiClient({
      clientId: 'mock-client-id',
      loadToken: async () => storedToken(),
      fetchImpl: async (input) => {
        requests.push(requestUrl(input))
        return Response.json({ error: 'invalid_grant' }, { status: 400 })
      }
    })

    await assert.rejects(
      client.request('getPlaylist', 'GET', '/v1/playlists/mock-playlist'),
      (error: unknown) => {
        assert.ok(error instanceof AuthRequiredError)
        assert.equal(error.reason, 'revoked')
        assert.match(error.message, /sple auth login/v)
        assert.doesNotMatch(error.message, /mock-(?:access|refresh)-token/v)
        return true
      }
    )
    assert.deepEqual(requests, ['https://accounts.spotify.com/api/token'])
  })

  it('rejects missing operation scopes before making a provider request', async () => {
    let fetchCalls = 0
    const client = createSpotifyApiClient({
      clientId: 'mock-client-id',
      loadToken: async () => storedToken(),
      fetchImpl: async () => {
        fetchCalls += 1
        return Response.json({})
      }
    })

    await assert.rejects(
      client.request('listPlaylists', 'GET', '/v1/me/playlists'),
      (error: unknown) => {
        assert.ok(error instanceof AuthRequiredError)
        assert.equal(error.reason, 'missing-scope')
        assert.equal(error.scope, 'playlist-read-collaborative')
        assert.match(error.message, /Missing scope 'playlist-read-collaborative'/v)
        return true
      }
    )
    assert.equal(fetchCalls, 0)
  })

  it('requires the scopes documented in ADR-0003 Amendment 2', () => {
    assert.deepEqual(requiredSpotifyScopes('search'), [])
    assert.deepEqual(requiredSpotifyScopes('listPlaylists'), [
      'playlist-read-private',
      'playlist-read-collaborative'
    ])
    assert.deepEqual(requiredSpotifyScopes('getPlaylist'), ['playlist-read-private'])
    assert.deepEqual(requiredSpotifyScopes('getPlaylistTracks'), ['playlist-read-private'])
    assert.deepEqual(requiredSpotifyScopes('getLikedTracks'), ['user-library-read'])
    assert.deepEqual(requiredSpotifyScopes({ operation: 'createPlaylist', public: true }), [
      'playlist-modify-public'
    ])
    assert.deepEqual(requiredSpotifyScopes({ operation: 'createPlaylist', public: false }), [
      'playlist-modify-private'
    ])
    assert.deepEqual(requiredSpotifyScopes({
      operation: 'createPlaylist',
      public: false,
      collaborative: true
    }), [
      'playlist-modify-public',
      'playlist-modify-private'
    ])
    assert.deepEqual(requiredSpotifyScopes('removePlaylist'), [
      'playlist-modify-public',
      'playlist-modify-private'
    ])
    assert.deepEqual(requiredSpotifyScopes('populatePlaylist'), [
      'playlist-modify-public',
      'playlist-modify-private'
    ])
    assert.deepEqual(requiredSpotifyScopes('searchTracks'), [])
  })
})
