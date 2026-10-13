import { basename } from 'node:path'
import type { CanonicalPlaylistFile } from '../../core/export/format.ts'
import {
  createExportSummary,
  getExportFilename,
  prepareExportDirectoryTargets,
  prepareExportTargets,
  serializePlaylistCSV,
  serializePlaylistJSON,
  writeAtomicFile
} from '../../core/export/index.ts'
import type { ExportFormat } from '../../core/export/file-output.ts'
import type { CommandContext } from '../args.ts'
import { formatJson } from '../output.ts'
import { writeCliMessage } from '../messages.ts'

const EMPTY_COUNT = 0
const ONE_COUNT = 1
const INDEX_FILENAME = 'index.json'

export interface SkippedExport {
  input: string
  playlist?: { id: string, name: string }
  error: {
    type: string
    message: string
    exitCode: number
  }
}

export interface ExportOutput {
  files: Array<ReturnType<typeof createExportSummary>>
  skipped: SkippedExport[]
}

export interface WriteExportsOptions {
  outputPath: string
  files: CanonicalPlaylistFile[]
  unsupportedCounts: number[]
  format: ExportFormat
  force: boolean
  forceDirectory: boolean
  all: boolean
  skipped: SkippedExport[]
}

export async function writeExports (options: WriteExportsOptions): Promise<ExportOutput['files']> {
  const {
    outputPath,
    files,
    unsupportedCounts,
    format,
    force,
    forceDirectory,
    all,
    skipped
  } = options
  if (all) {
    return await writeAllExports({ outputPath, files, unsupportedCounts, format, force, skipped })
  }
  const targets = await prepareExportTargets(outputPath, files, format, { force, forceDirectory })
  return await writePlaylistFiles({ files, targets, unsupportedCounts, format, force })
}

export function writeFileModeOutput (context: CommandContext, output: ExportOutput): void {
  if (context.outputMode === 'json') {
    context.stdout.write(formatJson(output))
  } else if (context.outputMode === 'quiet') {
    for (const file of output.files) {
      if (file.path !== undefined) context.stdout.write(`${file.path}\n`)
    }
  }
}

export function writeExportSummary (
  context: CommandContext,
  output: ExportOutput,
  requestedCount: number
): void {
  if (context.outputMode === 'json' || context.outputMode === 'quiet') return
  const { skipped, files } = output
  const { length: skippedCount } = skipped
  const { length: exportedCount } = files
  const suffix = skippedCount === EMPTY_COUNT ? '' : `; ${skippedCount} skipped (see above)`
  writeCliMessage(
    context.stderr,
    `exported ${exportedCount} of ${requestedCount} playlists${suffix}`
  )
}

async function writeAllExports (
  options: Pick<WriteExportsOptions, 'outputPath' | 'files' | 'unsupportedCounts' | 'format' | 'force' | 'skipped'>
): Promise<ExportOutput['files']> {
  const { outputPath, files, unsupportedCounts, format, force, skipped } = options
  const filenames = files.map(file => getExportFilename(file, format))
  const targets = await prepareExportDirectoryTargets(outputPath, [...filenames, INDEX_FILENAME], { force })
  const fileTargets = targets.slice(EMPTY_COUNT, files.length)
  const indexTarget = targets.at(-ONE_COUNT)
  const summaries = await writePlaylistFiles({ files, targets: fileTargets, unsupportedCounts, format, force })
  if (indexTarget === undefined) throw new Error('Could not resolve export index target')
  const index = {
    files: summaries.map(summary => {
      const { path, format: fileFormat, source, trackCount, unsupportedCount } = summary
      return {
        path: basename(path ?? ''),
        format: fileFormat,
        source,
        trackCount,
        unsupportedCount
      }
    }),
    skipped: skipped.map(item => ({
      input: item.input,
      ...(item.playlist === undefined ? {} : { id: item.playlist.id, name: item.playlist.name }),
      status: 'skipped',
      reason: item.error.type === 'AccessRestrictedError' ? 'not-owned' : item.error.message,
      error: item.error
    }))
  }
  const indent = 2
  await writeAtomicFile(indexTarget, `${JSON.stringify(index, null, indent)}\n`, { force })
  return summaries
}

async function writePlaylistFiles (options: {
  files: CanonicalPlaylistFile[]
  targets: string[]
  unsupportedCounts: number[]
  format: ExportFormat
  force: boolean
}): Promise<ExportOutput['files']> {
  const { files, targets, unsupportedCounts, format, force } = options
  const summaries: ExportOutput['files'] = []
  for (const [index, file] of files.entries()) {
    const { [index]: target } = targets
    if (target === undefined) throw new Error('Could not resolve export target')
    // Files are written atomically in source order; a later failure preserves earlier completed exports.
    // eslint-disable-next-line no-await-in-loop -- Writes preserve the export order and partial-result contract.
    await writeAtomicFile(target, serialize(file, format), { force })
    summaries.push(createExportSummary(file, format, target, unsupportedCounts[index] ?? EMPTY_COUNT))
  }
  return summaries
}

function serialize (file: CanonicalPlaylistFile, format: ExportFormat): string {
  return format === 'json' ? serializePlaylistJSON(file) : serializePlaylistCSV(file)
}
