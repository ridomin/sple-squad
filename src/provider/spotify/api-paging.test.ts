// Tests for page clamping boundaries, full traversal without silent truncation,
// and provider parity (Spotify and Fake Provider). No network.

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { UsageError } from "../../core/provider/errors.ts"
import { createFakeProvider } from "../../core/provider/fake/fake-provider.ts"
import {
  FIRST_CALL,
  OTHER_ID,
  PL_ID,
  SECOND_CALL,
  at,
  json,
  me,
  playlist,
  setup,
  track
} from './api-test-support.ts'

function toPlaylistTrackItems (slice: Array<ReturnType<typeof track>>): Array<{ added_at: string, item: ReturnType<typeof track> }> {
  return slice.map((t) => ({ added_at: '2024-01-01T00:00:00Z', item: t }))
}


describe("Spotify page cap boundaries and clamped limits", () => {
  it("search: clamps over-cap, passes cap boundary, and passes below cap", async () => {
    const { api, calls } = setup(() => json({
      tracks: { items: [track()], total: 20, next: "https://api.spotify.com/v1/search?offset=10&limit=10" }
    }))
    // Over cap (50 -> 10)
    const over = await api.search({ text: "q", type: "track" }, { limit: 50 })
    assert.equal(at(calls, 0).url.searchParams.get("limit"), "10")
    assert.deepEqual(over.next, { offset: 1 })

    // Boundary at cap (10 -> 10)
    await api.search({ text: "q", type: "track" }, { limit: 10 })
    assert.equal(at(calls, 1).url.searchParams.get("limit"), "10")

    // Below cap (5 -> 5)
    await api.search({ text: "q", type: "track" }, { limit: 5 })
    assert.equal(at(calls, 2).url.searchParams.get("limit"), "5")
  })

  it("searchTracks: clamps over-cap, passes cap boundary, and passes below cap", async () => {
    const { api, calls } = setup(() => json({ tracks: { items: [track()] } }))
    // Over cap (50 -> 10)
    await api.searchTracks({ kind: "metadata", title: "Song", artists: [] }, { limit: 50 })
    assert.equal(at(calls, 0).url.searchParams.get("limit"), "10")

    // Boundary at cap (10 -> 10)
    await api.searchTracks({ kind: "metadata", title: "Song", artists: [] }, { limit: 10 })
    assert.equal(at(calls, 1).url.searchParams.get("limit"), "10")

    // Below cap (5 -> 5)
    await api.searchTracks({ kind: "metadata", title: "Song", artists: [] }, { limit: 5 })
    assert.equal(at(calls, 2).url.searchParams.get("limit"), "5")
  })

  it("listPlaylists: clamps over-cap, passes cap boundary, and passes below cap", async () => {
    const { api, calls } = setup((call) => me(call) ?? json({
      items: [playlist(PL_ID, "me")],
      total: 100,
      next: "https://api.spotify.com/v1/me/playlists?offset=50&limit=50"
    }))
    // Over cap (100 -> 50)
    const over = await api.listPlaylists({ limit: 100 })
    assert.equal(at(calls, SECOND_CALL).url.searchParams.get("limit"), "50")
    assert.deepEqual(over.next, { offset: 1 })

    // Boundary at cap (50 -> 50)
    await api.listPlaylists({ limit: 50 })
    assert.equal(at(calls, calls.length - 1).url.searchParams.get("limit"), "50")

    // Below cap (25 -> 25)
    await api.listPlaylists({ limit: 25 })
    assert.equal(at(calls, calls.length - 1).url.searchParams.get("limit"), "25")
  })

  it("getPlaylistTracks: clamps over-cap, passes cap boundary, and passes below cap", async () => {
    const { api, calls } = setup(() => json({
      items: [{ added_at: "a", item: track() }],
      total: 250,
      next: "https://api.spotify.com/v1/playlists/items?offset=50&limit=50"
    }))
    // Over cap (200 -> 50)
    const over = await api.getPlaylistTracks(PL_ID, { limit: 200 })
    assert.equal(at(calls, 0).url.searchParams.get("limit"), "50")
    assert.deepEqual(over.next, { offset: 1 })

    // Boundary at cap (50 -> 50)
    await api.getPlaylistTracks(PL_ID, { limit: 50 })
    assert.equal(at(calls, 1).url.searchParams.get("limit"), "50")

    // Below cap (25 -> 25)
    await api.getPlaylistTracks(PL_ID, { limit: 25 })
    assert.equal(at(calls, 2).url.searchParams.get("limit"), "25")
  })

  it("getLikedTracks: clamps over-cap, passes cap boundary, and passes below cap", async () => {
    const { api, calls } = setup(() => json({
      items: [{ added_at: "2024-02-02T00:00:00Z", track: track() }],
      total: 150,
      next: "https://api.spotify.com/v1/me/tracks?offset=50&limit=50"
    }))
    // Over cap (100 -> 50)
    const over = await api.getLikedTracks({ limit: 100 })
    assert.equal(at(calls, 0).url.searchParams.get("limit"), "50")
    assert.deepEqual(over.next, { offset: 1 })

    // Boundary at cap (50 -> 50)
    await api.getLikedTracks({ limit: 50 })
    assert.equal(at(calls, 1).url.searchParams.get("limit"), "50")

    // Below cap (20 -> 20)
    await api.getLikedTracks({ limit: 20 })
    assert.equal(at(calls, 2).url.searchParams.get("limit"), "20")
  })

  it("search window boundaries: enforces limit + offset <= 1000 on clamped limits", async () => {
    const { api, calls } = setup(() => json({ tracks: { items: [] } }))
    // Over cap (50 -> 10): 10 + 990 = 1000 <= 1000 succeeds
    await api.search({ text: "q", type: "track" }, { limit: 50, offset: 990 })
    assert.equal(at(calls, 0).url.searchParams.get("limit"), "10")
    assert.equal(at(calls, 0).url.searchParams.get("offset"), "990")

    // Over cap (50 -> 10): 10 + 991 = 1001 > 1000 throws UsageError
    await assert.rejects(api.search({ text: "q", type: "track" }, { limit: 50, offset: 991 }), UsageError)

    // At cap boundary (10): 10 + 990 = 1000 succeeds, 10 + 991 = 1001 throws
    await api.search({ text: "q", type: "track" }, { limit: 10, offset: 990 })
    await assert.rejects(api.search({ text: "q", type: "track" }, { limit: 10, offset: 991 }), UsageError)

    // Below cap (5): 5 + 995 = 1000 succeeds, 5 + 996 = 1001 throws
    await api.search({ text: "q", type: "track" }, { limit: 5, offset: 995 })
    await assert.rejects(api.search({ text: "q", type: "track" }, { limit: 5, offset: 996 }), UsageError)
  })
})

