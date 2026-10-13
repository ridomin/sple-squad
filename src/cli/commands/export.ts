import { UsageError } from '../../core/provider/errors.ts'
import type { Provider } from '../../core/provider/provider.ts'
import {
  createUnsupportedItemsWarning,
  serializePlaylistCSV,
  serializePlaylistJSON
} from '../../core/export/index.ts'
import type { CanonicalPlaylistFile } from '../../core/export/format.ts'
import type { ExportFormat } from '../../core/export/file-output.ts'
import {
  EXIT_CODES,
  PartialFailureError,
  formatErrorMessage,
  formatErrorOutput,
  getExitCode
} from '../exit-codes.ts'
import type { CommandContext, CommandDefinition } from '../args.ts'
import { writeCliMessage } from '../messages.ts'
import {
  assertLikedSongsReadable,
  readExportTask,
  resolveExportTasks
} from './export-reader.ts'
import type { ExportTask } from './export-reader.ts'
import {
  writeExportSummary,
  writeExports,
  writeFileModeOutput
} from './export-output.ts'
import type { ExportOutput, SkippedExport } from './export-output.ts'
import { resolveExportProvider } from './export-provider.ts'

const EMPTY_COUNT = 0
const ONE_COUNT = 1
const APPROXIMATE_LIKED_WARNING = 'Liked Songs export is approximate'

export type ExportProviderResolver = (context: CommandContext) => Provider

interface ValidatedOptions {
  all: boolean
  liked: boolean
  force: boolean
  format: ExportFormat
  outputPath?: string
}

interface CollectedExports {
  files: CanonicalPlaylistFile[]
  unsupportedCounts: number[]
  skipped: SkippedExport[]
  failures: unknown[]
}

interface PreparedExportRun {
  options: ValidatedOptions
  tasks: ExportTask[]
  userId?: string
}

export function createExportCommand (
  resolveProvider: ExportProviderResolver = resolveExportProvider
): CommandDefinition {
  return {
    path: ['export'],
    description: 'Export playlists as canonical JSON or CSV',
    helpText: 'Usage: sple export <playlist…|--all|--liked> [-o path] [--format json|csv] [--force]',
    options: {
      all: { type: 'boolean' },
      liked: { type: 'boolean' },
      output: { type: 'string', short: 'o' },
      format: { type: 'string' },
      force: { type: 'boolean' }
    },
    run: async context => {
      await runExport(context, resolveProvider(context))
    }
  }
}

async function runExport (context: CommandContext, provider: Provider): Promise<void> {
  const prepared = await prepareExportRun(context, provider)
  const { options, tasks } = prepared
  const collected = await collectExports({
    context,
    provider,
    tasks,
    ...(prepared.userId === undefined ? {} : { userId: prepared.userId }),
    reportFailures: options.all || tasks.length > ONE_COUNT
  })
  await writeCollectedExports(context, options, tasks, collected)
}

async function prepareExportRun (
  context: CommandContext,
  provider: Provider
): Promise<PreparedExportRun> {
  const options = validateOptions(context)
  validateOutputMode(context, options)
  const wantsLiked = options.liked || options.all && provider.capabilities.likedSongs.read !== 'none'
  if (wantsLiked) await assertLikedSongsReadable(provider)

  const tasks = await resolveExportTasks(context, provider, options)
  const distinctTasks = warnAndDeduplicateTasks(context, tasks)
  if (options.outputPath === undefined && distinctTasks.length !== ONE_COUNT) {
    throw new UsageError('Multiple sources require -o <directory>')
  }
  warnAboutApproximateLikedSongs(context, provider, wantsLiked)

  const authStatus = await provider.auth.status()
  return {
    options,
    tasks: distinctTasks,
    ...(authStatus.user?.id === undefined ? {} : { userId: authStatus.user.id })
  }
}

