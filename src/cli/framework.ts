import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { loadConfigFromDisk } from '../core/config/config.ts'
import {
  parseCommandArguments,
  parseGlobalArguments,
  type CommandContext,
  type CommandDefinition,
  type GlobalFlags,
  type ParsedInvocation
} from './args.ts'
import { EXIT_CODES, formatErrorMessage, formatErrorOutput, getExitCode } from './exit-codes.ts'
import { configureLogging, createLogger, redactSecrets } from './logger.ts'
import { writeCliMessage } from './messages.ts'
import { selectOutputMode } from './output.ts'
import { getRegisteredCommands } from './registry.ts'

const ROOT_USAGE = 'Usage: sple <noun> <verb> [args] [flags]'
const PROCESS_ARGV_SCRIPT_INDEX = 1
const PROCESS_ARGV_USER_ARGS_START = 2
const HELP_INDENT_WIDTH = 17
const MINIMUM_INDENT = 1
const EMPTY_COUNT = 0
const moduleDir = dirname(fileURLToPath(import.meta.url))

interface PackageManifest {
  version: string
}

export interface CliIO {
  stdin: Readable
  stdout: Writable
  stderr: Writable
  stdoutIsTTY: boolean
  stderrIsTTY: boolean
  stdinIsTTY: boolean
}

export interface RunCliOptions {
  commands?: readonly CommandDefinition[]
  io?: CliIO
  envFilePath?: string
  processEnv?: NodeJS.ProcessEnv
}

const defaultIO: CliIO = {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  stdoutIsTTY: process.stdout.isTTY,
  stderrIsTTY: process.stderr.isTTY,
  stdinIsTTY: process.stdin.isTTY
}

export function getVersion (): string {
  const pkgPath = join(moduleDir, '..', '..', 'package.json')
  const parsed: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (!isPackageManifest(parsed)) throw new Error(`invalid package.json at ${pkgPath}`)
  return parsed.version
}

export function getRootHelpText (commands: readonly CommandDefinition[] = []): string {
  const commandLines = commands.map(formatCommandHelpRow)
  return [
    'sple - manage music-streaming playlists from the command line',
    '',
    ROOT_USAGE,
    '',
    'Global options:',
    '  --provider <id>  Select the provider (default: SPLE_DEFAULT_PROVIDER or spotify)',
    '  --json           Write machine-readable JSON',
    '  --quiet          Write IDs only',
    '  --verbose        Enable informational logs on stderr',
    '  --debug          Enable debug logs on stderr',
    '  --yes            Confirm prompts automatically',
    '  --help, -h       Show help',
    '  --version, -v    Print the version',
    '',
    ...(commandLines.length > EMPTY_COUNT ? ['Commands:', ...commandLines, ''] : []),
    'Use "sple <command> --help" for command help.'
  ].join('\n')
}

export async function runCli (
  argv: string[],
  options: RunCliOptions = {}
): Promise<number> {
  const commands = options.commands ?? getRegisteredCommands()
  const io = options.io ?? defaultIO
  try {
    const invocation = parseGlobalArguments(argv, commands)
    configureLogger(invocation.global, io.stderr, options.processEnv ?? process.env)
    return await executeInvocation(invocation, options, commands, io)
  } catch (error) {
    return reportError(error, io, {
      jsonRequested: argv.includes('--json'),
      debugRequested: argv.includes('--debug')
    })
  }
}

async function executeInvocation (
  invocation: ParsedInvocation,
  options: RunCliOptions,
  commands: readonly CommandDefinition[],
  io: CliIO
): Promise<number> {
  const { global, command } = invocation
  if (global.version) {
    io.stdout.write(`sple v${getVersion()}\n`)
    return EXIT_CODES.success
  }
  if (command === null || global.helpBeforeCommand) {
    io.stdout.write(`${getRootHelpText(commands)}\n`)
    return EXIT_CODES.success
  }
  if (global.help) {
    io.stdout.write(`${command.helpText}\n`)
    return EXIT_CODES.success
  }
  return await executeCommand(invocation, options, io)
}

