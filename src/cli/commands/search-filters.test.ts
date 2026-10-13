import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { UsageError } from '../../core/provider/errors.ts'
import { findSearchFilters, validateSearchFilters } from './search-filters.ts'
import { SPOTIFY_API_CAPABILITIES } from '../../provider/spotify/api-capabilities.ts'

describe('search field filters', () => {
  it('finds combined filters including quoted values', () => {
    assert.deepEqual(findSearchFilters('love Artist:"The Beatles" album:Help year:1965-1970'), [
      { field: 'artist', value: 'The Beatles' },
      { field: 'album', value: 'Help' },
      { field: 'year', value: '1965-1970' }
    ])
  })

  it('ignores unknown prefixes and mid-word colons', () => {
    assert.deepEqual(findSearchFilters('genre:rock a-artist:x'), [])
  })

  it('accepts combined Spotify filters', () => {
    validateSearchFilters('artist:Queen album:"A Night" year:1975', 'Spotify', SPOTIFY_API_CAPABILITIES)
  })

  it('rejects isrc: with a capability-checked message', () => {
    assert.throws(
      () => { validateSearchFilters('isrc:USRC17607839', 'Spotify', SPOTIFY_API_CAPABILITIES) },
      (error) => error instanceof UsageError && error.message.includes('isrc: is not supported by Spotify')
    )
  })

  it('allows isrc: when the provider has an ISRC filter', () => {
    validateSearchFilters('isrc:USRC17607839', 'X', { searchFieldFilters: [], isrcSearchMode: 'filter' })
  })

  it('rejects filters the provider does not declare', () => {
    assert.throws(
      () => { validateSearchFilters('year:2020', 'X', { searchFieldFilters: ['artist'], isrcSearchMode: 'none' }) },
      UsageError
    )
  })

  it('rejects empty and malformed values', () => {
    assert.throws(() => { validateSearchFilters('artist:', 'Spotify', SPOTIFY_API_CAPABILITIES) }, UsageError)
    assert.throws(() => { validateSearchFilters('year:abc', 'Spotify', SPOTIFY_API_CAPABILITIES) }, UsageError)
  })
})
