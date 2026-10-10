import { UsageError } from '../core/provider/errors.ts'
import type { Readable } from 'node:stream'

const NO_REFS = 0
const ONE_ARGUMENT = 1

export async function readStdin (input: Readable): Promise<string> {
  const chunks: string[] = []
  input.setEncoding('utf8')
  for await (const chunk of input) {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
  }
  return chunks.join('')
}

export function parsePlaylistStdin (input: string, stdinIsTTY: boolean): string[] {
  if (stdinIsTTY) throw new UsageError('Cannot read playlist refs from a terminal; pipe refs to stdin')
  const refs = input
    .split(/\r?\n/v)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
  if (refs.length === NO_REFS) throw new UsageError('No playlist refs were read from stdin')
  return refs
}

export function resolvePlaylistArguments (
  args: string[],
  stdinInput: string,
  stdinIsTTY: boolean,
  exactlyOne = false
): string[] {
  const { length: stdinCount } = args.filter(value => value === '-')
  if (stdinCount === NO_REFS) return args
  if (stdinCount > ONE_ARGUMENT || args.length !== ONE_ARGUMENT) {
    throw new UsageError('"-" cannot be combined with other playlist arguments')
  }
  const refs = parsePlaylistStdin(stdinInput, stdinIsTTY)
  if (exactlyOne && refs.length !== ONE_ARGUMENT) {
    throw new UsageError(`Expected exactly one playlist ref on stdin; received ${refs.length}`)
  }
  return refs
}