async function executeCommand (
  invocation: ParsedInvocation,
  options: RunCliOptions,
  io: CliIO
): Promise<number> {
  const { command, commandArgs, global } = invocation
  if (command === null) return EXIT_CODES.success
  const outputMode = selectOutputMode(global.json, global.quiet, io.stdoutIsTTY)
  const configOptions = getConfigOptions(global, options)
  const { config, warnings } = await loadConfigFromDisk(configOptions)
  for (const warning of warnings) writeCliMessage(io.stderr, warning, 'warning')

  const parsed = parseCommandArguments(command, commandArgs)
  const context: CommandContext = {
    command: command.path,
    positionals: parsed.positionals,
    flags: parsed.values,
    global,
    provider: config.defaultProvider,
    config,
    outputMode,
    stdin: io.stdin,
    stdout: io.stdout,
    stderr: io.stderr,
    stdinIsTTY: io.stdinIsTTY,
    stdoutIsTTY: io.stdoutIsTTY,
    stderrIsTTY: io.stderrIsTTY
  }
  createLogger('cli')(
    `command=${command.path.join(' ')} provider=${context.provider}`
  )
  await command.run(context)
  return EXIT_CODES.success
}

function getConfigOptions (
  global: GlobalFlags,
  options: RunCliOptions
): {
  cliProvider?: string
  envFilePath?: string
  processEnv?: NodeJS.ProcessEnv
} {
  const configOptions: {
    cliProvider?: string
    envFilePath?: string
    processEnv?: NodeJS.ProcessEnv
  } = {}
  const { provider } = global
  const { envFilePath, processEnv } = options
  if (provider !== undefined) configOptions.cliProvider = provider
  if (envFilePath !== undefined) configOptions.envFilePath = envFilePath
  if (processEnv !== undefined) configOptions.processEnv = processEnv
  return configOptions
}

function configureLogger (
  global: GlobalFlags,
  stderr: Writable,
  environment: NodeJS.ProcessEnv
): void {
  const loggerOptions = {
    verbose: global.verbose,
    debug: global.debug,
    ...(environment.DEBUG === undefined ? {} : { debugEnv: environment.DEBUG })
  }
  configureLogging(loggerOptions, stderr)
}

function reportError (
  error: unknown,
  io: CliIO,
  options: { jsonRequested: boolean, debugRequested: boolean }
): number {
  const { stderr } = io
  const { jsonRequested, debugRequested } = options
  const exitCode = getExitCode(error)
  writeCliMessage(stderr, formatErrorMessage(error), 'error')
  if (debugRequested && error instanceof Error && error.stack !== undefined) {
    stderr.write(`${redactSecrets(error.stack)}\n`)
  }
  if (jsonRequested && exitCode !== EXIT_CODES.success) {
    stderr.write(`${JSON.stringify(redactErrorOutput(formatErrorOutput(error)))}\n`)
  }
  return exitCode
}

function formatCommandHelpRow (command: CommandDefinition): string {
  const name = command.path.join(' ')
  const spacing = Math.max(MINIMUM_INDENT, HELP_INDENT_WIDTH - name.length)
  return `  ${name}${' '.repeat(spacing)}${command.description}`
}

function isPackageManifest (value: unknown): value is PackageManifest {
  if (typeof value !== 'object' || value === null) return false
  return 'version' in value && typeof value.version === 'string'
}

function redactErrorOutput (value: ReturnType<typeof formatErrorOutput>): ReturnType<typeof formatErrorOutput> {
  return {
    error: {
      ...value.error,
      message: redactSecrets(value.error.message)
    }
  }
}

export function startCli (entrypointUrl: string = import.meta.url): void {
  const [script] = process.argv.slice(PROCESS_ARGV_SCRIPT_INDEX)
  const isMain = script !== undefined &&
    resolve(script) === fileURLToPath(entrypointUrl)
  if (isMain) {
    void runCli(process.argv.slice(PROCESS_ARGV_USER_ARGS_START)).then(code => {
      process.exitCode = code
    })
  }
}
