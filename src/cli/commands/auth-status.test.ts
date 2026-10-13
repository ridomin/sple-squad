import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import {
  createAuthLogoutCommand,
  createAuthStatusCommand,
  EXIT_CODES,
  getRegisteredCommands,
  runCli,
  type CliIO
} from '../index.ts'
import { createFakeProvider } from '../../core/provider/fake/index.ts'
import type { Provider } from '../../core/provider/index.ts'

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

function createIO (): CliIO & { stdout: CaptureWritable, stderr: CaptureWritable } {
  return {
    stdin: new PassThrough(),
    stdout: new CaptureWritable(),
    stderr: new CaptureWritable(),
    stdoutIsTTY: false,
    stderrIsTTY: false,
    stdinIsTTY: false
  }
}

function createCommands (providers: readonly Provider[]): Array<ReturnType<typeof createAuthStatusCommand>> {
  const resolveProviders: () => readonly Provider[] = () => providers
  return [
    createAuthStatusCommand(resolveProviders),
    createAuthLogoutCommand(resolveProviders)
  ]
}

function createProvider (id: Provider['id'], displayName: string): Provider {
  return { ...createFakeProvider({ displayName }), id }
}

describe('sple auth status', () => {
  it('registers status and logout with the CLI framework', () => {
    const paths = getRegisteredCommands().map(command => command.path.join(' '))
    assert.ok(paths.includes('auth status'))
    assert.ok(paths.includes('auth logout'))
  })

  it('lists every registered provider by default and emits the stable JSON shape', async () => {
    const spotify = createProvider('spotify', 'Spotify')
    const fake = createFakeProvider()
    const commands = createCommands([spotify, fake])
    const io = createIO()

    assert.equal(await runCli(['auth', 'status', '--json'], { commands, io, processEnv: {} }), EXIT_CODES.success)
    assert.deepEqual(JSON.parse(io.stdout.text), {
      providers: [
        { id: 'spotify', loggedIn: false, scopes: [] },
        { id: 'fake', loggedIn: false, scopes: [] }
      ]
    })
    assert.equal(io.stderr.text, '')
  })

  it('dispatches only the selected provider and prints logged-in IDs in quiet mode', async () => {
    const spotify = createProvider('spotify', 'Spotify')
    const fake = createFakeProvider()
    await fake.auth.login({ mode: 'manual', scopes: ['playlist-read-private'] })
    const commands = createCommands([spotify, fake])
    const io = createIO()

    assert.equal(await runCli(['auth', 'status', '--provider', 'fake', '--quiet'], {
      commands,
      io,
      processEnv: {}
    }), EXIT_CODES.success)
    assert.equal(io.stdout.text, 'fake\n')
    assert.equal(io.stderr.text, '')
  })

  it('reports an unregistered selected provider as a usage error without calling status', async () => {
    const io = createIO()
    assert.equal(await runCli(['auth', 'status', '--provider', 'spotify'], {
      commands: createCommands([createFakeProvider()]),
      io,
      processEnv: {}
    }), EXIT_CODES.usage)
    assert.match(io.stderr.text, /Unknown provider: spotify\. Registered providers: fake/v)
    assert.equal(io.stdout.text, '')
  })
})

describe('sple auth logout', () => {
  it('logs out the selected provider, states non-revocation, and preserves provider notices', async () => {
    let logoutCalls = 0
    const provider = createFakeProvider({ displayName: 'Spotify' })
    provider.auth.logout = async () => {
      logoutCalls += 1
      return await Promise.resolve({
        revoked: false,
        deletedData: ['Spotify tokens'],
        notice: 'Spotify does not support token revocation. Revoke access in account settings.'
      })
    }
    const io = createIO()

    assert.equal(await runCli(['auth', 'logout', '--provider', 'fake'], {
      commands: createCommands([provider]),
      io,
      processEnv: {}
    }), EXIT_CODES.success)
    assert.equal(logoutCalls, 1)
    assert.equal(io.stdout.text, 'Spotify: Local credentials removed; access was not revoked. Removed: Spotify tokens.\n')
    assert.match(io.stderr.text, /Spotify does not support token revocation/v)
  })

  it('logs out all registered providers, supports quiet mode, and rejects conflicting flags', async () => {
    const first = createFakeProvider()
    const second = createFakeProvider()
    let firstCalls = 0
    let secondCalls = 0
    first.auth.logout = async () => {
      firstCalls += 1
      return await Promise.resolve({ revoked: true, deletedData: ['first'] })
    }
    second.auth.logout = async () => {
      secondCalls += 1
      return await Promise.resolve({ revoked: true, deletedData: ['second'] })
    }
    const commands = createCommands([first, second])
    const io = createIO()

    assert.equal(await runCli(['auth', 'logout', '--all', '--quiet'], { commands, io, processEnv: {} }), EXIT_CODES.success)
    assert.equal(firstCalls, 1)
    assert.equal(secondCalls, 1)
    assert.equal(io.stdout.text, '')
    assert.equal(io.stderr.text, '')

    assert.equal(await runCli(['auth', 'logout', '--all', '--provider', 'fake'], { commands, io: createIO(), processEnv: {} }), EXIT_CODES.usage)
  })
})
