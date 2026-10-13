import type { ProviderCapabilities } from '../../../../core/provider/capabilities.ts'

export interface SearchFilterCase {
  name: string
  argv: string[]
  capabilities: Partial<ProviderCapabilities>
  /** `undefined` => the provider must not be searched and the CLI exits 2 with `error` in stderr. */
  forwardedText?: string
  error?: RegExp
}

const ALL_FILTERS: Partial<ProviderCapabilities> = { searchFieldFilters: ['artist', 'album', 'year'] }

export const SEARCH_FILTER_CASES: SearchFilterCase[] = [
  { name: 'filters are matched case-insensitively', argv: ['search', 'ARTIST:Queen'], capabilities: ALL_FILTERS, forwardedText: 'ARTIST:Queen' },
  { name: 'quoted values keep spaces and reach the provider verbatim', argv: ['search', 'album:"A Night At The Opera"', 'year:1975'], capabilities: ALL_FILTERS, forwardedText: 'album:"A Night At The Opera" year:1975' },
  { name: 'year ranges are accepted', argv: ['search', 'year:2019-2021'], capabilities: ALL_FILTERS, forwardedText: 'year:2019-2021' },
  { name: 'open-ended year range is rejected', argv: ['search', 'year:2019-'], capabilities: ALL_FILTERS, error: /year: must be a year/v },
  { name: 'two-digit year is rejected', argv: ['search', 'year:75'], capabilities: ALL_FILTERS, error: /year: must be a year/v },
  { name: 'empty quoted value is rejected', argv: ['search', 'artist:""'], capabilities: ALL_FILTERS, error: /artist: needs a value/v },
  { name: 'filter with no value is rejected', argv: ['search', 'love', 'album:'], capabilities: ALL_FILTERS, error: /album: needs a value/v },
  { name: 'an unsupported filter anywhere in the query is rejected', argv: ['search', 'artist:Queen', 'year:1975'], capabilities: { searchFieldFilters: ['artist'] }, error: /year: is not supported by Fake/v },
  { name: 'a provider with no filters rejects even artist:', argv: ['search', 'artist:Queen'], capabilities: { searchFieldFilters: [] }, error: /artist: is not supported by Fake/v },
  { name: 'isrc: is rejected for lookup-only providers', argv: ['search', 'isrc:USRC17607839'], capabilities: { ...ALL_FILTERS, isrcSearchMode: 'lookup' }, error: /isrc: is not supported/v },
  { name: 'isrc: is forwarded when the provider has an ISRC filter', argv: ['search', 'isrc:USRC17607839'], capabilities: { isrcSearchMode: 'filter' }, forwardedText: 'isrc:USRC17607839' },
  { name: 'unknown prefixes are plain text, not filters', argv: ['search', 'genre:rock'], capabilities: { searchFieldFilters: [] }, forwardedText: 'genre:rock' },
  { name: 'colons inside words and URLs are plain text', argv: ['search', 'https://example.com', 'AC:DC', 'x-artist:y'], capabilities: { searchFieldFilters: [] }, forwardedText: 'https://example.com AC:DC x-artist:y' },
  { name: 'filters combine with --type and --limit', argv: ['search', 'artist:Queen', '--type', 'album', '--limit', '5'], capabilities: ALL_FILTERS, forwardedText: 'artist:Queen' }
]