describe("pagination traversal without silent truncation", () => {
  it("traverses all Spotify pages when requests exceed cap", async () => {
    const totalCount = 250
    const allTracks: Array<ReturnType<typeof track>> = []
    for (let i = 0; i < totalCount; i += 1) {
      allTracks.push(track(`T${String(i).padStart(21, "0")}`))
    }

    const { api, calls } = setup((call) => {
      const offset = Number.parseInt(call.url.searchParams.get("offset") ?? "0", 10)
      const limit = Number.parseInt(call.url.searchParams.get("limit") ?? "100", 10)
      const slice = allTracks.slice(offset, offset + limit)
      const hasMore = offset + limit < totalCount
      return json({
        items: toPlaylistTrackItems(slice),
        total: totalCount,
        next: hasMore ? `https://api.spotify.com/v1/playlists/${PL_ID}/items?offset=${offset + limit}&limit=${limit}` : null
      })
    })

    const collected: string[] = []
    let nextOffset: number | undefined = 0
    while (nextOffset !== undefined) {
      // eslint-disable-next-line no-await-in-loop -- sequential paging traversal
      const page = await api.getPlaylistTracks(PL_ID, { limit: 500, offset: nextOffset })
      for (const { refs: { spotify: ref } } of page.items) {
        assert.ok(ref !== undefined)
        collected.push(ref)
      }
      nextOffset = page.next?.offset
    }

    assert.equal(collected.length, 250)
    assert.equal(calls.length, 5)
    for (let i = 0; i < 5; i += 1) {
      assert.equal(at(calls, i).url.searchParams.get("limit"), "50")
    }
    assert.equal(collected[0], `spotify:track:T${"0".repeat(21)}`)
    assert.equal(collected[249], `spotify:track:T${"0".repeat(18)}249`)
  })
})

