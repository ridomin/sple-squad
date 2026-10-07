// Seed-data shapes for the fake provider (ADR-0003 §3.1, §5, Consequences).
// A fixture set is plain data: a `createFakeProvider` caller builds one of
// these (by hand, or generated) and the fake provider turns it into
// in-memory `Provider` state. No I/O, no network.

/** One catalog track. `id` is the bare decimal id used to build the canonical track ref `fake:track:<id>` (§3.1). */
export interface FakeTrackFixture {
  id: string
  title: string
  artists: string[]
  album?: string
  durationMs?: number
  /** Three-state per `CanonicalTrack.isrc` (ADR-0005 §5): absent, `null` (confirmed none), or a value. */
  isrc?: string | null
  addedAt?: string
}

/** One playlist. `id` is the bare decimal id used as `PlaylistSummary.ref` (§3.1). `trackIds` reference `FakeTrackFixture.id` values in the catalog, in playlist order. */
export interface FakePlaylistFixture {
  id: string
  name: string
  description?: string
  owner: { id: string, displayName?: string }
  /** Defaults to `true`. */
  owned?: boolean
  /** Defaults to `owned` (a non-owned playlist is only readable when the capability/test says so). */
  itemsReadable?: boolean
  public?: boolean
  collaborative?: boolean
  trackIds: string[]
}

/** The full seed for one fake-provider instance. Every field defaults to empty/none. */
export interface FakeProviderFixtures {
  playlists?: FakePlaylistFixture[]
  /** The searchable catalog; also supplies every track referenced by `playlists[].trackIds` and `liked`. */
  catalog?: FakeTrackFixture[]
  /** Track ids (from `catalog`) in the current user's Liked Songs, most-recently-added first. */
  liked?: string[]
  user?: { id: string, displayName?: string }
}

const DEFAULT_USER = { id: 'fake-user', displayName: 'Fake User' }

/** Fills in the defaults `createFakeProvider` relies on so callers can omit any field. */
export function normalizeFixtures (fixtures: FakeProviderFixtures): Required<FakeProviderFixtures> {
  return {
    playlists: fixtures.playlists ?? [],
    catalog: fixtures.catalog ?? [],
    liked: fixtures.liked ?? [],
    user: fixtures.user ?? DEFAULT_USER
  }
}
