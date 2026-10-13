import { readFileSync } from 'node:fs'
import type { CanonicalTrack } from '../../core/canonical-track.ts'
import { LIKED_SONGS_NAME, PLAYLIST_FILE_SCHEMA_VERSION } from '../../core/export/format.ts'
import type { CanonicalPlaylistFile } from '../../core/export/format.ts'
import { AccessRestrictedError, AuthRequiredError, NotFoundError, UsageError } from '../../core/provider/errors.ts'
import type { Page, PageRequest, PlaylistSummary, Provider } from '../../core/provider/provider.ts'
import type { CommandContext } from '../args.ts'
import { readStdin, resolvePlaylistArguments } from '../stdin.ts'

const FIRST_OFFSET = 0
const EMPTY_COUNT = 0
const ONE_COUNT = 1
const SPOTIFY_PROVIDER_ID = 'spotify'
const SPOTIFY_LIKED_SCOPE = 'user-library-read'

export interface ExportTask {
  input: string
  kind: 'playlist' | 'liked'
  playlist?: PlaylistSummary
  resolutionError?: unknown
}

export interface ExportTaskOptions {
  all: boolean
  liked: boolean
  outputPath?: string
}

export async function resolveExportTasks (
  context: CommandContext,
  provider: Provider,
  options: ExportTaskOptions
): Promise<ExportTask[]> {
  if (options.all) return await resolveAllTasks(provider)
  if (options.liked) return [{ input: '--liked', kind: 'liked' }]
  const refs = await getPlaylistArguments(context, options.outputPath)
  const parsedRefs = refs.map(input => ({ input, ref: provider.parsePlaylistRef(input) }))
  return await resolvePlaylistTasks(provider, parsedRefs, createPlaylistListLoader(provider))
}

export async function assertLikedSongsReadable (provider: Provider): Promise<void> {
  if (provider.capabilities.likedSongs.read === 'none') {
    throw new UsageError(`${provider.displayName} does not support Liked Songs export`)
  }
  if (provider.id === SPOTIFY_PROVIDER_ID) {
    const auth = await provider.auth.status()
    if (!auth.scopes.includes(SPOTIFY_LIKED_SCOPE)) {
      throw new AuthRequiredError('missing-scope', SPOTIFY_LIKED_SCOPE)
    }
  }
}

export async function readExportTask (
  provider: Provider,
  task: ExportTask,
  userId?: string
): Promise<{ file: CanonicalPlaylistFile, unsupportedCount: number }> {
  if (task.resolutionError !== undefined) {
    throw task.resolutionError instanceof Error ? task.resolutionError : new Error('Playlist resolution failed')
  }
  if (task.kind === 'liked') return await readLikedPlaylist(provider, userId)
  return await readPlaylist(provider, task.playlist, userId)
}

async function resolveAllTasks (provider: Provider): Promise<ExportTask[]> {
  const playlists = await readAllPages(
    provider.capabilities.readPageSize.playlists,
    provider.capabilities.paginationModel,
    async request => await provider.listPlaylists(request)
  )
  const tasks: ExportTask[] = playlists.map(playlist => ({
    input: playlist.ref,
    kind: 'playlist',
    playlist
  }))
  if (provider.capabilities.likedSongs.read !== 'none') {
    tasks.push({ input: '--liked', kind: 'liked' })
  }
  return tasks
}

async function getPlaylistArguments (
  context: CommandContext,
  outputPath: string | undefined
): Promise<string[]> {
  const refs = context.positionals.includes('-')
    ? resolvePlaylistArguments(
      context.positionals,
      await readStdin(context.stdin),
      context.stdinIsTTY
    )
    : context.positionals
  if (refs.length === EMPTY_COUNT) throw new UsageError('Expected at least one playlist')
  if (outputPath === undefined && refs.length !== ONE_COUNT) {
    throw new UsageError('Multiple sources require -o <directory>')
  }
  return refs
}

async function resolvePlaylistTasks (
  provider: Provider,
  parsedRefs: Array<{ input: string, ref: string | null }>,
  getPlaylists: () => Promise<PlaylistSummary[]>
): Promise<ExportTask[]> {
  const tasks: ExportTask[] = []
  for (const { input, ref } of parsedRefs) {
    if (ref === null) {
      // Name matching uses one cached provider listing and preserves argument order.
      // eslint-disable-next-line no-await-in-loop -- Name-resolution errors must be detected before any export is written.
      tasks.push(resolveNameTask(input, await getPlaylists()))
      continue
    }
    // Keep resolution in source order so ambiguity and not-found results match the arguments.
    // eslint-disable-next-line no-await-in-loop -- Playlist refs resolve independently but output order is contractual.
    tasks.push(await resolveRefTask(provider, input, ref, getPlaylists))
  }
  return tasks
}

