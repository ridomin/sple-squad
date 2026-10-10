import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import {
  EXIT_CODES,
  PartialFailureError,
  ProgressIndicator,
  configureLogging,
  createLogger,
  clearProgressIndicators,
  formatErrorMessage,
  formatErrorOutput,
  formatJson,
  formatOutput,
  formatRows,
  getExitCode,
  getPartialFailureExitCode,
  getHelpText,
  getVersion,
  parseCommandArguments,
  parseGlobalArguments,
  parsePlaylistStdin,
  redactSecrets,
  registerSensitiveValue,
  resolvePlaylistArguments,
  run,
  selectOutputMode,
  type CliIO,
  type CommandDefinition
} from './index.ts'
import { AuthRequiredError, NotFoundError, RateLimitError, UsageError } from '../core/provider/errors.ts'

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

function createIO (stdoutIsTTY = false, stderrIsTTY = false, stdinIsTTY = false): CliIO & {
  stdout: CaptureWritable
  stderr: CaptureWritable
} {
  return {
    stdin: new PassThrough(),
    stdout: new CaptureWritable(),
    stderr: new CaptureWritable(),
    stdoutIsTTY,
    stderrIsTTY,
    stdinIsTTY
  }
}

const sampleCommand: CommandDefinition = {
  path: ['playlist', 'list'],
  description: 'List playlists',
  helpText: 'Usage: sple playlist list [--owned]',
  options: { owned: { type: 'boolean' } },
  run: ({ stdout, provider, outputMode, positionals }) => {
    stdout.write(formatJson({ provider, outputMode, positionals }))
  }
}

describe('CLI framework contract', () => {
  it('reports a non-empty version and prints the root usage', async () => {
    assert.ok(getVersion().length > 0)
    assert.ok(getHelpText().includes('Usage: sple'))
    const io = createIO()
    assert.equal(await run(['--version'], { io }), EXIT_CODES.success)
    assert.match(io.stdout.text, /^sple v.+\n/v)
  })

  it('dispatches the noun/verb command after removing global flags anywhere', async () => {
    const io = createIO()
    const exitCode = await run([
      'playlist', 'list', '--owned', '--provider', 'youtube-music', '--json'
    ], {
      commands: [sampleCommand],
      io,
      processEnv: { SPLE_DEFAULT_PROVIDER: 'fake' },
      envFilePath: '.sple-framework-no-env'
    })
    assert.equal(exitCode, EXIT_CODES.success)
    assert.deepEqual(JSON.parse(io.stdout.text), {
      provider: 'youtube-music',
      outputMode: 'json',
      positionals: []
    })
    assert.equal(io.stderr.text, '')
  })

  it('uses SPLE_DEFAULT_PROVIDER when --provider is absent', async () => {
    const io = createIO()
    assert.equal(await run(['playlist', 'list', '--json'], {
      commands: [sampleCommand],
      io,
      processEnv: { SPLE_DEFAULT_PROVIDER: 'youtube-music' },
      envFilePath: '.sple-framework-no-env'
    }), EXIT_CODES.success)
    assert.deepEqual(JSON.parse(io.stdout.text), {
      provider: 'youtube-music',
      outputMode: 'json',
      positionals: []
    })
  })

  it('supports root and per-command help', async () => {
    const rootIO = createIO()
    assert.equal(await run(['--help', 'playlist', 'list'], { commands: [sampleCommand], io: rootIO }), 0)
    assert.match(rootIO.stdout.text, /Global options:/v)
    const commandIO = createIO()
    assert.equal(await run(['playlist', 'list', '--help'], { commands: [sampleCommand], io: commandIO }), 0)
    assert.equal(commandIO.stdout.text, `${sampleCommand.helpText}\n`)
  })

  it('maps an unknown command to a usage error (exit 2)', async () => {
    const io = createIO()
    assert.equal(await run(['not-a-command'], { io }), EXIT_CODES.usage)
    assert.equal(io.stdout.text, '')
    assert.match(io.stderr.text, /^sple: Unknown command: not-a-command\n/v)
  })

  it('writes a JSON error object last on stderr and maps auth errors to exit 3', async () => {
    const io = createIO()
    const command: CommandDefinition = {
      ...sampleCommand,
      run: () => { throw new AuthRequiredError('no-token') }
    }
    assert.equal(await run(['playlist', 'list', '--json'], {
      commands: [command],
      io,
      processEnv: {},
      envFilePath: '.sple-framework-no-env'
    }), EXIT_CODES.authRequired)
    const lines = io.stderr.text.trimEnd().split('\n')
    assert.equal(lines[0], 'sple: Authentication required. Run "sple auth login" to log in.')
    assert.deepEqual(JSON.parse(lines.at(-1) ?? ''), {
      error: {
        type: 'AuthRequiredError',
        message: 'Authentication required. Run "sple auth login" to log in.',
        exitCode: EXIT_CODES.authRequired
      }
    })
  })
})

