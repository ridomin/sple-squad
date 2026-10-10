import { readStdin, resolvePlaylistArguments } from '../stdin.ts'
import { UsageError, NotFoundError, AccessRestrictedError } from '../../core/provider/errors.ts'
import type { CanonicalTrack } from '../../core/canonical-track.ts'
import type { Page, PageRequest, PlaylistSummary, Provider } from '../../core/provider/provider.ts'
import { getRegisteredProviders } from '../../provider/registry.ts'
import type { CommandContext, CommandDefinition } from '../args.ts'
import { formatOutput, type OutputColumn } from '../output.ts'

const EMPTY_COUNT = 0
const ONE_ITEM = 1
const FIRST_OFFSET = 0
const TWO_DIGITS = 2
const MILLISECONDS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const PLAYLIST_COLUMNS: OutputColumn[] = [
  { key: 'name', label: 'name', flexible: true },
  { key: 'id', label: 'id' },
  { key: 'tracks', label: 'tracks' },
  { key: 'owner', label: 'owner', flexible: true },
  { key: 'owned', label: 'owned' },
  { key: 'public', label: 'public' },
  { key: 'collaborative', label: 'collaborative' }
]
const TRACK_COLUMNS: OutputColumn[] = [
  { key: 'position', label: '#' },
  { key: 'title', label: 'title', flexible: true },
  { key: 'artists', label: 'artists', flexible: true },
  { key: 'album', label: 'album', flexible: true },
  { key: 'duration', label: 'duration' },
  { key: 'addedAt', label: 'added at' },
  { key: 'id', label: 'id' }
]

export type PlaylistProviderResolver = (context: CommandContext) => Provider

const resolutionCache = new WeakMap<Provider, Promise<PlaylistSummary[]>>()

export function resolvePlaylistProvider (context: CommandContext): Provider {
  const provider = getRegisteredProviders({ config: context.config })
    .find(candidate => candidate.id === context.provider)
  if (provider === undefined) {
    throw new UsageError(`Provider "${context.provider}" is not available`)
  }
  return provider
}

export function createPlaylistCommands (resolveProvider: PlaylistProviderResolver): CommandDefinition[] {
  return [
    {
      path: ['playlist', 'list'],
      description: 'List playlists',
      helpText: 'Usage: sple playlist list [--owned | --followed]',
      options: {
        owned: { type: 'boolean' },
        followed: { type: 'boolean' }
      },
      run: async context => {
        await runPlaylistList(context, resolveProvider(context))
      }
    },
    {
      path: ['playlist', 'show'],
      description: 'Show playlist tracks',
      helpText: 'Usage: sple playlist show <playlist|->',
      run: async context => {
        await runPlaylistShow(context, resolveProvider(context))
      }
    }
  ]
}

async function runPlaylistList (context: CommandContext, provider: Provider): Promise<void> {
  const { positionals, flags } = context
  if (positionals.length > EMPTY_COUNT) throw new UsageError('playlist list does not accept a playlist argument')

  const owned = flags.owned === true
  const followed = flags.followed === true
  if (owned && followed) throw new UsageError('--owned and --followed cannot be used together')

  const filter = owned ? 'owned' : followed ? 'followed' : undefined
  const playlists = await readAllPages(
    provider.capabilities.readPageSize.playlists,
    provider.capabilities.paginationModel,
    async request => await provider.listPlaylists(request, filter)
  )
  const filtered = filter === undefined
    ? playlists
    : playlists.filter(playlist => filter === 'owned' ? playlist.owned : !playlist.owned)
  if (filtered.length === EMPTY_COUNT) {
    context.stderr.write('No playlists.\n')
    if (context.outputMode !== 'json') return
  }

  const rows = filtered.map(toPlaylistRow)
  context.stdout.write(formatOutput({
    mode: context.outputMode,
    value: { playlists: filtered, total: filtered.length },
    columns: PLAYLIST_COLUMNS,
    rows,
    quietIds: filtered.map(playlist => playlist.id),
    outputOptions: { stdoutIsTTY: context.stdoutIsTTY }
  }))
}