function resolveNameTask (input: string, playlists: PlaylistSummary[]): ExportTask {
  try {
    return { input, kind: 'playlist', playlist: resolvePlaylistByName(input, playlists) }
  } catch (error) {
    if (error instanceof UsageError) throw error
    return { input, kind: 'playlist', resolutionError: error }
  }
}

async function resolveRefTask (
  provider: Provider,
  input: string,
  ref: string,
  getPlaylists: () => Promise<PlaylistSummary[]>
): Promise<ExportTask> {
  try {
    return { input, kind: 'playlist', playlist: await provider.getPlaylist(ref) }
  } catch (error) {
    if (error instanceof NotFoundError && !isQualifiedRef(input)) {
      return resolveNameTask(input, await getPlaylists())
    }
    return { input, kind: 'playlist', resolutionError: error }
  }
}

function createPlaylistListLoader (provider: Provider): () => Promise<PlaylistSummary[]> {
  let playlistList: Promise<PlaylistSummary[]> | undefined = undefined
  return async () => {
    playlistList ??= readAllPages(
      provider.capabilities.readPageSize.playlists,
      provider.capabilities.paginationModel,
      async request => await provider.listPlaylists(request)
    )
    return await playlistList
  }
}

function resolvePlaylistByName (input: string, playlists: PlaylistSummary[]): PlaylistSummary {
  const exactMatches = playlists.filter(playlist => playlist.name === input)
  const exactMatch = uniquePlaylistMatch(input, exactMatches)
  if (exactMatch !== null) return exactMatch
  const lowerInput = input.toLowerCase()
  const caseInsensitiveMatches = playlists.filter(playlist => playlist.name.toLowerCase() === lowerInput)
  const insensitiveMatch = uniquePlaylistMatch(input, caseInsensitiveMatches)
  if (insensitiveMatch !== null) return insensitiveMatch
  throw new NotFoundError('playlist', input)
}

function uniquePlaylistMatch (input: string, matches: PlaylistSummary[]): PlaylistSummary | null {
  if (matches.length === EMPTY_COUNT) return null
  if (matches.length > ONE_COUNT) {
    const descriptions = matches.map(playlist => {
      const owner = playlist.owner.displayName ?? playlist.owner.id
      const owned = playlist.owned ? ' (owned)' : ''
      return `• ${playlist.name} (id: ${playlist.id}, owner: ${owner}${owned})`
    })
    throw new UsageError(`Ambiguous playlist name "${input}":\n${descriptions.join('\n')}`)
  }
  const [match] = matches
  return match ?? null
}

function isQualifiedRef (input: string): boolean {
  return input.includes(':') || input.startsWith('http://') || input.startsWith('https://')
}

async function readPlaylist (
  provider: Provider,
  playlist: PlaylistSummary | undefined,
  userId?: string
): Promise<{ file: CanonicalPlaylistFile, unsupportedCount: number }> {
  if (playlist === undefined) throw new NotFoundError('playlist')
  if (!playlist.itemsReadable) throw unreadablePlaylistError(provider, playlist)
  const result = await readReadablePlaylistItems(provider, playlist)
  const unsupportedCount = Math.max(EMPTY_COUNT, (result.total ?? result.items.length) - result.items.length)
  return {
    file: createPlaylistFile(provider.id, userId, playlist, result.items),
    unsupportedCount
  }
}

async function readReadablePlaylistItems (
  provider: Provider,
  playlist: PlaylistSummary
): Promise<{ items: CanonicalTrack[], total?: number }> {
  try {
    return await readAllPagesWithTotal(
      provider.capabilities.readPageSize.playlistItems,
      provider.capabilities.paginationModel,
      async request => await provider.getPlaylistTracks(playlist.ref, request)
    )
  } catch (error) {
    if (error instanceof AccessRestrictedError) {
      throw unreadablePlaylistError(provider, playlist, error.reason)
    }
    throw error
  }
}

async function readLikedPlaylist (
  provider: Provider,
  userId?: string
): Promise<{ file: CanonicalPlaylistFile, unsupportedCount: number }> {
  const result = await readAllPagesWithTotal(
    provider.capabilities.readPageSize.liked,
    provider.capabilities.paginationModel,
    async request => await provider.getLikedTracks(request)
  )
  return {
    file: createLikedFile(provider.id, userId, result.items),
    unsupportedCount: Math.max(EMPTY_COUNT, (result.total ?? result.items.length) - result.items.length)
  }
}

function unreadablePlaylistError (
  provider: Provider,
  playlist: PlaylistSummary,
  reason: AccessRestrictedError['reason'] = 'not-owned'
): AccessRestrictedError {
  return new AccessRestrictedError(
    reason,
    `Cannot read the tracks of "${playlist.name}" (owned by ${playlist.owner.displayName ?? playlist.owner.id}). ${provider.displayName} reports that this playlist's tracks are restricted. Workaround: in the ${provider.displayName} app, copy its tracks into a playlist you own, then use that playlist.`
  )
}

