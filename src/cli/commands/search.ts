import type { CommandContext, CommandDefinition } from '../args.ts'
import type { OutputColumn } from '../output.ts'
import { formatOutput } from '../output.ts'
import type { PageRequest, Provider, SearchItem, SearchType } from '../../core/provider/provider.ts'
import { UsageError } from '../../core/provider/errors.ts'
import { getRegisteredProviders } from '../../provider/registry.ts'
import type { SearchOutput } from '../output/types.ts'
import { writeCliMessage } from '../messages.ts'

const DEFAULT_LIMIT = 10
const DEFAULT_MAX_RESULTS = 100
const MAX_RESULTS_LIMIT = 1000
const EMPTY_COUNT = 0
const MINIMUM_LIMIT = 1
const FIRST_RESULT = 0
const DURATION_SECOND_WIDTH = 2
const SECONDS_PER_MINUTE = 60
const MILLISECONDS_PER_SECOND = 1000

const SEARCH_TYPES: SearchType[] = ['track', 'album', 'artist', 'playlist']

interface SearchOptions {
  type: SearchType
  limit?: number
  offset?: number
  all: boolean
  maxResults?: number
}

export type SearchProviderResolver = (context: CommandContext) => Provider

export function createSearchCommand (
  resolveProvider: SearchProviderResolver = resolveRegisteredProvider
): CommandDefinition {
  return {
    path: ['search'],
    description: 'Search the provider catalog',
    helpText: 'Usage: sple search <query…> [--type track|album|artist|playlist] [--limit N] [--offset N | --all [--max-results N]]',
    options: {
      type: { type: 'string' },
      limit: { type: 'string' },
      offset: { type: 'string' },
      all: { type: 'boolean' },
      'max-results': { type: 'string' }
    },
    run: async (context) => {
      await runSearch(context, resolveProvider)
    }
  }
}

async function runSearch (
  context: CommandContext,
  resolveProvider: SearchProviderResolver
): Promise<void> {
  const { positionals, stderr, outputMode, stdout, stdoutIsTTY } = context
  const query = positionals.join(' ').trim()
  if (query.length === EMPTY_COUNT) throw new UsageError('search query must not be empty')

  const options = parseSearchOptions(context)
  const provider = resolveProvider(context)
  if (options.offset !== undefined &&
      options.offset > EMPTY_COUNT &&
      provider.capabilities.paginationModel !== 'offset') {
    throw new UsageError(`--offset is not supported by ${provider.displayName} (no offset pagination)`)
  }

  const result = await search(provider, query, options)
  if (result.items.length === EMPTY_COUNT) {
    writeCliMessage(stderr, `No results for "${query}" in ${provider.displayName}`)
    return
  }

  const columns = getColumns(options.type)
  const rows = result.items.map(item => toRow(item, options.type))
  stdout.write(formatOutput({
    mode: outputMode,
    value: result,
    columns,
    rows,
    quietIds: result.items.map(item => item.id),
    outputOptions: { stdoutIsTTY }
  }))
}

function parseSearchOptions (context: CommandContext): SearchOptions {
  const { flags } = context
  const { type: typeValue } = flags
  const type = typeValue ?? 'track'
  if (!isSearchType(type)) {
    throw new UsageError('--type must be one of: track, album, artist, playlist')
  }

  const { limit: limitValue, offset: offsetValue, all: allValue } = flags
  const limitWasSet = limitValue !== undefined
  const offsetWasSet = offsetValue !== undefined
  const all = allValue === true
  const limit = parseIntegerFlag(limitValue, '--limit', DEFAULT_LIMIT, MINIMUM_LIMIT)
  const offset = parseIntegerFlag(offsetValue, '--offset', EMPTY_COUNT, EMPTY_COUNT)
  const { 'max-results': maxResultsValue } = flags
  const maxResults = maxResultsValue === undefined
    ? undefined
    : parseIntegerFlag(maxResultsValue, '--max-results', DEFAULT_MAX_RESULTS, MINIMUM_LIMIT)

  validateSearchFlags({ all, limitWasSet, offsetWasSet, maxResults, limit, offset })

  return {
    type,
    ...(limitWasSet ? { limit } : {}),
    ...(offsetWasSet ? { offset } : {}),
    all,
    ...(maxResults === undefined ? {} : { maxResults })
  }
}

