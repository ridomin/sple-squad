import type { PlaylistSummary } from '../../core/provider/provider.ts'
import { UsageError } from '../../core/provider/errors.ts'
import type { CommandContext, CommandDefinition } from '../args.ts'
import { formatJson, formatRows } from '../output.ts'
import { writeCliMessage } from '../messages.ts'
import { readStdin, resolvePlaylistArguments } from '../stdin.ts'
import type { ContextProvider, PlaylistResolver } from './playlist-mutations.ts'

const ONE_POSITIONAL = 1
const EDIT_HELP = [
  'Usage: sple playlist edit <playlist|-> [--name <text>] [--description <text>] [--public | --private] [--dry-run]',
  '',
  'Change a playlist name, description, or visibility. <playlist> is an ID, URI, URL, or name.',
  'At least one of --name, --description, --public, --private is required.'
].join('\n')

interface PlaylistPatch { name?: string, description?: string, public?: boolean }
const NO_CHANGES = 0

export interface PlaylistEditOutput {
  dryRun: boolean
  playlist: { id: string, ref: string, name: string }
  changes: PlaylistPatch
}

export interface PlaylistEditDependencies {
  resolvePlaylist: PlaylistResolver
  getProvider: ContextProvider
}

export function createPlaylistEditCommand (dependencies: PlaylistEditDependencies): CommandDefinition {
  return {
    path: ['playlist', 'edit'],
    description: 'Edit a playlist name, description, or visibility',
    helpText: EDIT_HELP,
    options: {
      name: { type: 'string' },
      description: { type: 'string', short: 'd' },
      public: { type: 'boolean' },
      private: { type: 'boolean' },
      'dry-run': { type: 'boolean' }
    },
    run: async context => {
      await runPlaylistEdit(context, dependencies)
    }
  }
}

async function runPlaylistEdit (context: CommandContext, dependencies: PlaylistEditDependencies): Promise<void> {
  const patch = readPatch(context.flags)
  const provider = dependencies.getProvider(context)
  const input = await readPlaylistInput(context)
  const { updatePlaylist } = provider
  if (updatePlaylist === undefined) {
    throw new UsageError(`${provider.displayName} does not support editing playlists`)
  }

  const playlist = await dependencies.resolvePlaylist(provider, input)
  if (!playlist.owned) {
    throw new UsageError(`Cannot edit "${playlist.name}": it is not owned by you on ${provider.displayName}`)
  }

  const dryRun = context.flags['dry-run'] === true
  const target = { id: playlist.id, ref: playlist.ref, name: playlist.name }
  if (dryRun) {
    writeOutput(context, { dryRun, playlist: target, changes: patch }, provider.displayName)
    return
  }

  const updated: PlaylistSummary = await updatePlaylist(playlist.ref, patch)
  writeOutput(context, {
    dryRun,
    playlist: { id: updated.id, ref: updated.ref, name: updated.name },
    changes: patch
  }, provider.displayName)
}

function readPatch (flags: CommandContext['flags']): PlaylistPatch {
  const { name, description, public: publicFlag, private: privateFlag } = flags
  if (publicFlag === true && privateFlag === true) {
    throw new UsageError('--public and --private cannot be used together')
  }
  const patch: PlaylistPatch = {
    ...readText(name, '--name', true),
    ...readText(description, '--description', false),
    ...(publicFlag === true ? { public: true } : {}),
    ...(privateFlag === true ? { public: false } : {})
  }
  if (Object.keys(patch).length === NO_CHANGES) {
    throw new UsageError('playlist edit requires at least one of --name, --description, --public, --private')
  }
  return patch
}

function readText (
  value: string | boolean | undefined,
  flag: '--name' | '--description',
  nonEmpty: boolean
): { name?: string } | { description?: string } {
  if (value === undefined) return {}
  if (typeof value !== 'string' || (nonEmpty && value.trim() === '')) {
    throw new UsageError(`${flag} requires ${nonEmpty ? 'non-empty ' : ''}text`)
  }
  return flag === '--name' ? { name: value } : { description: value }
}

async function readPlaylistInput (context: CommandContext): Promise<string> {
  const { positionals } = context
  const [ref] = positionals
  if (positionals.length !== ONE_POSITIONAL || ref === undefined || ref.trim() === '') {
    throw new UsageError('Expected exactly one playlist')
  }
  const stdinText = ref === '-' ? await readStdin(context.stdin) : ''
  const [resolved] = resolvePlaylistArguments([ref], stdinText, context.stdinIsTTY, true)
  if (resolved === undefined) throw new UsageError('Expected exactly one playlist')
  return resolved
}

function describeChanges (changes: PlaylistPatch): string {
  const parts: string[] = []
  if (changes.name !== undefined) parts.push(`name to "${changes.name}"`)
  if (changes.description !== undefined) parts.push('description')
  if (changes.public !== undefined) parts.push(changes.public ? 'visibility to public' : 'visibility to private')
  return parts.join(', ')
}

function writeOutput (context: CommandContext, value: PlaylistEditOutput, providerName: string): void {
  const { playlist, changes, dryRun } = value
  const sentence = dryRun
    ? `[dry-run] Would update playlist "${playlist.name}" (${playlist.id}) in ${providerName}: ${describeChanges(changes)}`
    : `Updated playlist "${playlist.name}" (${playlist.id}): ${describeChanges(changes)}`
  switch (context.outputMode) {
    case 'json':
      context.stdout.write(formatJson(value))
      return
    case 'quiet':
      context.stdout.write(`${playlist.id}\n`)
      return
    case 'table':
      context.stdout.write(`${sentence}\n`)
      return
    default:
      context.stdout.write(formatRows(
        [{ key: 'id', label: 'id' }, { key: 'name', label: 'name' }],
        [{ id: playlist.id, name: playlist.name }],
        { stdoutIsTTY: false }
      ))
      if (dryRun) writeCliMessage(context.stderr, sentence)
  }
}

