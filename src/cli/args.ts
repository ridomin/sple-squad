import { parseArgs, type ParseArgsConfig } from 'node:util'
import type { Readable, Writable } from 'node:stream'
import type { SpleConfig } from '../core/config/config.ts'
import type { OutputMode } from './output.ts'
import { UsageError } from '../core/provider/errors.ts'

export interface GlobalFlags {
  provider?: string
  json: boolean
  quiet: boolean
  verbose: boolean
  debug: boolean
  yes: boolean
  help: boolean
  version: boolean
  helpBeforeCommand: boolean
}

export interface ParsedCommand {
  definition: CommandDefinition
  positionals: string[]
  values: Record<string, string | boolean | undefined>
}

export interface CommandContext {
  command: string[]
  positionals: string[]
  flags: Record<string, string | boolean | undefined>
  global: GlobalFlags
  provider: string
  config: SpleConfig
  outputMode: OutputMode
  stdin: Readable
  stdout: Writable
  stderr: Writable
  stdinIsTTY: boolean
  stdoutIsTTY: boolean
  stderrIsTTY: boolean
}

export interface CommandDefinition {
  path: string[]
  description: string
  helpText: string
  options?: ParseArgsConfig['options']
  run: (context: CommandContext) => void | Promise<void>
}

export interface ParsedInvocation {
  global: GlobalFlags
  command: CommandDefinition | null
  commandArgs: string[]
}

const BOOLEAN_GLOBAL_FLAGS = new Set([
  '--json',
  '--quiet',
  '--verbose',
  '--debug',
  '--yes',
  '--help',
  '-h',
  '--version',
  '-v'
])
const FIRST_INDEX = 0
const NEXT_INDEX = 1
const NO_INDEX = -1
const PROVIDER_OPTION_PREFIX = '--provider='
const COMMAND_MIGRATE = 'migrate'
const EMPTY_COUNT = 0
const BOOLEAN_FLAG_HANDLERS: Record<string, (global: GlobalFlags) => void> = {
  '--json': global => { Object.assign(global, { json: true }) },
  '--quiet': global => { Object.assign(global, { quiet: true }) },
  '--verbose': global => { Object.assign(global, { verbose: true }) },
  '--debug': global => { Object.assign(global, { debug: true }) },
  '--yes': global => { Object.assign(global, { yes: true }) },
  '--help': global => { Object.assign(global, { help: true }) },
  '-h': global => { Object.assign(global, { help: true }) },
  '--version': global => { Object.assign(global, { version: true }) },
  '-v': global => { Object.assign(global, { version: true }) }
}

interface GlobalParseState {
  global: GlobalFlags
  remaining: string[]
  commandStart: number
  helpIndex: number
  endOfOptions: boolean
  consumedIndices: Set<number>
}

export function parseGlobalArguments (
  argv: string[],
  commands: readonly CommandDefinition[]
): ParsedInvocation {
  const state: GlobalParseState = {
    global: {
      json: false,
      quiet: false,
      verbose: false,
      debug: false,
      yes: false,
      help: false,
      version: false,
      helpBeforeCommand: false
    },
    remaining: [],
    commandStart: NO_INDEX,
    helpIndex: NO_INDEX,
    endOfOptions: false,
    consumedIndices: new Set()
  }

  for (let index = FIRST_INDEX; index < argv.length; index += NEXT_INDEX) {
    if (state.consumedIndices.has(index)) continue
    const arg = argv.at(index)
    if (arg === undefined || consumeGlobalOption(argv, index, arg, state)) continue
    recordRemainingArgument(arg, index, state)
  }

  return resolveInvocation(state, commands)
}

