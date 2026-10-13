import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeProvider } from '../../core/provider/fake/fake-provider.ts'
import type { Provider } from '../../core/provider/provider.ts'
import { createSpotifyProvider } from '../../provider/spotify/provider.ts'
import { EXIT_CODES } from '../exit-codes.ts'
import { createPlaylistEditCommand } from './playlist-edit.ts'
import { resolvePlaylist } from './playlist.ts'
import { parseJsonRecord, runCommands } from './fixtures/m2/harness.ts'
import { MULTI_PLAYLIST_LIBRARY } from './fixtures/m2/library.ts'

type Patch = Parameters<NonNullable<Provider['updatePlaylist']>>[1]

function spiedProvider (): { provider: Provider, updates: Array<{ ref: string, patch: Patch }> } {
  const provider = createFakeProvider({ fixtures: MULTI_PLAYLIST_LIBRARY })
  const updates: Array<{ ref: string, patch: Patch }> = []
  const { updatePlaylist } = provider
  assert.ok(updatePlaylist !== undefined)
  provider.updatePlaylist = async (ref, patch) => {
    updates.push({ ref, patch })
    return await updatePlaylist(ref, patch)
  }
  return { provider, updates }
}

async function edit (provider: Provider, args: string[], stdinText?: string): ReturnType<typeof runCommands> {
  const command = createPlaylistEditCommand({ resolvePlaylist, getProvider: () => provider })
  return await runCommands([command], ['playlist', 'edit', ...args], stdinText === undefined ? {} : { stdinText })
}

describe('M2 regression: playlist edit', () => {
  it('sends the provider exactly the requested fields and nothing else', async () => {
    const { provider, updates } = spiedProvider()
    await edit(provider, ['1', '--description', 'only this'])
    await edit(provider, ['1', '--private'])
    assert.deepEqual(updates, [
      { ref: '1', patch: { description: 'only this' } },
      { ref: '1', patch: { public: false } }
    ])
  })

  it('an empty --description clears the description, whereas an empty --name is rejected', async () => {
    const { provider, updates } = spiedProvider()
    const cleared = await edit(provider, ['2', '--description', ''])
    assert.equal(cleared.code, EXIT_CODES.success, cleared.io.stderr.text)
    assert.deepEqual(updates, [{ ref: '2', patch: { description: '' } }])
    assert.equal((await provider.getPlaylist('2')).description, '')

    for (const name of ['', '   ']) {
      // eslint-disable-next-line no-await-in-loop -- sequential cases keep failures attributable
      const rejected = await edit(provider, ['2', '--name', name])
      assert.equal(rejected.code, EXIT_CODES.usage)
    }
    assert.equal(updates.length, 1, 'rejected names must not reach the provider')
    assert.equal((await provider.getPlaylist('2')).name, 'Chill')
  })

  it('--dry-run never calls the provider update, in any output mode, yet reports the planned change', async () => {
    const { provider, updates } = spiedProvider()
    for (const mode of [[], ['--json'], ['--quiet']]) {
      // eslint-disable-next-line no-await-in-loop -- sequential cases keep failures attributable
      const { code, io } = await edit(provider, ['1', '--name', 'Renamed', '--dry-run', ...mode])
      assert.equal(code, EXIT_CODES.success, `${mode.join(' ')}: ${io.stderr.text}`)
      assert.match(io.stdout.text + io.stderr.text, /Café Mix|^1$/mv)
    }
    assert.deepEqual(updates, [])
    assert.equal((await provider.getPlaylist('1')).name, 'Café Mix')
    const json = await edit(provider, ['1', '--name', 'Renamed', '--dry-run', '--json'])
    assert.deepEqual(parseJsonRecord(json.io.stdout.text), {
      dryRun: true,
      playlist: { id: '1', ref: '1', name: 'Café Mix' },
      changes: { name: 'Renamed' }
    })
  })

  it('refuses playlists the user does not own — even readable ones — without calling the provider', async () => {
    const { provider, updates } = spiedProvider()
    for (const id of ['6', '7']) {
      // eslint-disable-next-line no-await-in-loop -- sequential cases keep failures attributable
      const { code, io } = await edit(provider, [id, '--name', 'Mine now'])
      assert.equal(code, EXIT_CODES.usage)
      assert.match(io.stderr.text, /not owned by you/v)
    }
    assert.deepEqual(updates, [])
  })

  it('reads the playlist from stdin when given "-"', async () => {
    const { provider, updates } = spiedProvider()
    const { code, io } = await edit(provider, ['-', '--name', 'From Pipe'], '4\n')
    assert.equal(code, EXIT_CODES.success, io.stderr.text)
    assert.deepEqual(updates, [{ ref: '4', patch: { name: 'From Pipe' } }])
  })

  it('validates flags before resolving the playlist (no provider lookups on bad input)', async () => {
    const { provider } = spiedProvider()
    let lookups = 0
    const original = provider.listPlaylists.bind(provider)
    provider.listPlaylists = async (...args) => {
      lookups += 1
      return await original(...args)
    }
    const { code } = await edit(provider, ['Chill', '--public', '--private'])
    assert.equal(code, EXIT_CODES.usage)
    assert.equal(lookups, 0)
  })

  it('capability gating: a provider without updatePlaylist fails even on --dry-run, naming the provider', async () => {
    const provider = createFakeProvider({ fixtures: MULTI_PLAYLIST_LIBRARY, displayName: 'ReadOnlyTunes' })
    delete (provider as { updatePlaylist?: unknown }).updatePlaylist
    const { code, io } = await edit(provider, ['1', '--name', 'X', '--dry-run'])
    assert.equal(code, EXIT_CODES.usage)
    assert.match(io.stderr.text, /ReadOnlyTunes does not support editing playlists/v)
    assert.equal(io.stdout.text, '')
  })

  it('capability gating: the Spotify provider (until its edit adapter lands) is refused cleanly, not with a crash', async () => {
    const spotify = createSpotifyProvider({ clientId: 'test-client' })
    const { code, io } = await edit(spotify, ['1', '--name', 'X'])
    if (spotify.updatePlaylist === undefined) {
      assert.equal(code, EXIT_CODES.usage)
      assert.match(io.stderr.text, /Spotify does not support editing playlists/v)
    } else {
      assert.notEqual(code, EXIT_CODES.success, 'unauthenticated Spotify cannot succeed')
    }
  })
})
