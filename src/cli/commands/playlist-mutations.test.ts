import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import { createFakeProvider } from '../../core/provider/fake/fake-provider.ts'
import { NotFoundError } from '../../core/provider/errors.ts'
import type { Provider } from '../../core/provider/provider.ts'
import { runCli } from '../framework.ts'
import type { CliIO } from '../framework.ts'
import { getRegisteredCommands } from '../registry.ts'
import { EXIT_CODES } from '../exit-codes.ts'
import {
  createPlaylistCreateCommand,
  createPlaylistMutationCommands,
  type PlaylistConfirmation,
  type PlaylistResolver
} from './playlist-mutations.ts'
import { resolvePlaylist } from './playlist.ts'
import '../index.ts'

class CaptureWritable extends Writable {
  readonly chunks: string[] = []

  override _write (chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString())
    callback()
  }

  get text (): string {
    return this.chunks.join('')
  }
}

function createIO (options: { stdoutIsTTY?: boolean, stdinIsTTY?: boolean } = {}): CliIO & {
  stdin: PassThrough
  stdout: CaptureWritable
  stderr: CaptureWritable
} {
  return {
    stdin: new PassThrough(),
    stdout: new CaptureWritable(),
    stderr: new CaptureWritable(),
    stdoutIsTTY: options.stdoutIsTTY ?? false,
    stderrIsTTY: false,
    stdinIsTTY: options.stdinIsTTY ?? false
  }
}

function createResolver (): PlaylistResolver {
  return resolvePlaylist
}

async function invoke (
  argv: string[],
  provider: Provider,
  io = createIO(),
  options: {
    resolvePlaylist?: PlaylistResolver
    confirm?: PlaylistConfirmation
  } = {}
): Promise<{ exitCode: number, io: ReturnType<typeof createIO> }> {
  const dependencies = {
    resolvePlaylist: options.resolvePlaylist ?? createResolver(),
    getProvider: () => provider,
    ...(options.confirm === undefined ? {} : { confirm: options.confirm })
  }
  const commands = createPlaylistMutationCommands(dependencies)
  const exitCode = await runCli(argv, {
    commands,
    io,
    processEnv: { SPLE_ENABLE_FAKE_PROVIDER: '1' }
  })
  return { exitCode, io }
}

describe('playlist mutation command definitions', () => {
  it('exposes create and remove commands without registering them globally', () => {
    assert.deepEqual(createPlaylistCreateCommand().path, ['playlist', 'create'])
    const provider = createFakeProvider()
    const commands = createPlaylistMutationCommands({ resolvePlaylist: createResolver() })
    assert.deepEqual(commands.map(command => command.path), [
      ['playlist', 'create'],
      ['playlist', 'remove']
    ])
    assert.equal(provider.id, 'fake')
  })

  it('registers both mutation commands in the production CLI', () => {
    const paths = getRegisteredCommands().map(command => command.path)
    assert.ok(paths.some(path => path[0] === 'playlist' && path[1] === 'create'))
    assert.ok(paths.some(path => path[0] === 'playlist' && path[1] === 'remove'))
  })
})