async function writeCollectedExports (
  context: CommandContext,
  options: ValidatedOptions,
  tasks: ExportTask[],
  collected: CollectedExports
): Promise<void> {
  const { failures } = collected
  throwAuthenticationOrQuotaFailure(failures)
  if (!options.all && tasks.length === ONE_COUNT && failures.length > EMPTY_COUNT) {
    const [failure] = failures
    if (failure instanceof Error) throw failure
  }

  if (options.outputPath === undefined) {
    writeStdoutExport(context, collected, options.format)
    return
  }

  const summaries = collected.files.length === EMPTY_COUNT && !options.all
    ? []
    : await writeExports({
    outputPath: options.outputPath,
    files: collected.files,
    unsupportedCounts: collected.unsupportedCounts,
    format: options.format,
    force: options.force,
    forceDirectory: options.all || tasks.length > ONE_COUNT,
    all: options.all,
    skipped: collected.skipped
  })
  const output: ExportOutput = { files: summaries, skipped: collected.skipped }
  writeFileModeOutput(context, output)
  writeExportSummary(context, output, tasks.length)
  throwPartialFailure(collected.failures, tasks.length)
}

function throwAuthenticationOrQuotaFailure (failures: unknown[]): void {
  const failure = failures.find(isAuthenticationOrQuotaFailure)
  if (failure === undefined) return
  if (failure instanceof Error) throw failure
  throw new Error(formatErrorMessage(failure))
}

function warnAndDeduplicateTasks (context: CommandContext, tasks: ExportTask[]): ExportTask[] {
  const seen = new Set<string>()
  const distinct: ExportTask[] = []
  for (const task of tasks) {
    const key = task.kind === 'liked'
      ? 'liked'
      : task.playlist?.ref
    if (key !== undefined && seen.has(key)) {
      writeCliMessage(context.stderr, `Playlist "${task.input}" resolves to a source already listed and will be exported once`, 'warning')
      continue
    }
    if (key !== undefined) seen.add(key)
    distinct.push(task)
  }
  return distinct
}

function validateOptions (context: CommandContext): ValidatedOptions {
  const { flags: { format, output, all: allFlag, liked: likedFlag, force: forceFlag }, positionals } = context
  const all = allFlag === true
  const liked = likedFlag === true
  validateSourceSelection(all, liked, positionals)
  const outputPath = getOutputPath(output)
  return {
    all,
    liked,
    force: forceFlag === true,
    format: validateFormat(format),
    ...(outputPath === undefined ? {} : { outputPath })
  }
}

function validateSourceSelection (all: boolean, liked: boolean, positionals: string[]): void {
  if (positionals.some(playlist => playlist.trim() === '')) {
    throw new UsageError('Playlist arguments must not be empty')
  }
  if (all && positionals.length > EMPTY_COUNT) {
    throw new UsageError('--all cannot be combined with playlist arguments')
  }
  if (liked && positionals.length > EMPTY_COUNT) {
    throw new UsageError('--liked cannot be combined with playlist arguments')
  }
  if (!all && !liked && positionals.length === EMPTY_COUNT) {
    throw new UsageError('Expected a playlist, --all, or --liked')
  }
}

function validateFormat (value: string | boolean | undefined): ExportFormat {
  if (value === undefined || value === 'json') return 'json'
  if (value === 'csv') return 'csv'
  throw new UsageError(`Unsupported export format: ${String(value)} (expected json or csv)`)
}

function getOutputPath (value: string | boolean | undefined): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new UsageError('-o requires a path')
  if (value.trim() === '') throw new UsageError('-o requires a non-empty path')
  return value
}

function validateOutputMode (context: CommandContext, options: ValidatedOptions): void {
  const { positionals } = context
  if (options.outputPath !== undefined) return
  if (options.all) throw new UsageError('--all requires -o <directory>')
  if (positionals.length > ONE_COUNT) {
    throw new UsageError('Multiple sources require -o <directory>')
  }
  if (context.global.json) {
    throw new UsageError('--json cannot be used when export data is written to stdout; use --format json')
  }
  if (options.force) throw new UsageError('--force requires -o <path>')
}

