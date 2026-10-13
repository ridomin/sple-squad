import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import { createFakeProvider } from '../../core/provider/fake/fake-provider.ts'
import type { Provider } from '../../core/provider/provider.ts'
import { runCli, type CliIO } from '../framework.ts'
import { EXIT_CODES } from '../exit-codes.ts'
import { getRegisteredCommands } from '../registry.ts'
import { createPlaylistEditCommand } from './playlist-edit.ts'
import { resolvePlaylist } from './playlist.ts'
import '../index.ts'

class Capture extends Writable {
  text = ''
  override _write (chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.text += chunk.toString()
    callback()
  }
}

function createIO (): CliIO & { stdout: Capture, stderr: Capture } {
  return {
    stdin: new PassThrough(),
    stdout: new Capture(),
    stderr: new Capture(),
    stdoutIsTTY: false,
    stderrIsTTY: false,
    stdinIsTTY: false
  }
}

async function invoke (argv: string[], provider: Provider): Promise<{ exitCode: number, io: ReturnType<typeof createIO> }> {
  const io = createIO()
  const exitCode = await runCli(argv, {
    commands: [createPlaylistEditCommand({ resolvePlaylist, getProvider: () => provider })],
    io,
    processEnv: { SPLE_ENABLE_FAKE_PROVIDER: '1' }
  })
  return { exitCode, io }
}

function createProvider (): Provider {
  const owner = { id: 'me', displayName: 'Me' }
  return createFakeProvider({
    fixtures: {
      catalog: [],
      playlists: [
        { id: '1', name: 'Road Trip', description: 'old', public: false, owner, trackIds: [] },
        { id: '2', name: 'Dup', owner, trackIds: [] },
        { id: '3', name: 'Dup', owner, trackIds: [] },
        { id: '4', name: 'Theirs', owned: false, itemsReadable: true, owner: { id: 'other' }, trackIds: [] }
      ]
    }
  })
}

describe('playlist edit command', () => {
  it('is registered in the production CLI', () => {
    assert.ok(getRegisteredCommands().some(command => command.path.join(' ') === 'playlist edit'))
  })

  it('updates name, description and visibility', async () => {
    const provider = createProvider()
    const { exitCode, io } = await invoke(
      ['playlist', 'edit', 'Road Trip', '--name', 'Highway', '--description', 'new', '--public', '--json'],
      provider
    )
    assert.equal(exitCode, EXIT_CODES.success)
    assert.deepEqual(JSON.parse(io.stdout.text), {
      dryRun: false,
      playlist: { id: '1', ref: '1', name: 'Highway' },
      changes: { name: 'Highway', description: 'new', public: true }
    })
    const updated = await provider.getPlaylist('1')
    assert.equal(updated.name, 'Highway')
    assert.equal(updated.description, 'new')
    assert.equal(updated.public, true)
  })

  it('--private sets visibility to private and resolves by id', async () => {
    const provider = createProvider()
    const { exitCode } = await invoke(['playlist', 'edit', '1', '--private'], provider)
    assert.equal(exitCode, EXIT_CODES.success)
    assert.equal((await provider.getPlaylist('1')).public, false)
  })

  it('--dry-run changes nothing', async () => {
    const provider = createProvider()
    const { exitCode, io } = await invoke(['playlist', 'edit', 'Road Trip', '--name', 'X', '--dry-run'], provider)
    assert.equal(exitCode, EXIT_CODES.success)
    assert.match(io.stderr.text, /\[dry-run\] Would update playlist "Road Trip"/v)
    assert.equal((await provider.getPlaylist('1')).name, 'Road Trip')
  })

  it('exits 2 on an ambiguous name', async () => {
    const { exitCode, io } = await invoke(['playlist', 'edit', 'Dup', '--name', 'X'], createProvider())
    assert.equal(exitCode, EXIT_CODES.usage)
    assert.match(io.stderr.text, /Ambiguous playlist name "Dup"/v)
  })

  it('rejects no changes, conflicting visibility, and playlists you do not own', async () => {
    const provider = createProvider()
    const none = await invoke(['playlist', 'edit', '1'], provider)
    assert.equal(none.exitCode, EXIT_CODES.usage)
    assert.match(none.io.stderr.text, /requires at least one of/v)
    const both = await invoke(['playlist', 'edit', '1', '--public', '--private'], provider)
    assert.equal(both.exitCode, EXIT_CODES.usage)
    const notOwned = await invoke(['playlist', 'edit', '4', '--name', 'X'], provider)
    assert.equal(notOwned.exitCode, EXIT_CODES.usage)
    assert.match(notOwned.io.stderr.text, /not owned by you/v)
  })

  it('degrades with a clear message when the provider cannot update playlists', async () => {
    const provider = createProvider()
    delete (provider as { updatePlaylist?: unknown }).updatePlaylist
    const { exitCode, io } = await invoke(['playlist', 'edit', '1', '--name', 'X'], provider)
    assert.equal(exitCode, EXIT_CODES.usage)
    assert.match(io.stderr.text, /does not support editing playlists/v)
  })
})
