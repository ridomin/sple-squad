import type { FakeProviderFixtures, FakeTrackFixture } from '../../../../core/provider/fake/fixtures.ts'

const TRACK_DURATION_MS = 180_000
const OWNER = { id: 'me', displayName: 'Me' }
const STRANGER = { id: 'someone-else', displayName: 'Someone Else' }

const track = (id: string, title: string, artists: string[], isrc: string | null): FakeTrackFixture =>
  ({ id, title, artists, album: `${title} (Album)`, durationMs: TRACK_DURATION_MS, isrc, addedAt: '2026-09-01T10:00:00Z' })

/** A multi-playlist library with the shapes `export --all` and `playlist list --filter` must survive. */
export const MULTI_PLAYLIST_LIBRARY: FakeProviderFixtures = {
  user: { id: 'me', displayName: 'Me' },
  catalog: [
    track('t1', 'Alpha', ['Queen'], 'GBUM71029604'),
    track('t2', 'Beta', ['Björk', 'Thom Yorke'], null),
    track('t3', 'Gamma, "Quoted"', ['The Beatles'], 'GBAYE0601498'),
    track('t4', 'Delta', ['Daft Punk'], 'GBDUW0000059')
  ],
  liked: ['t4', 't1'],
  playlists: [
    { id: '1', name: 'Café Mix', owner: OWNER, trackIds: ['t1', 't2', 't3'] },
    { id: '2', name: 'Chill', description: 'first', owner: OWNER, trackIds: ['t2'] },
    { id: '3', name: 'Chill', description: 'second, same name', owner: OWNER, trackIds: ['t4', 't4'] },
    { id: '4', name: 'Empty', owner: OWNER, trackIds: [] },
    { id: '5', name: 'Road/Trip: 66?', owner: OWNER, trackIds: ['t1'] },
    { id: '6', name: 'Followed Readable', owner: STRANGER, owned: false, itemsReadable: true, trackIds: ['t3'] },
    { id: '7', name: 'Followed Locked', owner: STRANGER, owned: false, itemsReadable: false, trackIds: ['t3'] }
  ]
}