describe('playlist create', () => {
  it('creates private by default using only the Provider interface', async () => {
    const provider = createFakeProvider()
    const { exitCode, io } = await invoke(
      ['playlist', 'create', 'My playlist', '--json'],
      provider
    )
    assert.equal(exitCode, EXIT_CODES.success)
    assert.deepEqual(JSON.parse(io.stdout.text), {
      dryRun: false,
      id: '1',
      ref: '1',
      name: 'My playlist',
      owner: { id: 'fake-user', displayName: 'Fake User' },
      public: false,
      collaborative: false
    })
    const created = await provider.getPlaylist('1')
    assert.equal(created.public, false)
    assert.equal(io.stderr.text, '')
  })

  it('creates public playlists and forwards description', async () => {
    const provider = createFakeProvider()
    const { exitCode, io } = await invoke([
      'playlist', 'create', 'Public list',
      '--description', 'Shared songs',
      '--public',
      '--json'
    ], provider)
    assert.equal(exitCode, EXIT_CODES.success)
    assert.deepEqual(JSON.parse(io.stdout.text), {
      dryRun: false,
      id: '1',
      ref: '1',
      name: 'Public list',
      description: 'Shared songs',
      owner: { id: 'fake-user', displayName: 'Fake User' },
      public: true,
      collaborative: false
    })
  })

  it('supports collaborative playlists as private', async () => {
    const provider = createFakeProvider()
    const { exitCode, io } = await invoke(
      ['playlist', 'create', 'Shared list', '--collaborative', '--json'],
      provider
    )
    assert.equal(exitCode, EXIT_CODES.success)
    assert.deepEqual(JSON.parse(io.stdout.text), {
      dryRun: false,
      id: '1',
      ref: '1',
      name: 'Shared list',
      owner: { id: 'fake-user', displayName: 'Fake User' },
      public: false,
      collaborative: true
    })
    assert.equal((await provider.getPlaylist('1')).collaborative, true)
  })

  it('rejects collaborative on unsupported providers and public conflicts before mutation', async () => {
    const provider = createFakeProvider({ capabilities: { supportsCollaborative: false } })
    let createCalls = 0
    const { createPlaylist: originalCreate } = provider
    provider.createPlaylist = async input => {
      createCalls += 1
      return await originalCreate(input)
    }
    const unsupported = await invoke(
      ['playlist', 'create', 'Shared', '--collaborative'],
      provider
    )
    assert.equal(unsupported.exitCode, EXIT_CODES.usage)
    assert.match(unsupported.io.stderr.text, /does not support collaborative playlists/v)
    assert.equal(createCalls, 0)

    const conflict = await invoke([
      'playlist', 'create', 'Shared', '--collaborative', '--public'
    ], provider)
    assert.equal(conflict.exitCode, EXIT_CODES.usage)
    assert.match(conflict.io.stderr.text, /cannot be combined with --public/v)
    assert.equal(createCalls, 0)
  })

  it('rejects conflicting visibility and invalid positional counts', async () => {
    const provider = createFakeProvider()
    const results = await Promise.all([
      ['playlist', 'create', 'List', '--public', '--private'],
      ['playlist', 'create'],
      ['playlist', 'create', 'List', 'Another']
    ].map(async args => await invoke(args, provider)))
    for (const result of results) {
      assert.equal(result.exitCode, EXIT_CODES.usage)
    }
    assert.deepEqual((await provider.listPlaylists({ limit: 10 })).items, [])
  })

  it('does not call the provider for a dry run and honors JSON, TSV, and quiet output', async () => {
    const provider = createFakeProvider()
    let createCalls = 0
    const { createPlaylist: originalCreate } = provider
    provider.createPlaylist = async input => {
      createCalls += 1
      return await originalCreate(input)
    }
    const json = await invoke([
      'playlist', 'create', 'Planned', '--dry-run', '--json'
    ], provider)
    assert.equal(json.exitCode, EXIT_CODES.success)
    assert.deepEqual(JSON.parse(json.io.stdout.text), {
      dryRun: true,
      name: 'Planned',
      public: false,
      collaborative: false
    })
    const tsv = await invoke([
      'playlist', 'create', 'Planned', '--dry-run'
    ], provider)
    assert.equal(tsv.io.stdout.text, '\tPlanned\t\n')
    assert.match(tsv.io.stderr.text, /\[dry-run\] Would create private playlist "Planned" in Fake Provider/v)
    const quiet = await invoke([
      'playlist', 'create', 'Planned', '--dry-run', '--quiet'
    ], provider)
    assert.equal(quiet.io.stdout.text, '')
    assert.equal(createCalls, 0)
  })

  it('prints the expected TTY and quiet single-result output', async () => {
    const provider = createFakeProvider()
    const table = await invoke(
      ['playlist', 'create', 'Readable', '--public'],
      provider,
      createIO({ stdoutIsTTY: true })
    )
    assert.match(table.io.stdout.text, /^Created public playlist "Readable" \(1\)/v)
    const quiet = await invoke(
      ['playlist', 'create', 'Quiet', '--quiet'],
      provider
    )
    assert.equal(quiet.io.stdout.text, '2\n')
  })
})