describe('shared command arguments and output', () => {
  it('resolves global flags independently of command flags', () => {
    const parsed = parseGlobalArguments(
      ['playlist', 'list', '--json', '--provider=spotify'],
      [sampleCommand]
    )
    assert.equal(parsed.global.json, true)
    assert.equal(parsed.global.provider, 'spotify')
    assert.deepEqual(parsed.commandArgs, [])
    assert.deepEqual(parseCommandArguments(sampleCommand, ['--owned']).values, { owned: true })
  })

  it('selects JSON, quiet, TTY table, and piped TSV modes', () => {
    assert.equal(selectOutputMode(true, false, false), 'json')
    assert.equal(selectOutputMode(false, true, true), 'quiet')
    assert.equal(selectOutputMode(false, false, true), 'table')
    assert.equal(selectOutputMode(false, false, false), 'tsv')
    assert.throws(() => selectOutputMode(true, true, false), UsageError)
  })

  it('emits a padded TTY table and complete, sanitized TSV for pipes', () => {
    const columns = [
      { key: 'name', label: 'name', flexible: true },
      { key: 'id', label: 'id' }
    ]
    const rows = [{ name: 'A playlist name that can shrink', id: 'stable-id', owned: true }]
    const table = formatRows(columns, rows, { stdoutIsTTY: true, columns: 20, noColor: true })
    const tsv = formatRows(columns, [{ name: 'A\tplaylist\nname', id: 'stable-id', owned: true }], {
      stdoutIsTTY: false
    })
    assert.match(table, /^name\s+id\nA.* stable-id\n/v)
    assert.equal(tsv, 'A playlist name\tstable-id\n')
    const booleanRows = [{ name: 'List', id: 'id', owned: true }]
    assert.ok(formatRows(
      [...columns, { key: 'owned', label: 'owned' }],
      booleanRows,
      { stdoutIsTTY: true, noColor: true }
    ).includes('yes'))
    assert.equal(formatRows(
      [...columns, { key: 'owned', label: 'owned' }],
      booleanRows,
      { stdoutIsTTY: false }
    ), 'List\tid\ttrue\n')
    assert.equal(formatOutput({ mode: 'quiet', value: {}, quietIds: ['id-1', 'id-2'] }), 'id-1\nid-2\n')
    assert.equal(formatOutput({ mode: 'json', value: { items: [] } }), '{\n  "items": []\n}\n')
  })
})

