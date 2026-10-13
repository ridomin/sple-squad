// Validation and canonical mapping of untrusted Spotify Web API payloads
// (NFR-3, PRV-3). Nothing outside this adapter sees a Spotify shape.

import type { CanonicalTrack } from '../../core/canonical-track.ts'
import { ProviderError } from '../../core/provider/errors.ts'
import type { Page, PlaylistSummary, SearchItem, SearchType } from '../../core/provider/index.ts'

type Json = Record<string, unknown>

const EMPTY = 0
const SPOTIFY_ID_PATTERN = /^[0-9A-Za-z]{22}$/v
const OPEN_SPOTIFY_URL_PATTERN = /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z]{2,}(?:-[a-z]+)?\/)?(?<kind>playlist|track)\/(?<id>[0-9A-Za-z]{22})\/?(?:[?#].*)?$/v
const SPOTIFY_URI_PATTERN = /^spotify:(?<kind>playlist|track):(?<id>[0-9A-Za-z]{22})$/v
const UNTITLED = '(untitled)'
const UNKNOWN_ARTIST = 'Unknown Artist'

export function malformed (what: string): ProviderError {
  return new ProviderError(`Unexpected Spotify response: ${what}`)
}

export function isObject (value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function opt<K extends string, V> (key: K, value: V | undefined): Partial<Record<K, V>> {
  const result: Partial<Record<K, V>> = {}
  if (value !== undefined) {
    result[key] = value
  }
  return result
}

function str (value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function num (value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function requireObject (value: unknown, what: string): Json {
  if (!isObject(value)) {
    throw malformed(`${what} is not an object`)
  }
  return value
}

function requireString (value: unknown, what: string): string {
  const s = str(value)
  if (s === undefined) {
    throw malformed(`${what} is missing`)
  }
  return s
}

function parseSpotifyRef (input: string, kind: 'playlist' | 'track'): string | null {
  const trimmed = input.trim()
  if (SPOTIFY_ID_PATTERN.test(trimmed)) {
    return trimmed
  }
  const match = SPOTIFY_URI_PATTERN.exec(trimmed) ?? OPEN_SPOTIFY_URL_PATTERN.exec(trimmed)
  const { kind: matchedKind, id } = match?.groups ?? {}
  return matchedKind === kind && id !== undefined ? id : null
}

/** ADR-0003 §3.1: a playlist ref is the bare 22-char ID. */
export function parsePlaylistRef (input: string): string | null {
  return parseSpotifyRef(input, 'playlist')
}

/** ADR-0003 §3.1: a canonical track ref is `spotify:track:<id>`. */
export function parseTrackRef (input: string): string | null {
  const id = parseSpotifyRef(input, 'track')
  return id === null ? null : `spotify:track:${id}`
}

export interface RawPage {
  items: unknown[]
  total?: number
  hasNext: boolean
}

/** Validates a Spotify paging object (`items`, `total`, `next`). */
export function readPaging (value: unknown, what: string): RawPage {
  const paging = requireObject(value, what)
  if (!Array.isArray(paging.items)) {
    throw malformed(`${what}.items is not an array`)
  }
  return {
    items: paging.items,
    ...opt('total', num(paging.total)),
    hasNext: typeof paging.next === 'string' && paging.next.length > EMPTY
  }
}

export function toPage<T> (raw: RawPage, items: T[], offset: number): Page<T> {
  return {
    items,
    ...opt('total', raw.total),
    ...(raw.hasNext ? { next: { offset: offset + raw.items.length } } : {})
  }
}

function nonEmptyString (value: unknown): string | undefined {
  return typeof value === 'string' && value.length > EMPTY ? value : undefined
}

function artistNames (value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((a: unknown) => {
    const name = isObject(a) ? nonEmptyString(a.name) : undefined
    return name === undefined ? [] : [name]
  })
}

function trackUri (track: Json): string {
  const id = str(track.id)
  const uri = str(track.uri) ?? (id === undefined ? undefined : `spotify:track:${id}`)
  if (uri === undefined || parseTrackRef(uri) === null) {
    throw malformed('track has no usable id or uri')
  }
  return uri
}

function isUnsupportedItem (track: Json): boolean {
  return (track.type !== undefined && track.type !== 'track') || track.is_local === true
}

/** Maps a Spotify track object; returns `null` for anything that is not a usable track (null, episode, local file). */
export function mapTrack (value: unknown, addedAt?: string): CanonicalTrack | null {
  if (value === null || value === undefined) {
    return null
  }
  const track = requireObject(value, 'track')
  if (isUnsupportedItem(track)) {
    return null
  }
  const uri = trackUri(track)
  const artists = artistNames(track.artists)
  const album = isObject(track.album) ? nonEmptyString(track.album.name) : undefined
  const durationMs = num(track.duration_ms)
  const isrc = isObject(track.external_ids) ? nonEmptyString(track.external_ids.isrc) : undefined
  return {
    title: nonEmptyString(track.name) ?? UNTITLED,
    artists: artists.length === EMPTY ? [UNKNOWN_ARTIST] : artists,
    ...opt('album', album),
    ...opt('durationMs', durationMs),
    isrc: isrc ?? null,
    refs: { spotify: uri },
    ...opt('addedAt', addedAt)
  }
}

/** Maps a `{ added_at, item | track }` wrapper (playlist items use `item` since the Feb 2026 change; liked tracks use `track`). */
export function mapTrackWrapper (value: unknown): CanonicalTrack | null {
  if (value === null || value === undefined) {
    return null
  }
  const wrapper = requireObject(value, 'item')
  if (wrapper.is_local === true) {
    return null
  }
  const inner = wrapper.item ?? wrapper.track
  return mapTrack(inner, str(wrapper.added_at))
}

function readOwner (value: unknown): { id: string, displayName?: string } {
  const owner = requireObject(value, 'playlist.owner')
  return {
    id: requireString(owner.id, 'playlist.owner.id'),
    ...opt('displayName', nonEmptyString(owner.display_name))
  }
}

function playlistTrackCount (playlist: Json): number | undefined {
  // `items` replaced `tracks` in the Feb 2026 change; both are tolerated for the count only.
  const container = isObject(playlist.items) ? playlist.items : playlist.tracks
  return isObject(container) ? num(container.total) : undefined
}

function externalUrl (item: Json): string | undefined {
  return isObject(item.external_urls) ? str(item.external_urls.spotify) : undefined
}

function playlistId (playlist: Json): string {
  const id = requireString(playlist.id, 'playlist.id')
  if (!SPOTIFY_ID_PATTERN.test(id)) {
    throw malformed('playlist.id is not a Spotify ID')
  }
  return id
}

/** Maps a playlist object. `ownedOverride` is used for playlists the adapter just created. */
export function mapPlaylist (value: unknown, currentUserId: string, ownedOverride?: boolean): PlaylistSummary {
  const playlist = requireObject(value, 'playlist')
  const id = playlistId(playlist)
  const owner = readOwner(playlist.owner)
  const owned = ownedOverride ?? owner.id === currentUserId
  return {
    ref: id,
    id,
    name: requireString(playlist.name, 'playlist.name'),
    ...opt('description', nonEmptyString(playlist.description)),
    owner,
    owned,
    // ADR-0003 Amendment 2: a non-owned playlist is readable when the response carries an `items` key.
    itemsReadable: owned || isObject(playlist.items),
    ...opt('trackCount', playlistTrackCount(playlist)),
    ...opt('public', typeof playlist.public === 'boolean' ? playlist.public : undefined),
    ...opt('collaborative', typeof playlist.collaborative === 'boolean' ? playlist.collaborative : undefined),
    ...opt('url', externalUrl(playlist))
  }
}

function mapAlbumSearchItem (item: Json, id: string, base: SearchItemBase): SearchItem {
  return {
    ...base,
    type: 'album',
    ref: str(item.uri) ?? `spotify:album:${id}`,
    artists: artistNames(item.artists),
    ...opt('releaseDate', str(item.release_date)),
    ...opt('trackCount', num(item.total_tracks))
  }
}

interface SearchItemBase { id: string, name: string, url?: string }

/** Maps one search result of `type`; `null` for the null entries Spotify can return. */
export function mapSearchItem (type: SearchType, value: unknown): SearchItem | null {
  if (value === null || value === undefined) {
    return null
  }
  const item = requireObject(value, `${type} result`)
  const id = requireString(item.id, `${type}.id`)
  const base: SearchItemBase = { id, name: str(item.name) ?? '', ...opt('url', externalUrl(item)) }
  switch (type) {
    case 'track': {
      const track = mapTrack(item)
      return track === null ? null : { ...base, type, ref: track.refs.spotify ?? `spotify:track:${id}`, track }
    }
    case 'album':
      return mapAlbumSearchItem(item, id, base)
    case 'artist':
      return { ...base, type, ref: str(item.uri) ?? `spotify:artist:${id}` }
    case 'playlist':
      return { ...base, type, ref: id, owner: readOwner(item.owner), ...opt('trackCount', playlistTrackCount(item)) }
  }
}
