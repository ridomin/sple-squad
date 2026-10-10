import type { Writable } from 'node:stream'
import type { OutputMode } from './output.ts'

const MIN_UPDATE_INTERVAL_MS = 100
const PROGRESS_BAR_WIDTH = 10
const BLOCK = '#'
const EMPTY = '-'
const SPINNER = ['|', '/', '-', '\\']
const MIN_RATIO = 0
const MAX_RATIO = 1
const FIRST_SPINNER_INDEX = 0
const COUNTER_INCREMENT = 1
const EMPTY_SET_SIZE = 0
const activeProgress = new WeakMap<Writable, Set<ProgressIndicator>>()

export interface ProgressOptions {
  stderr: Writable
  stderrIsTTY: boolean
  enabled?: boolean
  mode?: OutputMode
  now?: () => number
}

export class ProgressIndicator {
  private readonly options: ProgressOptions
  private readonly enabled: boolean
  private readonly now: () => number
  private lastUpdate = Number.NEGATIVE_INFINITY
  private spinnerIndex = FIRST_SPINNER_INDEX
  private active = false

  constructor (options: ProgressOptions) {
    this.options = options
    this.enabled = options.stderrIsTTY &&
      options.enabled !== false &&
      options.mode !== 'json' &&
      options.mode !== 'quiet'
    this.now = options.now ?? Date.now
  }

  update (label: string, current: number, total?: number): void {
    if (!this.enabled) return
    const now = this.now()
    if (now - this.lastUpdate < MIN_UPDATE_INTERVAL_MS) return
    this.lastUpdate = now
    this.active = true
    registerProgress(this.options.stderr, this)
    const message = total !== undefined && total > MIN_RATIO
      ? `${label} [${progressBar(current, total)}] ${current}/${total}`
      : `${label} ${SPINNER[this.spinnerIndex % SPINNER.length]} ${current}`
    this.spinnerIndex += COUNTER_INCREMENT
    this.options.stderr.write(`\r${message}`)
  }

  clear (): void {
    if (!this.active) return
    this.options.stderr.write('\r\u001b[2K')
    this.active = false
    unregisterProgress(this.options.stderr, this)
  }

  finish (): void {
    this.clear()
  }
}

export function clearProgressIndicators (stderr: Writable): void {
  const indicators = activeProgress.get(stderr)
  if (indicators === undefined) return
  for (const indicator of indicators) indicator.clear()
}

function registerProgress (stderr: Writable, indicator: ProgressIndicator): void {
  const indicators = activeProgress.get(stderr) ?? new Set<ProgressIndicator>()
  indicators.add(indicator)
  activeProgress.set(stderr, indicators)
}

function unregisterProgress (stderr: Writable, indicator: ProgressIndicator): void {
  const indicators = activeProgress.get(stderr)
  if (indicators === undefined) return
  indicators.delete(indicator)
  if (indicators.size === EMPTY_SET_SIZE) activeProgress.delete(stderr)
}

function progressBar (current: number, total: number): string {
  const ratio = Math.max(MIN_RATIO, Math.min(MAX_RATIO, current / total))
  const complete = Math.round(ratio * PROGRESS_BAR_WIDTH)
  return BLOCK.repeat(complete) + EMPTY.repeat(PROGRESS_BAR_WIDTH - complete)
}