async function collectExports (options: {
  context: CommandContext
  provider: Provider
  tasks: ExportTask[]
  userId?: string
  reportFailures: boolean
}): Promise<CollectedExports> {
  const { context, provider, tasks, userId, reportFailures } = options
  const collected: CollectedExports = {
    files: [],
    unsupportedCounts: [],
    skipped: [],
    failures: []
  }
  for (const [index, task] of tasks.entries()) {
    try {
      // Exports are fetched in the command-line source order.
      // eslint-disable-next-line no-await-in-loop -- Item failures and summaries are reported in source order.
      const result = await readExportTask(provider, task, userId)
      collected.files.push(result.file)
      collected.unsupportedCounts.push(result.unsupportedCount)
      warnAboutUnsupportedItems(context, result.unsupportedCount)
    } catch (error) {
      addSkippedExport({ context, collected, task, error, reportFailure: reportFailures })
      if (isAuthenticationOrQuotaFailure(error)) {
        addRemainingAsSkipped({
          context,
          collected,
          remaining: tasks.slice(index + ONE_COUNT),
          error,
          reportFailure: reportFailures
        })
        break
      }
    }
  }
  return collected
}

function addSkippedExport (options: {
  context: CommandContext
  collected: CollectedExports
  task: ExportTask
  error: unknown
  reportFailure: boolean
}): void {
  const { context, collected, task, error, reportFailure } = options
  collected.failures.push(error)
  collected.skipped.push({ input: task.input, error: formatErrorOutput(error).error })
  if (reportFailure) {
    writeCliMessage(context.stderr, `Could not export "${task.input}": ${formatErrorMessage(error)}`, 'error')
  }
}

function addRemainingAsSkipped (options: {
  context: CommandContext
  collected: CollectedExports
  remaining: ExportTask[]
  error: unknown
  reportFailure: boolean
}): void {
  const { context, collected, remaining, error, reportFailure } = options
  for (const task of remaining) {
    collected.failures.push(error)
    collected.skipped.push({ input: task.input, error: formatErrorOutput(error).error })
    if (reportFailure) {
      writeCliMessage(context.stderr, `Could not export "${task.input}": ${formatErrorMessage(error)}`, 'error')
    }
  }
}

function writeStdoutExport (
  context: CommandContext,
  collected: CollectedExports,
  format: ExportFormat
): void {
  const { files, failures } = collected
  const [firstFile] = files
  if (firstFile === undefined) {
    const [firstFailure] = failures
    if (firstFailure instanceof Error) throw firstFailure
    if (firstFailure !== undefined) throw new Error(formatErrorMessage(firstFailure))
    throw new UsageError('No readable playlist was found to export')
  }
  context.stdout.write(format === 'json'
    ? serializePlaylistJSON(firstFile)
    : serializePlaylistCSV(firstFile))
}

function warnAboutUnsupportedItems (context: CommandContext, count: number): void {
  const warning = createUnsupportedItemsWarning(count)
  if (warning !== undefined) writeCliMessage(context.stderr, warning.message, 'warning')
}

function warnAboutApproximateLikedSongs (
  context: CommandContext,
  provider: Provider,
  wantsLiked: boolean
): void {
  const { capabilities } = provider
  const { likedSongs } = capabilities
  if (!wantsLiked || likedSongs.read !== 'approximate') return
  const { readCap: limit } = likedSongs
  const capMessage = limit === undefined ? '' : ` (up to ${limit} items)`
  writeCliMessage(context.stderr, `${APPROXIMATE_LIKED_WARNING}${capMessage}`, 'warning')
}

function throwPartialFailure (failures: unknown[], taskCount: number): void {
  if (failures.length === EMPTY_COUNT) return
  const [firstFailure] = failures
  if (taskCount === ONE_COUNT && firstFailure instanceof Error) throw firstFailure
  throw new PartialFailureError('Some playlists could not be exported', failures)
}

function isAuthenticationOrQuotaFailure (error: unknown): boolean {
  const exitCode = getExitCode(error)
  return exitCode === EXIT_CODES.authRequired || exitCode === EXIT_CODES.rateLimit
}