function createPlaylistFile (
  providerId: string,
  userId: string | undefined,
  playlist: PlaylistSummary,
  tracks: CanonicalTrack[]
): CanonicalPlaylistFile {
  return {
    schemaVersion: PLAYLIST_FILE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    generator: { name: 'sple', version: getPackageVersion() },
    source: {
      provider: providerId,
      kind: 'playlist',
      ...(userId === undefined ? {} : { userId })
    },
    playlist: {
      ref: playlist.ref,
      id: playlist.id,
      name: playlist.name,
      ...(playlist.description === undefined ? {} : { description: playlist.description }),
      owner: {
        id: playlist.owner.id,
        ...(playlist.owner.displayName === undefined ? {} : { displayName: playlist.owner.displayName })
      },
      ...(playlist.public === undefined ? {} : { public: playlist.public }),
      ...(playlist.collaborative === undefined ? {} : { collaborative: playlist.collaborative }),
      ...(playlist.url === undefined ? {} : { url: playlist.url }),
      trackCount: tracks.length
    },
    tracks: tracks.map((track, index) => ({ ...track, position: index + ONE_COUNT })),
    unsupportedItems: []
  }
}

function createLikedFile (
  providerId: string,
  userId: string | undefined,
  tracks: CanonicalTrack[]
): CanonicalPlaylistFile {
  return {
    schemaVersion: PLAYLIST_FILE_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    generator: { name: 'sple', version: getPackageVersion() },
    source: {
      provider: providerId,
      kind: 'liked',
      ...(userId === undefined ? {} : { userId })
    },
    playlist: { name: LIKED_SONGS_NAME, trackCount: tracks.length },
    tracks: tracks.map((track, index) => ({ ...track, position: index + ONE_COUNT })),
    unsupportedItems: []
  }
}

async function readAllPages<T> (
  pageSize: number,
  paginationModel: Provider['capabilities']['paginationModel'],
  fetchPage: (request: PageRequest) => Promise<Page<T>>
): Promise<T[]> {
  return (await readAllPagesWithTotal(pageSize, paginationModel, fetchPage)).items
}

async function readAllPagesWithTotal<T> (
  pageSize: number,
  paginationModel: Provider['capabilities']['paginationModel'],
  fetchPage: (request: PageRequest) => Promise<Page<T>>
): Promise<{ items: T[], total?: number }> {
  const items: T[] = []
  let request: PageRequest = { limit: pageSize, offset: FIRST_OFFSET }
  let total: number | undefined = undefined
  while (true) {
    // Each cursor depends on the previous response.
    // eslint-disable-next-line no-await-in-loop -- Pagination requests depend on the prior response.
    const page = await fetchPage(request)
    const { items: pageItems, total: pageTotal } = page
    items.push(...pageItems)
    if (pageTotal !== undefined) total = pageTotal
    const next = getNextRequest({ page, request, pageSize, paginationModel, total })
    if (next === undefined) break
    request = next
  }
  return { items, ...(total === undefined ? {} : { total }) }
}

function getNextRequest<T> (options: {
  page: Page<T>
  request: PageRequest
  pageSize: number
  paginationModel: Provider['capabilities']['paginationModel']
  total: number | undefined
}): PageRequest | undefined {
  const { page, request, pageSize, paginationModel, total } = options
  const { next } = page
  const explicit = getExplicitNextRequest(next, pageSize)
  if (explicit !== undefined) return explicit
  return getOffsetNextRequest({ page, request, pageSize, paginationModel, total })
}

function getExplicitNextRequest (
  next: Page<unknown>['next'],
  pageSize: number
): PageRequest | undefined {
  if (next?.offset === undefined && next?.cursor === undefined) return undefined
  return {
    limit: pageSize,
    ...(next.offset === undefined ? {} : { offset: next.offset }),
    ...(next.cursor === undefined ? {} : { cursor: next.cursor })
  }
}

function getOffsetNextRequest<T> (options: {
  page: Page<T>
  request: PageRequest
  pageSize: number
  paginationModel: Provider['capabilities']['paginationModel']
  total: number | undefined
}): PageRequest | undefined {
  const { page, request, pageSize, paginationModel, total } = options
  if (paginationModel !== 'offset') return undefined
  if (total === undefined && page.items.length < pageSize) return undefined
  const nextOffset = (request.offset ?? FIRST_OFFSET) + pageSize
  if (total !== undefined && nextOffset >= total) return undefined
  return { limit: pageSize, offset: nextOffset }
}

function getPackageVersion (): string {
  const parsed: unknown = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'))
  if (!isPackageManifest(parsed)) throw new Error('Invalid package.json version')
  return parsed.version
}

function isPackageManifest (value: unknown): value is PackageManifest {
  return typeof value === 'object' && value !== null &&
    'version' in value && typeof value.version === 'string'
}

interface PackageManifest {
  version: string
}
