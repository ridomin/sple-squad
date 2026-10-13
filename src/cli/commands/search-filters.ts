import type { ProviderCapabilities } from '../../core/provider/capabilities.ts'
import { UsageError } from '../../core/provider/errors.ts'

const FILTER_PATTERN = /(?<=^|\s)(?<field>artist|album|year|isrc):(?<value>"[^"]*"|\S*)/giv
const YEAR_PATTERN = /^\d{4}(?:-\d{4})?$/v
const EMPTY_COUNT = 0

/** Field filters (`artist:`, `album:`, `year:`, `isrc:`) found in a search query, in order of appearance. */
export function findSearchFilters (query: string): Array<{ field: string, value: string }> {
  return Array.from(query.matchAll(FILTER_PATTERN), (match) => {
    const { field = '', value = '' } = match.groups ?? {}
    return { field: field.toLowerCase(), value: value.replace(/^"|"$/gv, '').trim() }
  })
}

/**
 * Checks every field filter in the query against the provider's capabilities.
 * The query text itself is passed through unchanged: providers with native filters parse it.
 */
export function validateSearchFilters (
  query: string,
  displayName: string,
  capabilities: Pick<ProviderCapabilities, 'searchFieldFilters' | 'isrcSearchMode'>
): void {
  for (const { field, value } of findSearchFilters(query)) {
    if (field === 'isrc') {
      if (capabilities.isrcSearchMode !== 'filter') {
        throw new UsageError(`isrc: is not supported by ${displayName} (ISRC search is not available)`)
      }
    } else if (!capabilities.searchFieldFilters.some(supported => supported === field)) {
      throw new UsageError(`${field}: is not supported by ${displayName}`)
    }
    if (value.length === EMPTY_COUNT) throw new UsageError(`${field}: needs a value`)
    if (field === 'year' && !YEAR_PATTERN.test(value)) {
      throw new UsageError('year: must be a year (2020) or a range (2019-2021)')
    }
  }
}