function validateSearchFlags (options: {
  all: boolean
  limitWasSet: boolean
  offsetWasSet: boolean
  maxResults: number | undefined
  limit: number
  offset: number
}): void {
  const { all, limitWasSet, offsetWasSet, maxResults, limit, offset } = options
  if (all) validateAllSearchFlags(limitWasSet, offsetWasSet, maxResults)
  else validateLimitedSearchFlags(maxResults, offset, limit)
}

function validateAllSearchFlags (
  limitWasSet: boolean,
  offsetWasSet: boolean,
  maxResults: number | undefined
): void {
  if (limitWasSet || offsetWasSet) {
    throw new UsageError('--all cannot be combined with --limit or --offset')
  }
  if (maxResults !== undefined && maxResults > MAX_RESULTS_LIMIT) {
    throw new UsageError(`--max-results must not exceed ${MAX_RESULTS_LIMIT}`)
  }
}

function validateLimitedSearchFlags (
  maxResults: number | undefined,
  offset: number,
  limit: number
): void {
  if (maxResults !== undefined) throw new UsageError('--max-results requires --all')
  if (offset + limit > MAX_RESULTS_LIMIT) {
    throw new UsageError(`--offset + --limit must not exceed ${MAX_RESULTS_LIMIT}`)
  }
}

function isSearchType (value: unknown): value is SearchType {
  return typeof value === 'string' && SEARCH_TYPES.some(type => type === value)
}

