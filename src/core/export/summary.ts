import type { CanonicalPlaylistFile, UnsupportedItem } from './format.ts'
import type { ExportFormat } from './file-output.ts'

export interface ExportSummary {
  path?: string
  format: ExportFormat
  source: { kind: 'playlist' | 'liked'; id?: string; name: string }
  trackCount: number
  unsupportedCount: number
}

export interface UnsupportedItemsWarning {
  count: number
  message: string
}

const ZERO_COUNT = 0
const ONE_COUNT = 1

/** Build the file-mode metadata shape expected by ADR-0007 §3.6. */
export function createExportSummary (
  file: CanonicalPlaylistFile,
  format: ExportFormat,
  path?: string,
  unsupportedCount = file.unsupportedItems.length
): ExportSummary {
  return {
    ...(path === undefined ? {} : { path }),
    format,
    source: {
      kind: file.source.kind,
      ...(file.playlist.id === undefined ? {} : { id: file.playlist.id }),
      name: file.playlist.name
    },
    trackCount: file.tracks.length,
    unsupportedCount
  }
}

/** Return stderr warning data for items omitted by playlist retrieval. */
export function createUnsupportedItemsWarning (
  itemsOrCount: UnsupportedItem[] | number
): UnsupportedItemsWarning | undefined {
  const count = typeof itemsOrCount === 'number' ? itemsOrCount : itemsOrCount.length
  if (!Number.isInteger(count) || count < ZERO_COUNT) {
    throw new RangeError('Unsupported item count must be a non-negative integer')
  }
  if (count === ZERO_COUNT) {
    return undefined
  }

  const noun = count === ONE_COUNT ? 'item' : 'items'
  return {
    count,
    message: `sple: warning: skipped ${count} unsupported ${noun} and were not exported`
  }
}
