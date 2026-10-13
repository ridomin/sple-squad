import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeProvider } from '../../core/provider/fake/fake-provider.ts'
import { createSpotifyProvider } from '../../provider/spotify/provider.ts'
import { SPOTIFY_API_CAPABILITIES } from '../../provider/spotify/api-capabilities.ts'
import { EXIT_CODES } from '../exit-codes.ts'
import { createSearchCommand } from './search.ts'
import { runCommands } from './fixtures/m2/harness.ts'
import { SEARCH_FILTER_CASES } from './fixtures/m2/search-queries.ts'

describe('M2 regression: search field filters (FR-SEARCH-3)', () => {
  for (const testCase of SEARCH_FILTER_CASES) {
    it(testCase.name, async () => {
      const provider = createFakeProvider({ capabilities: testCase.capabilities })
      const queries: string[] = []
      provider.search = async (query) => {
        queries.push(query.text)
        return await Promise.resolve({ items: [] })
      }
      const { code, io } = await runCommands([createSearchCommand(() => provider)], testCase.argv)

      if (testCase.forwardedText === undefined) {
        assert.equal(code, EXIT_CODES.usage, io.stderr.text)
        assert.match(io.stderr.text, testCase.error ?? /./v)
        assert.deepEqual(queries, [], 'an invalid filter must never reach the provider')
      } else {
        assert.equal(code, EXIT_CODES.success, io.stderr.text)
        assert.deepEqual(queries, [testCase.forwardedText])
      }
    })
  }

  it('validates filters on every page of --all, not just the first search call', async () => {
    const provider = createFakeProvider({ capabilities: { searchFieldFilters: ['artist'] } })
    const seen: string[] = []
    provider.search = async (query) => {
      seen.push(query.text)
      return await Promise.resolve({ items: [] })
    }
    const { code } = await runCommands([createSearchCommand(() => provider)], ['search', 'artist:Queen', '--all'])
    assert.equal(code, EXIT_CODES.success)
    assert.ok(seen.every(text => text === 'artist:Queen'))
  })

  it('declares the same filter set on the account provider as on the API operations layer', () => {
    const spotify = createSpotifyProvider({ clientId: 'test-client' })
    assert.deepEqual(spotify.capabilities.searchFieldFilters, SPOTIFY_API_CAPABILITIES.searchFieldFilters)
    assert.equal(spotify.capabilities.isrcSearchMode, SPOTIFY_API_CAPABILITIES.isrcSearchMode)
  })

  it('rejects isrc: through the real Spotify capabilities before any network call', async () => {
    const spotify = createSpotifyProvider({ clientId: 'test-client' })
    const { code, io } = await runCommands([createSearchCommand(() => spotify)], ['search', 'isrc:USRC17607839'])
    assert.equal(code, EXIT_CODES.usage)
    assert.match(io.stderr.text, /isrc: is not supported by Spotify/v)
  })
})
