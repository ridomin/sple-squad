import { createInterface } from 'node:readline/promises'
import type { PlaylistSummary, Provider } from '../../core/provider/provider.ts'
import { UsageError } from '../../core/provider/errors.ts'
import { getRegisteredProviders } from '../../provider/registry.ts'
import type { CommandContext, CommandDefinition } from '../args.ts'
import { EXIT_CODES } from '../exit-codes.ts'
import { formatJson, formatRows } from '../output.ts'
import { readStdin, resolvePlaylistArguments } from '../stdin.ts'
import { writeCliMessage } from '../messages.ts'

const FIRST_CHARACTER_INDEX = 0
const REST_INDEX = 1
const FIRST_POSITIONAL_INDEX = 0
const ONE_POSITIONAL = 1
const CREATE_HELP = [
  'Usage: sple playlist create <name> [--description <text>] [--public | --private] [--collaborative] [--dry-run]',
  '',
  'Create a playlist (private by default). Collaborative playlists are private.',
  'Collaborative playlists require provider support.'
].join('\n')
const REMOVE_HELP = [
  'Usage: sple playlist remove <playlist|-> [--yes] [--dry-run]',
  '',
  'Remove a playlist. When a provider cannot delete playlists (as on Spotify), this unfollows rather than deletes.'
].join('\n')

export interface PlaylistCreateOutput {
  dryRun: boolean
  id?: string
  ref?: string
  name: string
  description?: string
  url?: string
  owner?: { id: string, displayName?: string }
  public: boolean
  collaborative: boolean
}

export interface PlaylistRemoveOutput {
  dryRun: boolean
  action: 'unfollowed' | 'deleted'
  playlist: { id: string, ref: string, name: string }
}

export type PlaylistResolver = (provider: Provider, ref: string) => Promise<PlaylistSummary>
export type PlaylistConfirmation = (context: CommandContext, prompt: string) => Promise<boolean>
export type ContextProvider = (context: CommandContext) => Provider

export interface PlaylistMutationDependencies {
  resolvePlaylist: PlaylistResolver
  confirm?: PlaylistConfirmation
  getProvider?: ContextProvider
}

export function createPlaylistCreateCommand (getProvider: ContextProvider = getContextProvider): CommandDefinition {
  return {
    path: ['playlist', 'create'],
    description: 'Create a playlist',
    helpText: CREATE_HELP,
    options: {
      description: { type: 'string', short: 'd' },
      public: { type: 'boolean' },
      private: { type: 'boolean' },
      collaborative: { type: 'boolean' },
      'dry-run': { type: 'boolean' }
    },
    run: async context => {
      await runPlaylistCreate(context, getProvider(context))
    }
  }
}

export function createPlaylistRemoveCommand (
  dependencies: PlaylistMutationDependencies
): CommandDefinition {
  return {
    path: ['playlist', 'remove'],
    description: 'Remove or unfollow a playlist',
    helpText: REMOVE_HELP,
    options: { 'dry-run': { type: 'boolean' } },
    run: async context => {
      await runPlaylistRemove(context, dependencies)
    }
  }
}

export function createPlaylistMutationCommands (
  dependencies: PlaylistMutationDependencies
): CommandDefinition[] {
  return [
    createPlaylistCreateCommand(dependencies.getProvider),
    createPlaylistRemoveCommand(dependencies)
  ]
}

async function runPlaylistCreate (context: CommandContext, provider: Provider): Promise<void> {
  const options = readCreateOptions(context, provider)
  if (options.dryRun) {
    writeCreateOutput(context, createDryRunOutput(options), provider.displayName)
    return
  }

  const playlist = await provider.createPlaylist(createProviderInput(options))
  writeCreateOutput(context, createResultOutput(playlist, options), provider.displayName)
}

async function runPlaylistRemove (
  context: CommandContext,
  dependencies: PlaylistMutationDependencies
): Promise<void> {
  const { positionals, flags, global: { yes }, stdinIsTTY } = context
  const { 'dry-run': dryRun } = flags
  const ref = requireSingleName(positionals)
  ensureRemovalCanProceed(ref, dryRun === true, yes, stdinIsTTY)
  const provider = (dependencies.getProvider ?? getContextProvider)(context)
  const playlist = await resolveRemovalTarget(context, provider, dependencies.resolvePlaylist, ref)
  const action = provider.capabilities.canDeletePlaylist ? 'deleted' : 'unfollowed'

  await confirmRemoval({
    context,
    confirm: dependencies.confirm,
    provider,
    playlist,
    action,
    yes,
    dryRun: dryRun === true
  })

  if (dryRun === true) {
    writeRemoveOutput(context, {
      dryRun: true,
      action,
      playlist: { id: playlist.id, ref: playlist.ref, name: playlist.name }
    }, provider.displayName)
    return
  }

  const result = await provider.removePlaylist(playlist.ref)
  writeRemoveOutput(context, {
    dryRun: false,
    action: result.action,
    playlist: { id: playlist.id, ref: playlist.ref, name: playlist.name }
  }, provider.displayName)
}

