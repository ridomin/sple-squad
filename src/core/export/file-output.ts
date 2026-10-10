import { randomUUID } from 'node:crypto'
import { link, mkdir, open, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import type { CanonicalPlaylistFile } from './format.ts'

export type ExportFormat = 'json' | 'csv'

export class ExportTargetError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'ExportTargetError'
  }
}

const EMPTY_LENGTH = 0
const SINGLE_SOURCE_COUNT = 1
const MAX_SLUG_LENGTH = 60

function hasTrailingSeparator (path: string): boolean {
  return path.endsWith(sep) || path.endsWith('/') || path.endsWith('\\')
}

function shouldUseDirectory (outputPath: string, sourceCount: number, existing: Awaited<ReturnType<typeof stat>> | null): boolean {
  return sourceCount > SINGLE_SOURCE_COUNT ||
    hasTrailingSeparator(outputPath) ||
    existing?.isDirectory() === true
}

async function pathStatOrNull (path: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function slugifyPlaylistName (name: string): string {
  const normalized = name.normalize('NFKD').replace(/\p{M}+/gv, '').toLowerCase()
  const separated = normalized.replace(/[^a-z0-9]+/gv, '-').replace(/^-+|-+$/gv, '')
  const limited = separated.slice(EMPTY_LENGTH, MAX_SLUG_LENGTH).replace(/-+$/gv, '')
  return limited.length === EMPTY_LENGTH ? 'playlist' : limited
}

function safeIdComponent (id: string): string {
  if (id.length === EMPTY_LENGTH) {
    throw new ExportTargetError('Cannot name an export file: playlist.id is empty')
  }

  // URI-encoding keeps provider IDs intact while ensuring separators and
  // other path-significant characters cannot escape the chosen directory.
  return encodeURIComponent(id)
}

function getTargets (absolutePath: string, files: CanonicalPlaylistFile[], format: ExportFormat, directoryExpected: boolean): string[] {
  return directoryExpected
    ? files.map((file) => join(absolutePath, getExportFilename(file, format)))
    : [absolutePath]
}

function assertDistinctTargets (targets: string[]): void {
  const collisionKeys = targets.map((target) => process.platform === 'win32' ? target.toLowerCase() : target)
  if (new Set(collisionKeys).size !== targets.length) {
    throw new ExportTargetError(`Multiple playlists resolve to the same export target: ${targets.join(', ')}`)
  }
}

async function assertFileParentExists (filePath: string): Promise<void> {
  const parentPath = dirname(filePath)
  const parent = await pathStatOrNull(parentPath)
  if (parent?.isDirectory() !== true) {
    throw new ExportTargetError(`Export parent directory does not exist: ${parentPath}`)
  }
}

async function assertNoExistingTargets (targets: string[]): Promise<void> {
  const existingTargets = await Promise.all(targets.map(async (target) => await pathStatOrNull(target) === null ? null : target))
  const collisions = existingTargets.filter((target): target is string => target !== null)
  if (collisions.length > EMPTY_LENGTH) {
    throw new ExportTargetError(`Export target already exists; use --force to overwrite: ${collisions.join(', ')}`)
  }
}

/** Return the ADR-0007 A8 filename for a playlist or Liked Songs export. */
export function getExportFilename (file: CanonicalPlaylistFile, format: ExportFormat): string {
  const extension = format === 'json' ? 'json' : 'csv'
  if (file.source.kind === 'liked') {
    return `liked-songs.${extension}`
  }
  if (file.playlist.id === undefined) {
    throw new ExportTargetError('Cannot name an export file: playlist.id is required')
  }
  return `${slugifyPlaylistName(file.playlist.name)}-${safeIdComponent(file.playlist.id)}.${extension}`
}

/**
 * Resolve output targets and preflight overwrite protection before any file
 * content is written. A single non-directory `outputPath` denotes a file;
 * multiple sources or a directory path produce one named file per source.
 */
export async function prepareExportTargets (
  outputPath: string,
  files: CanonicalPlaylistFile[],
  format: ExportFormat,
  force = false
): Promise<string[]> {
  if (files.length === EMPTY_LENGTH) {
    throw new ExportTargetError('At least one playlist is required for export')
  }

  const absolutePath = resolve(outputPath)
  const existing = await pathStatOrNull(absolutePath)
  const directoryExpected = shouldUseDirectory(outputPath, files.length, existing)

  if (directoryExpected && existing !== null && !existing.isDirectory()) {
    throw new ExportTargetError(`Export destination is not a directory: ${absolutePath}`)
  }

  const targets = getTargets(absolutePath, files, format, directoryExpected)
  const absoluteTargets = targets.map((target) => isAbsolute(target) ? target : resolve(target))
  assertDistinctTargets(absoluteTargets)

  if (directoryExpected) {
    await mkdir(absolutePath, { recursive: true })
  } else {
    await assertFileParentExists(absolutePath)
  }

  if (!force) {
    await assertNoExistingTargets(absoluteTargets)
  }

  return absoluteTargets
}

export interface AtomicWriteOptions {
  force?: boolean
}

/**
 * Atomically write a file using a temporary sibling. Without force, a hard
 * link installs the complete file only if the destination is still absent,
 * closing the race after target preflight.
 */
export async function writeAtomicFile (
  filePath: string,
  content: string,
  options: AtomicWriteOptions = {}
): Promise<string> {
  const absolutePath = resolve(filePath)
  const directory = dirname(absolutePath)
  const temporaryPath = join(directory, `.${basename(absolutePath)}.${randomUUID()}.tmp`)
  await assertFileParentExists(absolutePath)

  let ownsTemporary = false
  try {
    const fileHandle = await open(temporaryPath, 'wx')
    ownsTemporary = true
    try {
      await fileHandle.writeFile(content, 'utf8')
    } finally {
      await fileHandle.close()
    }

    if (options.force === true) {
      await rename(temporaryPath, absolutePath)
    } else {
      try {
        await link(temporaryPath, absolutePath)
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
          throw new ExportTargetError(`Export target already exists; use --force to overwrite: ${absolutePath}`)
        }
        throw error
      }
      await unlink(temporaryPath).catch(() => undefined)
    }
    ownsTemporary = false
    return absolutePath
  } finally {
    if (ownsTemporary) {
      await unlink(temporaryPath).catch(() => undefined)
    }
  }
}