describe("provider parity: page clamping across Spotify and Fake Provider", () => {
  it("listPlaylists clamps over-cap requests consistently", async () => {
    const { api } = setup((call) => me(call) ?? json({
      items: [playlist(PL_ID, "me"), playlist(OTHER_ID, "me")],
      total: 100,
      next: "https://api.spotify.com/v1/me/playlists?offset=50&limit=50"
    }))
    const spotifyPage = await api.listPlaylists({ limit: 200 })
    assert.equal(spotifyPage.items.length, 2)
    assert.deepEqual(spotifyPage.next, { offset: 2 })
    assert.equal(spotifyPage.total, 100)

    const fake = createFakeProvider({
      fixtures: {
        playlists: [
          { id: "1", name: "PL1", owner: { id: "me" }, owned: true, trackIds: [] },
          { id: "2", name: "PL2", owner: { id: "me" }, owned: true, trackIds: [] }
        ]
      },
      capabilities: { readPageSize: { playlists: 1, playlistItems: 100, liked: 50 } }
    })
    const fakePage = await fake.listPlaylists({ limit: 200 })
    assert.equal(fakePage.items.length, 1)
    assert.deepEqual(fakePage.next, { offset: 1 })
    assert.equal(fakePage.total, 2)
  })

  it("getPlaylistTracks clamps over-cap requests consistently", async () => {
    const { api } = setup(() => json({
      items: [{ added_at: "a", item: track() }],
      total: 200,
      next: "https://api.spotify.com/v1/playlists/items?offset=100&limit=100"
    }))
    const spotifyPage = await api.getPlaylistTracks(PL_ID, { limit: 500 })
    assert.equal(spotifyPage.items.length, 1)
    assert.deepEqual(spotifyPage.next, { offset: 1 })

    const fake = createFakeProvider({
      fixtures: {
        catalog: [{ id: "1", title: "T1", artists: ["A"] }, { id: "2", title: "T2", artists: ["A"] }],
        playlists: [{ id: "1", name: "PL", owner: { id: "me" }, owned: true, trackIds: ["1", "2"] }]
      },
      capabilities: { readPageSize: { playlists: 50, playlistItems: 1, liked: 50 } }
    })
    const fakePage = await fake.getPlaylistTracks("1", { limit: 500 })
    assert.equal(fakePage.items.length, 1)
    assert.deepEqual(fakePage.next, { offset: 1 })
    assert.equal(fakePage.total, 2)
  })

  it("searchTracks clamps over-cap requests consistently", async () => {
    const { api, calls } = setup(() => json({ tracks: { items: [track()] } }))
    const spotifyHits = await api.searchTracks({ kind: "metadata", title: "Song", artists: [] }, { limit: 50 })
    assert.equal(spotifyHits.length, 1)
    assert.equal(at(calls, FIRST_CALL).url.searchParams.get("limit"), "10")

    const fake = createFakeProvider({
      fixtures: {
        catalog: [{ id: "1", title: "Song 1", artists: ["A"] }, { id: "2", title: "Song 2", artists: ["A"] }]
      },
      capabilities: { maxSearchPageSize: 1 }
    })
    const fakeHits = await fake.searchTracks({ kind: "metadata", title: "Song", artists: [] }, { limit: 50 })
    assert.equal(fakeHits.length, 1)
  })
})