interface PlaylistCreateOptions {
  name: string
  public: boolean
  collaborative: boolean
  dryRun: boolean
  description?: string
}

function readCreateOptions (context: CommandContext, provider: Provider): PlaylistCreateOptions {
  const { positionals, flags } = context
  const name = requireSingleName(positionals)
  const {
    public: publicFlag,
    private: privateFlag,
    collaborative: collaborativeFlag,
    'dry-run': dryRunFlag,
    description
  } = flags
  const isPublic = publicFlag === true
  const isPrivate = privateFlag === true
  const collaborative = collaborativeFlag === true
  const dryRun = dryRunFlag === true

  if (isPublic && isPrivate) throw new UsageError('--public and --private cannot be used together')
  if (collaborative && isPublic) throw new UsageError('--collaborative cannot be combined with --public')
  if (collaborative && !provider.capabilities.supportsCollaborative) {
    throw new UsageError(`${provider.displayName} does not support collaborative playlists`)
  }

  if (description !== undefined && typeof description !== 'string') {
    throw new UsageError('--description requires text')
  }

  return {
    name,
    public: isPublic,
    collaborative,
    dryRun,
    ...(description === undefined ? {} : { description })
  }
}

function createProviderInput (
  options: PlaylistCreateOptions
): { name: string, description?: string, public: boolean, collaborative?: boolean } {
  return {
    name: options.name,
    public: options.public,
    ...(options.description === undefined ? {} : { description: options.description }),
    ...(options.collaborative ? { collaborative: true } : {})
  }
}

function createDryRunOutput (options: PlaylistCreateOptions): PlaylistCreateOutput {
  return {
    dryRun: true,
    name: options.name,
    ...(options.description === undefined ? {} : { description: options.description }),
    public: options.public,
    collaborative: options.collaborative
  }
}

function createResultOutput (
  playlist: PlaylistSummary,
  options: PlaylistCreateOptions
): PlaylistCreateOutput {
  return {
    dryRun: false,
    id: playlist.id,
    ref: playlist.ref,
    name: playlist.name,
    ...(playlist.description === undefined ? {} : { description: playlist.description }),
    ...(playlist.url === undefined ? {} : { url: playlist.url }),
    owner: playlist.owner,
    public: playlist.public ?? options.public,
    collaborative: playlist.collaborative ?? options.collaborative
  }
}

function ensureRemovalCanProceed (
  ref: string,
  dryRun: boolean,
  yes: boolean,
  stdinIsTTY: boolean
): void {
  if (!dryRun && !yes && (ref === '-' || !stdinIsTTY)) {
    throw new UsageError('playlist remove requires --yes when stdin is not a terminal')
  }
}

async function resolveRemovalTarget (
  context: CommandContext,
  provider: Provider,
  resolve: PlaylistResolver,
  ref: string
): Promise<PlaylistSummary> {
  const stdinText = ref === '-' ? await readStdin(context.stdin) : ''
  const [resolvedRef] = resolvePlaylistArguments([ref], stdinText, context.stdinIsTTY, true)
  if (resolvedRef === undefined) throw new UsageError('Expected exactly one playlist')
  return await resolve(provider, resolvedRef)
}

interface ConfirmRemovalOptions {
  context: CommandContext
  confirm: PlaylistConfirmation | undefined
  provider: Provider
  playlist: PlaylistSummary
  action: PlaylistRemoveOutput['action']
  yes: boolean
  dryRun: boolean
}

async function confirmRemoval (options: ConfirmRemovalOptions): Promise<void> {
  const { context, confirm, provider, playlist, action, yes, dryRun } = options
  if (dryRun || !yes || !provider.capabilities.canDeletePlaylist) {
    writeCliMessage(context.stderr, getProviderNotice(provider), 'message')
  }
  if (dryRun || yes) return

  const verb = action === 'deleted' ? 'Delete' : 'Unfollow'
  const prompt = `${verb} playlist "${playlist.name}" (${playlist.id})? (y/n): `
  if (!await (confirm ?? confirmInTerminal)(context, prompt)) {
    throw new CommandAbortedError('Aborted; nothing was changed.')
  }
}

function writeCreateOutput (
  context: CommandContext,
  value: PlaylistCreateOutput,
  providerName: string
): void {
  switch (context.outputMode) {
    case 'json':
      context.stdout.write(formatJson(value))
      return
    case 'quiet':
      writeCreateQuiet(context, value)
      return
    case 'table':
      writeCreateTable(context, value, providerName)
      return
    default:
      writeCreateTsv(context, value, providerName)
  }
}

