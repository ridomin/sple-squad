// Shared fakes for the Spotify API operation tests: canned `Response`s and a
// recording requester. Never touches the network.

import assert from 'node:assert/strict'
import { AccessRestrictedError } from '../../core/provider/errors.ts'
import { createSpotifyApiOperations, type SpotifyApiOperation, type SpotifyApiRequest } from './api.ts'

export const PL_ID = 'AAAAAAAAAAAAAAAAAAAAAA'
export const OTHER_ID = 'BBBBBBBBBBBBBBBBBBBBBB'
export const TRACK_ID = 'CCCCCCCCCCCCCCCCCCCCCC'
export const TRACK_URI = `spotify:track:${TRACK_ID}`
export const HTTP_OK = 200
export const HTTP_CREATED = 201
export const HTTP_SERVER_ERROR = 500
export const TRACK_DURATION_MS = 1234
export const PLAYLIST_TOTAL = 3
export const FIRST_CALL = 0
export const SECOND_CALL = 1

export interface Call { operation: SpotifyApiOperation, method: string, url: URL, body?: unknown }
export type Responder = (call: Call) => Response | Error

export function json (body: unknown, status = HTTP_OK): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export function track (id = TRACK_ID, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'track',
    id,
    uri: `spotify:track:${id}`,
    name: 'Song',
    duration_ms: TRACK_DURATION_MS,
    artists: [{ name: 'Artist A' }, { name: 'Artist B' }],
    album: { name: 'Album' },
    external_ids: { isrc: 'USRC17607839' },
    ...extra
  }
}

export function playlist (id: string, ownerId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: `List ${id.charAt(FIRST_CALL)}`,
    description: 'desc',
    owner: { id: ownerId, display_name: 'Owner' },
    public: false,
    collaborative: false,
    items: { total: PLAYLIST_TOTAL },
    external_urls: { spotify: `https://open.spotify.com/playlist/${id}` },
    ...extra
  }
}

export function setup (responder: Responder): { api: ReturnType<typeof createSpotifyApiOperations>, calls: Call[] } {
  const calls: Call[] = []
  const request: SpotifyApiRequest = async (operation, method, path, init) => {
    const call: Call = {
      operation,
      method,
      url: new URL(path, 'https://api.spotify.com'),
      ...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {})
    }
    calls.push(call)
    const result = responder(call)
    if (result instanceof Error) {
      throw result
    }
    return await Promise.resolve(result)
  }
  return { api: createSpotifyApiOperations(request), calls }
}

export function me (call: Call): Response | undefined {
  return call.url.pathname === '/v1/me' ? json({ id: 'me', display_name: 'Me' }) : undefined
}

export function at<T> (items: readonly T[], index: number): T {
  const { [index]: item } = items
  assert.ok(item !== undefined, `expected an item at index ${index}`)
  return item
}


export function failing (error: Error): ReturnType<typeof setup> {
  return setup(() => error)
}

export function respondingJson (body: unknown, withMe = false): ReturnType<typeof setup> {
  return setup((call) => (withMe ? me(call) : undefined) ?? json(body))
}

export function isNotOwned (err: unknown): boolean {
  return err instanceof AccessRestrictedError && err.reason === 'not-owned'
}
