import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import { createAuthLoginCommand, EXIT_CODES, runCli, type CliIO } from '../index.ts'
import type { SpotifyLoginDependencies, SpotifyLoginOptions, SpotifyLoginResult } from '../../provider/spotify/index.ts'

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

function createIO (): CliIO & {
  stdout: CaptureWritable
  stderr: CaptureWritable
} {
  return {
    stdin: new PassThrough(),
    stdout: new CaptureWritable(),
    stderr: new CaptureWritable(),
    stdoutIsTTY: false,
    stderrIsTTY: false,
    stdinIsTTY: false
  }
}

const CLIENT_ID = 'test-client-id'

describe('sple auth login', () => {
  it('registers the command so it is discoverable in root help', async () => {
    const io = createIO()
    assert.equal(await runCli(['--help'], { io, processEnv: {} }), EXIT_CODES.success)
    assert.match(io.stdout.text, /auth login\s+Log in to a music provider/v)
  })

  it('dispatches the default login mode and injected OAuth dependencies', async () => {
    const io = createIO()
    let actualOptions: SpotifyLoginOptions | undefined = undefined
    let actualDependencies: SpotifyLoginDependencies | undefined = undefined
    const oauthDependencies: SpotifyLoginDependencies = {
      fetchImpl: async () => {
        await Promise.resolve()
        throw new Error('unexpected fetch')
      },
      openBrowser: async () => {
        await Promise.resolve()
        throw new Error('unexpected browser open')
      },
      readLine: async () => {
        await Promise.resolve()
        return null
      },
      saveToken: async () => { await Promise.resolve() }
    }
    const login = async (
      options: SpotifyLoginOptions,
      dependencies?: SpotifyLoginDependencies
    ): Promise<SpotifyLoginResult> => {
      actualOptions = options
      actualDependencies = dependencies
      dependencies?.writeStderr?.('Waiting for authorization...')
      await Promise.resolve()
      return { userId: 'test-user', scopes: [] }
    }

    assert.equal(await runCli(['auth', 'login'], {
      commands: [createAuthLoginCommand(oauthDependencies, login)],
      io,
      processEnv: { SPLE_SPOTIFY_CLIENT_ID: CLIENT_ID }
    }), EXIT_CODES.success)
    assert.deepEqual(actualOptions, { clientId: CLIENT_ID, mode: 'loopback' })
    assert.equal(actualDependencies?.fetchImpl, oauthDependencies.fetchImpl)
    assert.equal(actualDependencies?.openBrowser, oauthDependencies.openBrowser)
    assert.equal(actualDependencies?.readLine, oauthDependencies.readLine)
    assert.equal(actualDependencies?.saveToken, oauthDependencies.saveToken)
    assert.equal(io.stdout.text, 'Spotify login successful.\n')
    assert.equal(io.stderr.text, 'Waiting for authorization...\n')
    assert.equal(io.stdout.text.includes(CLIENT_ID), false)
    assert.equal(io.stderr.text.includes(CLIENT_ID), false)
  })

  it('maps --no-browser and --manual to provider modes', async () => {
    await Promise.all([
      { flag: '--no-browser', mode: 'no-browser' },
      { flag: '--manual', mode: 'manual' }
    ].map(async testCase => {
      const io = createIO()
      let actualOptions: SpotifyLoginOptions | undefined = undefined
      const login = async (options: SpotifyLoginOptions): Promise<SpotifyLoginResult> => {
        actualOptions = options
        await Promise.resolve()
        return { userId: 'test-user', scopes: [] }
      }
      assert.equal(await runCli(['auth', 'login', testCase.flag], {
        commands: [createAuthLoginCommand({}, login)],
        io,
        processEnv: { SPLE_SPOTIFY_CLIENT_ID: CLIENT_ID }
      }), EXIT_CODES.success)
      assert.deepEqual(actualOptions, { clientId: CLIENT_ID, mode: testCase.mode })
      assert.equal(io.stdout.text, 'Spotify login successful.\n')
    }))
  })

  it('rejects conflicting modes, unsupported providers, and a missing Client ID', async () => {
    const cases = [
      {
        args: ['auth', 'login', '--manual', '--no-browser'],
        processEnv: { SPLE_SPOTIFY_CLIENT_ID: CLIENT_ID },
        message: '--no-browser and --manual cannot be used together'
      },
      {
        args: ['auth', 'login', '--provider', 'fake'],
        processEnv: { SPLE_SPOTIFY_CLIENT_ID: CLIENT_ID },
        message: 'sple auth login currently supports only --provider spotify'
      },
      {
        args: ['auth', 'login'],
        processEnv: {},
        message: 'Missing Spotify Client ID. Set SPLE_SPOTIFY_CLIENT_ID in your environment.'
      }
    ] as const

    await Promise.all(cases.map(async testCase => {
      const io = createIO()
      const login = async (): Promise<SpotifyLoginResult> => {
        await Promise.resolve()
        throw new Error('login must not be called for invalid input')
      }
      assert.equal(await runCli(testCase.args, {
        commands: [createAuthLoginCommand({}, login)],
        io,
        processEnv: testCase.processEnv
      }), EXIT_CODES.usage)
      assert.ok(io.stderr.text.includes(testCase.message))
      assert.equal(io.stdout.text, '')
    }))
  })
})