async function runPlaylistShow (context: CommandContext, provider: Provider): Promise<void> {
  const playlistInput = await resolveSinglePlaylistArgument(context)
  const playlist = await resolvePlaylist(provider, playlistInput)
  if (!playlist.itemsReadable) throw unreadablePlaylistError(provider, playlist)
  const { items: tracks, total } = await getPlaylistTracks(provider, playlist)
  if (total !== undefined && total > tracks.length) {
    const unsupportedCount = total - tracks.length
    context.stderr.write(
      `sple: warning: ${unsupportedCount} of ${total} items in "${playlist.name}" are not supported (local files, podcast episodes, or unavailable tracks) and are not shown\n`
    )
  }

  if (tracks.length === EMPTY_COUNT) {
    context.stderr.write(`Playlist "${playlist.name}" has no tracks.\n`)
    if (context.outputMode !== 'json') return
  }

  const trackRows = tracks.map((track, index) => ({
    position: index + ONE_ITEM,
    title: track.title,
    artists: track.artists.join(', '),
    album: track.album ?? '',
    duration: formatDuration(track.durationMs),
    addedAt: formatAddedAt(track.addedAt, context.outputMode),
    id: track.refs[provider.id] ?? ''
  }))
  context.stdout.write(formatOutput({
    mode: context.outputMode,
    value: {
      playlist,
      tracks: tracks.map((track, index) => ({ ...track, position: index + ONE_ITEM })),
      unsupportedItems: []
    },
    columns: TRACK_COLUMNS,
    rows: trackRows,
    quietIds: trackRows.map(track => track.id),
    outputOptions: { stdoutIsTTY: context.stdoutIsTTY }
  }))
}

async function resolveSinglePlaylistArgument (context: CommandContext): Promise<string> {
  const { positionals: args } = context
  if (args.length === EMPTY_COUNT) throw new UsageError('Expected one playlist')
  if (args.length > ONE_ITEM && !args.includes('-')) throw new UsageError('Expected exactly one playlist')
  const refs = args.includes('-')
    ? resolvePlaylistArguments(args, await readStdin(context.stdin), context.stdinIsTTY, true)
    : args
  if (refs.length !== ONE_ITEM) throw new UsageError('Expected exactly one playlist')
  const [playlistInput] = refs
  if (playlistInput === undefined) throw new UsageError('Expected one playlist')
  return playlistInput
}

async function getPlaylistTracks (
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

async function resolvePlaylist (provider: Provider, input: string): Promise<PlaylistSummary> {
  const ref = provider.parsePlaylistRef(input)
  const byRef = ref === null ? null : await tryResolveByRef(provider, ref, input)
  if (byRef !== null) return byRef

  const playlists = await getCachedPlaylists(provider)
  return resolvePlaylistByName(playlists, input)
}

async function tryResolveByRef (
  provider: Provider,
  ref: string,
  input: string
): Promise<PlaylistSummary | null> {
  try {
    return await provider.getPlaylist(ref)
  } catch (error) {
    if (error instanceof NotFoundError && !isQualifiedRef(input)) return null
    throw error
  }
}

function resolvePlaylistByName (playlists: PlaylistSummary[], input: string): PlaylistSummary {
  const exactMatches = playlists.filter(playlist => playlist.name === input)
  const exactMatch = getUniqueMatch(input, exactMatches)
  if (exactMatch !== null) return exactMatch

  const loweredInput = input.toLowerCase()
  const insensitiveMatches = playlists.filter(playlist => playlist.name.toLowerCase() === loweredInput)
  const insensitiveMatch = getUniqueMatch(input, insensitiveMatches)
  if (insensitiveMatch !== null) return insensitiveMatch
  throw new NotFoundError('playlist', input)
}

function getUniqueMatch (input: string, matches: PlaylistSummary[]): PlaylistSummary | null {
  if (matches.length === EMPTY_COUNT) return null
  if (matches.length > ONE_ITEM) throw ambiguousPlaylistError(input, matches)
  const [match] = matches
  if (match === undefined) return null
  return match
}

function isQualifiedRef (input: string): boolean {
  return input.includes(':') || input.startsWith('http://') || input.startsWith('https://')
}

function ambiguousPlaylistError (input: string, matches: PlaylistSummary[]): UsageError {
  const descriptions = matches.map(playlist => {
    const owner = playlist.owner.displayName ?? playlist.owner.id
    const owned = playlist.owned ? ' (owned)' : ''
    return `• ${playlist.name} (id: ${playlist.id}, owner: ${owner}${owned})`
  })
  return new UsageError(`Ambiguous playlist name "${input}":\n${descriptions.join('\n')}`)
}

async function getCachedPlaylists (provider: Provider): Promise<PlaylistSummary[]> {
  const existing = resolutionCache.get(provider)
  if (existing !== undefined) return await existing

  const pending = readAllPages(
    provider.capabilities.readPageSize.playlists,
    provider.capabilities.paginationModel,
    async request => await provider.listPlaylists(request)
  )
  resolutionCache.set(provider, pending)
  void pending.catch(() => { resolutionCache.delete(provider) })
  return await pending
}

function toPlaylistRow (playlist: PlaylistSummary): Record<string, unknown> {
  return {
    name: playlist.name,
    id: playlist.id,
    tracks: playlist.trackCount ?? null,
    owner: playlist.owner.displayName ?? playlist.owner.id,
    owned: playlist.owned,
    public: playlist.public ?? null,
    collaborative: playlist.collaborative ?? null
  }
}

function formatDuration (durationMs: number | undefined): string {
  if (durationMs === undefined) return ''
  const totalSeconds = Math.floor(durationMs / MILLISECONDS_PER_SECOND)
  const seconds = totalSeconds % SECONDS_PER_MINUTE
  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  if (totalMinutes < MINUTES_PER_HOUR) {
    return `${totalMinutes}:${String(seconds).padStart(TWO_DIGITS, '0')}`
  }
  const minutes = totalMinutes % MINUTES_PER_HOUR
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR)
  return `${hours}:${String(minutes).padStart(TWO_DIGITS, '0')}:${String(seconds).padStart(TWO_DIGITS, '0')}`
}