function resolveInvocation (
  state: GlobalParseState,
  commands: readonly CommandDefinition[]
): ParsedInvocation {
  const { global, remaining } = state
  if (global.version) return { global, command: null, commandArgs: [] }
  if (global.json && global.quiet) {
    throw new UsageError('--json and --quiet cannot be used together')
  }
  global.helpBeforeCommand = global.help &&
    (state.commandStart === NO_INDEX || state.helpIndex < state.commandStart)

  const command = findCommand(remaining, commands)
  if (command === null) return resolveMissingCommand(global, remaining)

  return {
    global,
    command,
    commandArgs: remaining.slice(command.path.length)
  }

  function resolveMissingCommand (
    global: GlobalFlags,
    remaining: string[]
  ): ParsedInvocation {
    const first = remaining.find(isCommandWord)
    if (first === COMMAND_MIGRATE) throw new UsageError("Command 'migrate' is available in a later release")
    if (global.helpBeforeCommand || remaining.length === EMPTY_COUNT) {
      return { global, command: null, commandArgs: [] }
    }
    const firstArg = remaining.at(FIRST_INDEX)
    if (firstArg?.startsWith('-') === true) throw new UsageError(`Unknown option: ${firstArg}`)
    throw new UsageError(`Unknown command: ${first ?? firstArg ?? ''}`)
  }
}

function consumeGlobalOption (
  argv: string[],
  index: number,
  arg: string,
  state: GlobalParseState
): boolean {
  if (state.endOfOptions) return false
  if (arg === '--') return consumeEndOfOptions(arg, state)
  if (arg.startsWith(PROVIDER_OPTION_PREFIX) || arg === '--provider') {
    return consumeProviderOption(argv, index, arg, state)
  }
  return consumeBooleanGlobal(arg, index, state)
}

function consumeEndOfOptions (arg: string, state: GlobalParseState): true {
  Object.assign(state, { endOfOptions: true })
  state.remaining.push(arg)
  return true
}

function consumeProviderOption (
  argv: string[],
  index: number,
  arg: string,
  state: GlobalParseState
): true {
  const value = arg.startsWith(PROVIDER_OPTION_PREFIX)
    ? arg.slice(PROVIDER_OPTION_PREFIX.length)
    : argv.at(index + NEXT_INDEX)
  if (value === undefined || value.trim() === '' || value.startsWith('-')) {
    throw new UsageError('Missing value for --provider')
  }
  Object.assign(state.global, { provider: value })
  if (arg === '--provider') state.consumedIndices.add(index + NEXT_INDEX)
  return true
}

function consumeBooleanGlobal (
  arg: string,
  index: number,
  state: GlobalParseState
): boolean {
  if (arg.startsWith(PROVIDER_OPTION_PREFIX)) {
    return false
  }
  if (!BOOLEAN_GLOBAL_FLAGS.has(arg)) return false
  const { [arg]: handler } = BOOLEAN_FLAG_HANDLERS
  if (handler === undefined) return false
  handler(state.global)
  if ((arg === '--help' || arg === '-h') && state.helpIndex === NO_INDEX) {
    Object.assign(state, { helpIndex: index })
  }
  return true
}

function recordRemainingArgument (arg: string, index: number, state: GlobalParseState): void {
  if (state.commandStart === NO_INDEX && !arg.startsWith('-')) {
    Object.assign(state, { commandStart: index })
  }
  state.remaining.push(arg)
}

function isCommandWord (arg: string): boolean {
  return arg !== '--' && !arg.startsWith('-')
}

function findCommand (
  remaining: string[],
  commands: readonly CommandDefinition[]
): CommandDefinition | null {
  const ordered = [...commands].sort((left, right) => right.path.length - left.path.length)
  return ordered.find(definition =>
    definition.path.every((part, index) => remaining[index] === part)
  ) ?? null
}

export function parseCommandArguments (
  command: CommandDefinition,
  args: string[]
): { positionals: string[], values: Record<string, string | boolean | undefined> } {
  try {
    const parsed = parseArgs({
      args,
      options: command.options ?? {},
      strict: true,
      allowPositionals: true,
      tokens: false
    })
    const values: Record<string, string | boolean | undefined> = {}
    for (const [key, value] of Object.entries(parsed.values)) {
      if (typeof value === 'string' || typeof value === 'boolean') values[key] = value
    }
    return { positionals: parsed.positionals, values }
  } catch (error) {
    if (error instanceof Error) throw new UsageError(error.message)
    throw error
  }
}
