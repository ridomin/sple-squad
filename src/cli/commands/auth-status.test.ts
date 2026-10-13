import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
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
import { AuthRequiredError, NotFoundError } from '../../core/provider/errors.ts'
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

const NOW = new Date('2026-01-01T12:00:00.000Z')

async function humanStatus (expiresAt: string | undefined, refreshTokenExpiresAt?: string): Promise<{ stdout: string, stderr: string }> {
  const provider = createProvider('spotify', 'Spotify')
  provider.auth.status = async () => await Promise.resolve({
    loggedIn: true,
    user: { id: 'u1', displayName: 'Ada' },
    scopes: ['a', 'b'],
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(refreshTokenExpiresAt === undefined ? {} : { refreshTokenExpiresAt })
  })
  const io = createIO()
  const commands = [createAuthStatusCommand(() => [provider], () => NOW)]
  assert.equal(await runCli(['auth', 'status'], { commands, io, processEnv: {} }), EXIT_CODES.success)
  return { stdout: io.stdout.text, stderr: io.stderr.text }
}

describe('sple auth status human output', () => {
  it('marks an expired token and warns on stderr', async () => {
    const out = await humanStatus('2026-01-01T12:00:00.000Z')
    assert.equal(out.stdout, [
      'Spotify (spotify): logged in',
      '  User: Ada (u1)',
      '  Scopes: a b',
      '  Token expires: 2026-01-01T12:00:00.000Z (expired)',
      ''
    ].join('\n'))
    assert.equal(out.stderr, 'Warning: Spotify access token has expired; it will be refreshed on next use\n')
  })

  it('shows a valid refresh token expiry without a warning', async () => {
    const out = await humanStatus('2026-01-01T13:00:00.000Z', '2026-02-01T00:00:00.000Z')
    assert.match(out.stdout, / {2}Token expires: 2026-01-01T13:00:00\.000Z\n {2}Refresh token expires: 2026-02-01T00:00:00\.000Z\n$/v)
    assert.doesNotMatch(out.stdout, /expired\)/v)
    assert.equal(out.stderr, '')
  })

  it('marks an expired refresh token and warns about login instead of auto-refresh', async () => {
    const out = await humanStatus('2026-01-01T11:00:00.000Z', '2026-01-01T11:30:00.000Z')
    assert.match(out.stdout, / {2}Token expires: 2026-01-01T11:00:00\.000Z \(expired\)\n {2}Refresh token expires: 2026-01-01T11:30:00\.000Z \(expired\)\n$/v)
    assert.equal(out.stderr, 'Warning: Spotify refresh token has expired; run "sple auth login --provider spotify"\n')
  })

  it('does not mark a valid token and warns when expiring within 5 minutes', async () => {
    const valid = await humanStatus('2026-01-01T13:00:00.000Z')
    assert.match(valid.stdout, / {2}Token expires: 2026-01-01T13:00:00\.000Z\n$/v)
    assert.doesNotMatch(valid.stdout, /expired/v)
    assert.equal(valid.stderr, '')

    const soon = await humanStatus('2026-01-01T12:04:00.000Z')
    assert.doesNotMatch(soon.stdout, /expired/v)
    assert.equal(soon.stderr, 'Warning: Spotify access token expires in less than 5 minutes\n')
  })

  it('prints not logged in with no scopes and no expiry line', async () => {
    const io = createIO()
    const commands = [createAuthStatusCommand(() => [createProvider('spotify', 'Spotify')], () => NOW)]
    await runCli(['auth', 'status'], { commands, io, processEnv: {} })
    assert.equal(io.stdout.text, 'Spotify (spotify): not logged in\n  Scopes: (none)\n')
  })
})

describe('sple auth logout', () => {
  it('attempts every provider in order and exits with the first failure', async () => {
    const calls: string[] = []
    const make = (id: Provider['id'], name: string, behavior: 'ok' | 'notfound' | 'auth', delay: number): Provider => {
      const provider = createProvider(id, name)
      provider.auth.logout = async () => {
        await sleep(delay)
        calls.push(name)
        if (behavior === 'notfound') throw new NotFoundError('first failure')
        if (behavior === 'auth') throw new AuthRequiredError('second failure')
        return { revoked: true, deletedData: ['t'] }
      }
      return provider
    }
    const providers = [make('spotify', 'A', 'notfound', 20), make('fake', 'B', 'auth', 1), make('fake', 'C', 'ok', 1)]
    const io = createIO()
    const code = await runCli(['auth', 'logout', '--all'], { commands: createCommands(providers), io, processEnv: {} })
    assert.equal(code, EXIT_CODES.notFound)
    assert.deepEqual(calls, ['A', 'B', 'C'])
    assert.equal(io.stdout.text, 'Revoked access with C\nDeleted: t\n')
    assert.match(io.stderr.text, /first failure/v)
    assert.doesNotMatch(io.stderr.text, /second failure/v)
  })

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
    assert.equal(io.stdout.text, [
      'Logged out from Spotify',
      'Deleted: Spotify tokens',
      'Spotify does not support token revocation. Revoke access in account settings.',
      ''
    ].join('\n'))
    assert.equal(io.stderr.text, '')
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
