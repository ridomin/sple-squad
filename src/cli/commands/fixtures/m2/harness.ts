import assert from 'node:assert/strict'
import { PassThrough, Writable } from 'node:stream'
import type { CommandDefinition } from '../../../args.ts'
import { runCli, type CliIO } from '../../../framework.ts'

class Capture extends Writable {
  text = ''
  override _write (chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.text += chunk.toString()
    callback()
  }
}

export type CapturedIO = CliIO & { stdin: PassThrough, stdout: Capture, stderr: Capture }

export function createIO (stdinText?: string): CapturedIO {
  const stdin = new PassThrough()
  if (stdinText !== undefined) stdin.end(stdinText)
  return { stdin, stdout: new Capture(), stderr: new Capture(), stdoutIsTTY: false, stderrIsTTY: false, stdinIsTTY: false }
}

export async function runCommands (
  commands: CommandDefinition[],
  argv: string[],
  options: { stdinText?: string } = {}
): Promise<{ code: number, io: CapturedIO }> {
  const io = createIO(options.stdinText)
  const code = await runCli(argv, { commands, io, processEnv: { SPLE_DEFAULT_PROVIDER: 'fake' } })
  return { code, io }
}

export function asRecord (value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value), 'expected a JSON object')
  return Object.fromEntries(Object.entries(value))
}

export function asArray (value: unknown): unknown[] {
  assert.ok(Array.isArray(value), 'expected a JSON array')
  return value
}

export function parseJsonRecord (text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text)
  return asRecord(parsed)
}
