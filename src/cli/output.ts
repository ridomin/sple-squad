import { UsageError } from '../core/provider/errors.ts'

export type OutputMode = 'json' | 'quiet' | 'table' | 'tsv'

export interface OutputColumn {
  key: string
  label: string
  flexible?: boolean
}

export interface OutputOptions {
  stdoutIsTTY: boolean
  columns?: number
  noColor?: boolean
}

export interface FormatOutputOptions {
  mode: OutputMode
  value: unknown
  columns?: OutputColumn[]
  rows?: Array<Record<string, unknown>>
  quietIds?: string[]
  outputOptions?: OutputOptions
}

const DEFAULT_TERMINAL_WIDTH = 80
const ELLIPSIS = '…'
const ANSI_BOLD = '\u001b[1m'
const ANSI_RESET = '\u001b[0m'
const MIN_FLEXIBLE_WIDTH = 3
const COLUMN_GAP = 2
const EMPTY_COUNT = 0
const FIRST_CHARACTER = 0
const INITIAL_WIDTH = 0
const ELLIPSIS_WIDTH = 1
const COLUMN_INDEX_OFFSET = 1

export function selectOutputMode (
  json: boolean,
  quiet: boolean,
  stdoutIsTTY: boolean
): OutputMode {
  if (json && quiet) throw new UsageError('--json and --quiet cannot be used together')
  if (json) return 'json'
  if (quiet) return 'quiet'
  return stdoutIsTTY ? 'table' : 'tsv'
}

export function formatJson (value: unknown): string {
  return `${JSON.stringify(value, null, COLUMN_GAP)}\n`
}

export function formatRows (
  columns: OutputColumn[],
  rows: Array<Record<string, unknown>>,
  options: OutputOptions
): string {
  if (rows.length === EMPTY_COUNT) return ''
  const values = rows.map(row => columns.map(column =>
    displayValue(row[column.key], options.stdoutIsTTY)
  ))
  if (!options.stdoutIsTTY) return formatTsv(values)
  const widths = fitColumnWidths(columns, values, options.columns ?? DEFAULT_TERMINAL_WIDTH)
  return formatTable(columns, values, widths, shouldUseColor(options.noColor))
}

export function formatQuiet (ids: string[]): string {
  return ids.length === EMPTY_COUNT ? '' : `${ids.join('\n')}\n`
}

export function formatOutput (options: FormatOutputOptions): string {
  const { mode, value, columns, rows, quietIds, outputOptions } = options
  if (mode === 'json') return formatJson(value)
  if (mode === 'quiet') return formatQuiet(quietIds ?? [])
  if (columns === undefined || rows === undefined) {
    throw new TypeError('Table/TSV output requires columns and rows')
  }
  return formatRows(columns, rows, outputOptions ?? { stdoutIsTTY: false })
}

function formatTsv (rows: string[][]): string {
  return `${rows.map(row => row.map(cleanTsv).join('\t')).join('\n')}\n`
}

function fitColumnWidths (
  columns: OutputColumn[],
  values: string[][],
  terminalWidth: number
): number[] {
  const widths = columns.map((column, index) => Math.max(
    column.label.length,
    ...values.map(row => row[index]?.length ?? EMPTY_COUNT)
  ))
  return shrinkFlexibleColumns(columns, widths, terminalWidth)
}

function shrinkFlexibleColumns (
  columns: OutputColumn[],
  widths: number[],
  terminalWidth: number
): number[] {
  const adjustedWidths = [...widths]
  let overflow = totalWidth(adjustedWidths) - terminalWidth
  if (overflow <= EMPTY_COUNT) return adjustedWidths
  const flexible = columns
    .map((column, index) => ({ column, index }))
    .filter(item => item.column.flexible === true &&
      (adjustedWidths[item.index] ?? EMPTY_COUNT) > MIN_FLEXIBLE_WIDTH)
    .sort((left, right) =>
      (adjustedWidths[right.index] ?? EMPTY_COUNT) - (adjustedWidths[left.index] ?? EMPTY_COUNT)
    )
  for (const item of flexible) {
    const currentWidth = adjustedWidths[item.index] ?? EMPTY_COUNT
    const available = currentWidth - MIN_FLEXIBLE_WIDTH
    const shrinkBy = Math.min(overflow, available)
    adjustedWidths[item.index] = currentWidth - shrinkBy
    overflow -= shrinkBy
    if (overflow <= EMPTY_COUNT) return adjustedWidths
  }
  return adjustedWidths
}

function formatTable (
  columns: OutputColumn[],
  rows: string[][],
  widths: number[],
  useColor: boolean
): string {
  const bold = useColor ? ANSI_BOLD : ''
  const reset = useColor ? ANSI_RESET : ''
  const header = columns.map((column, index) => {
    const width = widths.at(index) ?? column.label.length
    return pad(column.flexible === true ? truncate(column.label, width) : column.label, width)
  }).join('  ').trimEnd()
  const output = [`${bold}${header}${reset}`]
  for (const row of rows) {
    output.push(row.map((value, index) => {
      const width = widths.at(index) ?? value.length
      const column = columns.at(index)
      return pad(column?.flexible === true ? truncate(value, width) : value, width)
    }).join('  ').trimEnd())
  }
  return `${output.join('\n')}\n`
}

function totalWidth (widths: number[]): number {
  const separators = Math.max(EMPTY_COUNT, widths.length - COLUMN_INDEX_OFFSET) * COLUMN_GAP
  return widths.reduce((sum, width) => sum + width, INITIAL_WIDTH) + separators
}

function displayValue (value: unknown, humanReadable: boolean): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) {
    return value.map(item => displayValue(item, humanReadable)).join(', ')
  }
  return displayPrimitive(value, humanReadable)
}

function displayPrimitive (value: unknown, humanReadable: boolean): string {
  if (typeof value === 'boolean') return humanReadable ? (value ? 'yes' : 'no') : `${value}`
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)
  if (typeof value === 'string' || typeof value === 'number') return `${value}`
  if (typeof value === 'bigint' || typeof value === 'symbol') return value.toString()
  return ''
}

function cleanTsv (value: string): string {
  return value.replace(/[\t\r\n]/gv, ' ')
}

function truncate (value: string, width: number): string {
  if (value.length <= width) return value
  if (width <= ELLIPSIS_WIDTH) return ELLIPSIS
  return `${value.slice(FIRST_CHARACTER, width - ELLIPSIS_WIDTH)}${ELLIPSIS}`
}

function pad (value: string, width: number): string {
  return value.padEnd(width, ' ')
}

function shouldUseColor (noColor: boolean | undefined): boolean {
  if (noColor === true) return false
  return process.env.NO_COLOR === undefined || process.env.NO_COLOR === ''
}