function formatAddedAt (addedAt: string | undefined, mode: CommandContext['outputMode']): string {
  if (addedAt === undefined) return ''
  if (mode !== 'table') return addedAt
  const date = new Date(addedAt)
  if (Number.isNaN(date.getTime())) return addedAt
  const year = date.getFullYear()
  const month = String(date.getMonth() + ONE_ITEM).padStart(TWO_DIGITS, '0')
  const day = String(date.getDate()).padStart(TWO_DIGITS, '0')
  return `${year}-${month}-${day}`
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
    // The next page request depends on the cursor/offset returned by this one.
    // eslint-disable-next-line no-await-in-loop -- Each cursor depends on the prior response.
    const page = await fetchPage(request)
    items.push(...page.items)
    const { total: pageTotal } = page
    if (pageTotal !== undefined) total = pageTotal
    const nextRequest = getNextPageRequest({
      page,
      currentRequest: request,
      pageSize,
      paginationModel,
      total
    })
    if (nextRequest === undefined) break
    request = nextRequest
  }

  return { items, ...(total === undefined ? {} : { total }) }
}

function getNextPageRequest<T> (options: {
  page: Page<T>
  currentRequest: PageRequest
  pageSize: number
  paginationModel: Provider['capabilities']['paginationModel']
  total: number | undefined
}): PageRequest | undefined {
  const explicitNext = getExplicitNextPageRequest(options.page, options.pageSize)
  if (explicitNext !== undefined) return explicitNext
  return getOffsetNextPageRequest(options)
}

function getExplicitNextPageRequest<T> (
  page: Page<T>,
  pageSize: number
): PageRequest | undefined {
  const { next } = page
  if (next?.offset === undefined && next?.cursor === undefined) return undefined
  return {
    limit: pageSize,
    ...(next.offset === undefined ? {} : { offset: next.offset }),
    ...(next.cursor === undefined ? {} : { cursor: next.cursor })
  }
}

function getOffsetNextPageRequest (options: {
  currentRequest: PageRequest
  pageSize: number
  paginationModel: Provider['capabilities']['paginationModel']
  total: number | undefined
}): PageRequest | undefined {
  const { currentRequest, pageSize, paginationModel, total } = options
  if (paginationModel !== 'offset' || total === undefined) return undefined
  const nextOffset = (currentRequest.offset ?? FIRST_OFFSET) + pageSize
  if (nextOffset >= total) return undefined
  return { limit: pageSize, offset: nextOffset }
}