describe('playlist remove', () => {
  it('resolves through the injected resolver and removes with global --yes', async () => {
    const provider = createFakeProvider()
    const playlist = await provider.createPlaylist({ name: 'Remove me', public: false })
    let resolvedRef = ''
    let confirmationCalls = 0
    const result = await invoke(
      ['playlist', 'remove', 'a playlist name', '--yes', '--json'],
      provider,
      createIO(),
      {
        resolvePlaylist: async (activeProvider, ref) => {
          resolvedRef = ref
          return await activeProvider.getPlaylist(playlist.ref)
        },
        confirm: async () => {
          confirmationCalls += 1
          return await Promise.resolve(true)
        }
      }
    )
    assert.equal(result.exitCode, EXIT_CODES.success)
    assert.equal(resolvedRef, 'a playlist name')
    assert.equal(confirmationCalls, 0)
    assert.deepEqual(JSON.parse(result.io.stdout.text), {
      dryRun: false,
      action: 'deleted',
      playlist: { id: playlist.id, ref: playlist.ref, name: playlist.name }
    })
    await assert.rejects(async () => await provider.getPlaylist(playlist.ref), NotFoundError)
  })

  it('resolves a playlist name using the shared playlist resolver', async () => {
    const provider = createFakeProvider()
    const playlist = await provider.createPlaylist({ name: 'Named target', public: false })
    const result = await invoke(
      ['playlist', 'remove', playlist.name, '--yes', '--json'],
      provider
    )
    assert.equal(result.exitCode, EXIT_CODES.success)
    assert.deepEqual(JSON.parse(result.io.stdout.text), {
      dryRun: false,
      action: 'deleted',
      playlist: { id: playlist.id, ref: playlist.ref, name: playlist.name }
    })
    await assert.rejects(async () => await provider.getPlaylist(playlist.ref), NotFoundError)
  })

  it('rejects ambiguous playlist names with exit 2 and leaves matches unchanged', async () => {
    const provider = createFakeProvider()
    const first = await provider.createPlaylist({ name: 'Duplicate', public: false })
    const second = await provider.createPlaylist({ name: 'Duplicate', public: false })
    const result = await invoke(
      ['playlist', 'remove', 'Duplicate', '--yes'],
      provider
    )
    assert.equal(result.exitCode, EXIT_CODES.usage)
    assert.match(result.io.stderr.text, /Ambiguous playlist name "Duplicate"/v)
    assert.match(result.io.stderr.text, new RegExp(`id: ${first.id}`, 'v'))
    assert.match(result.io.stderr.text, new RegExp(`id: ${second.id}`, 'v'))
    await assert.doesNotReject(async () => await provider.getPlaylist(first.ref))
    await assert.doesNotReject(async () => await provider.getPlaylist(second.ref))
  })

  it('asks on a TTY and exits 1 without mutation when declined', async () => {
    const provider = createFakeProvider()
    const playlist = await provider.createPlaylist({ name: 'Keep me', public: false })
    let prompt = ''
    const result = await invoke(
      ['playlist', 'remove', playlist.ref, '--json'],
      provider,
      createIO({ stdoutIsTTY: true, stdinIsTTY: true }),
      {
        confirm: async (_context, confirmationPrompt) => {
          prompt = confirmationPrompt
          return await Promise.resolve(false)
        }
      }
    )
    assert.equal(result.exitCode, EXIT_CODES.error)
    assert.match(prompt, /^Delete playlist "Keep me" \(1\)\? \(y\/n\): $/v)
    assert.match(result.io.stderr.text, /permanently deletes the playlist/v)
    assert.match(result.io.stderr.text, /Aborted; nothing was changed/v)
    await assert.doesNotReject(async () => await provider.getPlaylist(playlist.ref))
  })

  it('rejects non-terminal confirmation before resolving or mutating', async () => {
    const provider = createFakeProvider()
    const playlist = await provider.createPlaylist({ name: 'No TTY', public: false })
    let resolveCalls = 0
    const result = await invoke(
      ['playlist', 'remove', playlist.ref],
      provider,
      createIO(),
      {
        resolvePlaylist: async activeProvider => {
          resolveCalls += 1
          return await activeProvider.getPlaylist(playlist.ref)
        }
      }
    )
    assert.equal(result.exitCode, EXIT_CODES.usage)
    assert.match(result.io.stderr.text, /requires --yes when stdin is not a terminal/v)
    assert.equal(resolveCalls, 0)
    await assert.doesNotReject(async () => await provider.getPlaylist(playlist.ref))
  })

  it('dry-runs without confirmation or mutation and reports the provider action', async () => {
    const provider = createFakeProvider({ capabilities: { canDeletePlaylist: false } })
    const playlist = await provider.createPlaylist({ name: 'Spotify style', public: false })
    let confirmationCalls = 0
    let removeCalls = 0
    const { removePlaylist: originalRemove } = provider
    provider.removePlaylist = async ref => {
      removeCalls += 1
      return await originalRemove(ref)
    }
    const result = await invoke(
      ['playlist', 'remove', playlist.ref, '--dry-run', '--json'],
      provider,
      createIO(),
      {
        confirm: async () => {
          confirmationCalls += 1
          return await Promise.resolve(true)
        }
      }
    )
    assert.equal(result.exitCode, EXIT_CODES.success)
    assert.deepEqual(JSON.parse(result.io.stdout.text), {
      dryRun: true,
      action: 'unfollowed',
      playlist: { id: playlist.id, ref: playlist.ref, name: playlist.name }
    })
    assert.match(result.io.stderr.text, /cannot delete playlists; this unfollows it/v)
    assert.equal(confirmationCalls, 0)
    assert.equal(removeCalls, 0)
    await assert.doesNotReject(async () => await provider.getPlaylist(playlist.ref))
  })

  it('dry-run TSV keeps real-run stdout and writes the Would sentence to stderr', async () => {
    const provider = createFakeProvider()
    const playlist = await provider.createPlaylist({ name: 'Doomed', public: false })
    const result = await invoke(['playlist', 'remove', playlist.ref, '--dry-run'], provider)
    assert.equal(result.exitCode, EXIT_CODES.success)
    assert.equal(result.io.stdout.text, `deleted\t${playlist.id}\tDoomed\n`)
    assert.match(result.io.stderr.text, /\[dry-run\] Would delete playlist "Doomed" \(.+\) in /v)
    await assert.doesNotReject(async () => await provider.getPlaylist(playlist.ref))
  })

  it('returns the provider-reported action for unfollow and supports table/TSV/quiet modes', async () => {
    const provider = createFakeProvider({ capabilities: { canDeletePlaylist: false } })
    const playlist = await provider.createPlaylist({ name: 'Followed', public: false })
    const tsv = await invoke(
      ['playlist', 'remove', playlist.ref, '--yes'],
      provider
    )
    assert.equal(tsv.exitCode, EXIT_CODES.success)
    assert.equal(tsv.io.stdout.text, `unfollowed\t${playlist.id}\tFollowed\n`)
    assert.match(tsv.io.stderr.text, /cannot delete playlists; this unfollows it/v)

    const second = await provider.createPlaylist({ name: 'Another', public: false })
    const table = await invoke(
      ['playlist', 'remove', second.ref, '--yes'],
      provider,
      createIO({ stdoutIsTTY: true })
    )
    assert.match(table.io.stdout.text, /^Unfollowed playlist "Another"/v)

    const third = await provider.createPlaylist({ name: 'Quiet', public: false })
    const quiet = await invoke(
      ['playlist', 'remove', third.ref, '--yes', '--quiet'],
      provider
    )
    assert.equal(quiet.io.stdout.text, `${third.id}\n`)
  })

  it('maps resolver and provider validation errors to the structured CLI error output', async () => {
    const provider = createFakeProvider()
    const result = await invoke(
      ['playlist', 'remove', 'missing', '--yes', '--json'],
      provider,
      createIO(),
      {
        resolvePlaylist: async () => await Promise.reject(new NotFoundError('playlist', 'missing'))
      }
    )
    assert.equal(result.exitCode, EXIT_CODES.notFound)
    assert.deepEqual(JSON.parse(result.io.stderr.text.trim().split('\n').at(-1) ?? ''), {
      error: {
        type: 'NotFoundError',
        message: 'playlist not found: missing',
        exitCode: EXIT_CODES.notFound
      }
    })

    const usage = await invoke(
      ['playlist', 'create', 'List', '--collaborative'],
      createFakeProvider({ capabilities: { supportsCollaborative: false } })
    )
    assert.equal(usage.exitCode, EXIT_CODES.usage)
  })
})