describe('stdin, errors, logging, and progress', () => {
  it('reads CRLF playlist refs while ignoring blank and comment lines', () => {
    assert.deepEqual(parsePlaylistStdin('  # comment\r\nid-1\r\n\r\nspotify:playlist:abc\n', false), [
      'id-1',
      'spotify:playlist:abc'
    ])
    assert.deepEqual(resolvePlaylistArguments(['-'], 'id-1\n', false, true), ['id-1'])
    assert.throws(() => parsePlaylistStdin('id-1\n', true), UsageError)
    assert.throws(() => resolvePlaylistArguments(['-', 'other'], 'id-1\n', false), UsageError)
    assert.throws(() => resolvePlaylistArguments(['-'], 'id-1\nid-2\n', false, true), UsageError)
  })

  it('maps errors and formats their ADR 0007 messages', () => {
    assert.equal(getExitCode(new UsageError('bad args')), EXIT_CODES.usage)
    assert.equal(getExitCode(new NotFoundError('playlist', 'abc')), EXIT_CODES.notFound)
    assert.equal(getExitCode(new RateLimitError(1500)), EXIT_CODES.rateLimit)
    assert.equal(
      getPartialFailureExitCode([
        new RateLimitError(),
        new AuthRequiredError('no-token'),
        new NotFoundError('playlist')
      ]),
      EXIT_CODES.authRequired
    )
    assert.equal(formatErrorMessage(new RateLimitError(1500)), 'Rate limited. Please try again later. Retry after 2s.')
    assert.deepEqual(formatErrorOutput(new NotFoundError('playlist', 'abc')), {
      error: {
        type: 'NotFoundError',
        message: 'playlist not found: abc',
        exitCode: EXIT_CODES.notFound
      }
    })
    assert.equal(
      formatErrorOutput(new PartialFailureError('some items failed', [new NotFoundError('playlist')])).error.type,
      'PartialFailure'
    )
  })

  it('redacts bearer and sensitive key values before logging', () => {
    const message = [
      'Bearer known-token',
      'access_token=access-value&client_secret=secret-value',
      '{"refresh_token":"refresh-value"}'
    ].join(' ')
    const redacted = redactSecrets(message, ['secret-value'])
    assert.equal(redacted.includes('known-token'), false)
    assert.equal(redacted.includes('access-value'), false)
    assert.equal(redacted.includes('refresh-value'), false)
    assert.equal(redacted.includes('secret-value'), false)
    assert.match(redacted, /access_token=\[REDACTED\]/v)
    const stderr = new CaptureWritable()
    registerSensitiveValue('registered-secret-value')
    configureLogging({ verbose: false, debug: false, debugEnv: 'sple:http' }, stderr)
    createLogger('http')('credential=registered-secret-value')
    createLogger('core')('filtered out')
    assert.match(stderr.text, /credential=\[REDACTED\]/v)
    assert.equal(stderr.text.includes('filtered out'), false)
    configureLogging({ verbose: false, debug: false }, stderr)
  })

  it('renders progress only on an enabled TTY and redraws no faster than 10 Hz', () => {
    const stderr = new CaptureWritable()
    let now = 0
    const progress = new ProgressIndicator({
      stderr,
      stderrIsTTY: true,
      now: () => now
    })
    progress.update('Exporting', 2, 4)
    now = 50
    progress.update('Exporting', 3, 4)
    now = 100
    progress.update('Exporting', 4, 4)
    progress.finish()
    assert.equal(stderr.chunks.length, 3)
    assert.match(stderr.text, /Exporting \[#####-----\] 2\/4/v)
    assert.ok(stderr.text.endsWith('\r\u001b[2K'))
    const disabled = new CaptureWritable()
    new ProgressIndicator({ stderr: disabled, stderrIsTTY: false }).update('No TTY', 1)
    assert.equal(disabled.text, '')
    const jsonDisabled = new CaptureWritable()
    new ProgressIndicator({
      stderr: jsonDisabled,
      stderrIsTTY: true,
      mode: 'json'
    }).update('No JSON progress', 1)
    assert.equal(jsonDisabled.text, '')
    const interrupted = new CaptureWritable()
    const active = new ProgressIndicator({ stderr: interrupted, stderrIsTTY: true })
    active.update('Working', 1)
    clearProgressIndicators(interrupted)
    interrupted.write('warning\n')
    assert.ok(interrupted.text.indexOf('\u001b[2K') < interrupted.text.indexOf('warning'))
  })
})