function parseIntegerFlag (
  value: string | boolean | undefined,
  name: string,
  defaultValue: number,
  minimum: number
): number {
  if (value === undefined) return defaultValue
  if (typeof value !== 'string' || !/^\d+$/v.test(value)) {
    throw new UsageError(`${name} must be an integer greater than or equal to ${minimum}`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new UsageError(`${name} must be an integer greater than or equal to ${minimum}`)
  }
  return parsed
}

// Its branches encode the two pagination models and the 1000-result safety cap.
// eslint-disable-next-line complexity -- Keep the page/cap behavior together for review.
async function search (
  provider: Provider,
  query: string,
  options: SearchOptions
): Promise<SearchOutput> {
  const { capabilities } = provider
  const { maxSearchPageSize, paginationModel } = capabilities
  if (!Number.isSafeInteger(maxSearchPageSize) || maxSearchPageSize < MINIMUM_LIMIT) {
    throw new Error(`Invalid maxSearchPageSize capability from ${provider.displayName}`)
  }

  const resultLimit = options.all
    ? options.maxResults ?? DEFAULT_MAX_RESULTS
    : options.limit ?? DEFAULT_LIMIT
  const initialOffset = options.offset ?? EMPTY_COUNT
  const items: SearchItem[] = []
  let total: number | undefined = undefined
  let cursor: string | undefined = undefined
  let currentOffset = initialOffset
  let nextCursor: string | undefined = undefined
  let nextOffset: number | undefined = undefined
  let providerHasMore = false

  while (items.length < resultLimit) {
    const pageLimit = Math.min(maxSearchPageSize, resultLimit - items.length)
    const pageOffset = currentOffset
    const request = createPageRequest(paginationModel, pageLimit, pageOffset, cursor)
    // The next-page position comes from the preceding response.
    // eslint-disable-next-line no-await-in-loop -- Page tokens require sequential requests.
    const page = await requestPage(provider, query, options.type, request)
    const { items: pageItems, next, total: pageTotal } = page
    const { length: pageItemCount } = pageItems
    if (total === undefined && pageTotal !== undefined) total = pageTotal
    items.push(...pageItems.slice(FIRST_RESULT, resultLimit - items.length))
    providerHasMore = next !== undefined
    if (next === undefined || pageItemCount === EMPTY_COUNT) break

    if (items.length >= resultLimit) {
      if (paginationModel === 'offset') {
        const candidateOffset = next.offset ?? (pageOffset + pageItemCount)
        if (candidateOffset < MAX_RESULTS_LIMIT) nextOffset = candidateOffset
      } else {
        const { cursor: pageCursor } = next
        nextCursor = pageCursor
      }
      break
    }

    if (paginationModel === 'offset') {
      const { offset: providerOffset } = next
      const nextPageOffset = providerOffset ?? (pageOffset + pageItemCount)
      if (nextPageOffset <= pageOffset) break
      currentOffset = nextPageOffset
    } else {
      const { cursor: pageCursor } = next
      if (pageCursor === undefined || pageCursor === cursor) break
      cursor = pageCursor
    }
  }

  return {
    items,
    ...(total === undefined ? {} : { total }),
    ...(providerHasMore && nextOffset !== undefined ? { next: { offset: nextOffset } } : {}),
    ...(providerHasMore && nextCursor !== undefined ? { next: { cursor: nextCursor } } : {})
  }
}

function createPageRequest (
  paginationModel: Provider['capabilities']['paginationModel'],
  limit: number,
  offset: number,
  cursor: string | undefined
): PageRequest {
  return paginationModel === 'offset'
    ? { limit, offset }
    : { limit, ...(cursor === undefined ? {} : { cursor }) }
}

async function requestPage (
  provider: Provider,
  query: string,
  type: SearchType,
  request: PageRequest
): ReturnType<Provider['search']> {
  return await provider.search({ text: query, type }, request)
}

function resolveRegisteredProvider (context: CommandContext): Provider {
  const provider = getRegisteredProviders({ config: context.config })
    .find(candidate => candidate.id === context.provider)
  if (provider === undefined) {
    throw new UsageError(`Provider '${context.provider}' is not registered`)
  }
  return provider
}

function getColumns (type: SearchType): OutputColumn[] {
  switch (type) {
    case 'track':
      return [
        { key: 'title', label: 'title', flexible: true },
        { key: 'artists', label: 'artists', flexible: true },
        { key: 'album', label: 'album', flexible: true },
        { key: 'duration', label: 'duration' },
        { key: 'id', label: 'id' }
      ]
    case 'album':
      return [
        { key: 'name', label: 'name', flexible: true },
        { key: 'artists', label: 'artists', flexible: true },
        { key: 'released', label: 'released' },
        { key: 'tracks', label: 'tracks' },
        { key: 'id', label: 'id' }
      ]
    case 'artist':
      return [
        { key: 'name', label: 'name', flexible: true },
        { key: 'id', label: 'id' }
      ]
    case 'playlist':
      return [
        { key: 'name', label: 'name', flexible: true },
        { key: 'owner', label: 'owner', flexible: true },
        { key: 'tracks', label: 'tracks' },
        { key: 'id', label: 'id' }
      ]
  }
}

function toRow (item: SearchItem, type: SearchType): Record<string, unknown> {
  if (type === 'track' && item.type === 'track') {
    return {
      title: item.track.title,
      artists: item.track.artists,
      album: item.track.album,
      duration: formatDuration(item.track.durationMs),
      id: item.id
    }
  }
  if (type === 'album' && item.type === 'album') {
    return {
      name: item.name,
      artists: item.artists,
      released: item.releaseDate,
      tracks: item.trackCount,
      id: item.id
    }
  }
  if (type === 'artist' && item.type === 'artist') {
    return { name: item.name, id: item.id }
  }
  if (type === 'playlist' && item.type === 'playlist') {
    return {
      name: item.name,
      owner: item.owner.displayName ?? item.owner.id,
      tracks: item.trackCount,
      id: item.id
    }
  }
  throw new Error(`Provider returned a ${item.type} item for a ${type} search`)
}

function formatDuration (durationMs: number | undefined): string | undefined {
  if (durationMs === undefined) return undefined
  const totalSeconds = Math.floor(durationMs / MILLISECONDS_PER_SECOND)
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE)
  const seconds = totalSeconds % SECONDS_PER_MINUTE
  return `${minutes}:${seconds.toString().padStart(DURATION_SECOND_WIDTH, '0')}`
}
