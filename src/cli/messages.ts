import type { Writable } from 'node:stream'
import { clearProgressIndicators } from './progress.ts'
import { redactSecrets } from './logger.ts'

export type MessageKind = 'error' | 'warning' | 'message'

export function writeCliMessage (
  stderr: Writable,
  message: string,
  kind: MessageKind = 'message'
): void {
  clearProgressIndicators(stderr)
  const prefix = kind === 'warning'
    ? 'sple: warning:'
    : kind === 'error'
      ? 'sple:'
      : 'sple:'
  stderr.write(`${prefix} ${redactSecrets(message)}\n`)
}