function writeCreateQuiet (context: CommandContext, value: PlaylistCreateOutput): void {
  if (!value.dryRun && value.id !== undefined) context.stdout.write(`${value.id}\n`)
}

function writeCreateTable (
  context: CommandContext,
  value: PlaylistCreateOutput,
  providerName: string
): void {
  const visibility = getVisibility(value)
  if (value.dryRun) {
    context.stdout.write(`[dry-run] Would create ${visibility} playlist "${value.name}" in ${providerName}\n`)
    return
  }
  const url = value.url === undefined ? '' : ` ${value.url}`
  context.stdout.write(`Created ${visibility} playlist "${value.name}" (${value.id ?? ''})${url}\n`)
}

function writeCreateTsv (
  context: CommandContext,
  value: PlaylistCreateOutput,
  providerName: string
): void {
  context.stdout.write(formatRows(
    [
      { key: 'id', label: 'id' },
      { key: 'name', label: 'name' },
      { key: 'url', label: 'url' }
    ],
    [{ id: value.dryRun ? '' : value.id ?? '', name: value.name, url: value.url ?? '' }],
    { stdoutIsTTY: false }
  ))
  if (value.dryRun) {
    writeCliMessage(context.stderr, `[dry-run] Would create ${getVisibility(value)} playlist "${value.name}" in ${providerName}`)
  }
}

function writeRemoveOutput (
  context: CommandContext,
  value: PlaylistRemoveOutput,
  providerName: string
): void {
  if (context.outputMode === 'json') {
    context.stdout.write(formatJson(value))
    return
  }
  if (context.outputMode === 'quiet') {
    context.stdout.write(`${value.playlist.id}\n`)
    return
  }
  if (context.outputMode === 'table') {
    const sentence = value.dryRun
      ? removeDryRunSentence(value, providerName)
      : `${capitalize(value.action)} playlist "${value.playlist.name}" (${value.playlist.id})`
    context.stdout.write(`${sentence}\n`)
    return
  }
  context.stdout.write(formatRows(
    [
      { key: 'action', label: 'action' },
      { key: 'id', label: 'id' },
      { key: 'name', label: 'name' }
    ],
    [{ action: value.action, id: value.playlist.id, name: value.playlist.name }],
    { stdoutIsTTY: false }
  ))
  if (value.dryRun) {
    writeCliMessage(context.stderr, removeDryRunSentence(value, providerName))
  }
}

function removeDryRunSentence (value: PlaylistRemoveOutput, providerName: string): string {
  const actionVerb = value.action === 'deleted' ? 'delete' : 'unfollow'
  return `[dry-run] Would ${actionVerb} playlist "${value.playlist.name}" (${value.playlist.id}) in ${providerName}`
}

function getVisibility (value: Pick<PlaylistCreateOutput, 'public' | 'collaborative'>): string {
  if (value.collaborative) return 'collaborative'
  return value.public ? 'public' : 'private'
}

function requireSingleName (positionals: string[]): string {
  if (positionals.length !== ONE_POSITIONAL || positionals[FIRST_POSITIONAL_INDEX]?.trim() === '') {
    throw new UsageError('Expected exactly one non-empty playlist name or ref')
  }
  return positionals[FIRST_POSITIONAL_INDEX] ?? ''
}

function getContextProvider (context: CommandContext): Provider {
  const provider = getRegisteredProviders({ config: context.config })
    .find(registered => registered.id === context.provider)
  if (provider === undefined) {
    throw new UsageError(`Provider "${context.provider}" is not available`)
  }
  return provider
}

function getProviderNotice (provider: Provider): string {
  if (provider.capabilities.canDeletePlaylist) {
    return `This permanently deletes the playlist from ${provider.displayName}.`
  }
  return `${provider.displayName} cannot delete playlists; this unfollows it (removes it from your library). Owned playlists can be restored from your ${provider.displayName} account page.`
}

async function confirmInTerminal (context: CommandContext, prompt: string): Promise<boolean> {
  const terminal = createInterface({
    input: context.stdin,
    output: context.stderr,
    terminal: context.stdinIsTTY
  })
  try {
    const answer = await terminal.question(prompt)
    return answer.trim().toLocaleLowerCase() === 'y' || answer.trim().toLocaleLowerCase() === 'yes'
  } finally {
    terminal.close()
  }
}

function capitalize (value: string): string {
  return `${value.charAt(FIRST_CHARACTER_INDEX).toLocaleUpperCase()}${value.slice(REST_INDEX)}`
}

class CommandAbortedError extends Error {
  readonly exitCode = EXIT_CODES.error
}
