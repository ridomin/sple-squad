import debug from 'debug'
import { format } from 'node:util'
import type { Writable } from 'node:stream'
import { redactSensitiveValues } from '../core/security/secrets.ts'
import { clearProgressIndicators } from './progress.ts'

const LOG_PREFIX = 'sple:'
const REDACTED = '[REDACTED]'
const SECRET_QUERY_KEYS = [
  'access_token',
  'refresh_token',
  'code',
  'code_verifier',
  'client_secret'
]
const SECRET_JSON_KEYS = ['access_token', 'refresh_token', 'id_token', 'client_secret']

export interface LoggerFlags {
  verbose: boolean
  debug: boolean
  debugEnv?: string
}

export type Logger = (message: string, ...args: unknown[]) => void

export function configureLogging (
  flags: LoggerFlags,
  stderr: Writable = process.stderr
): void {
  const patterns: string[] = []
  if (flags.debugEnv?.trim() !== undefined && flags.debugEnv.trim() !== '') {
    patterns.push(flags.debugEnv.trim())
  }
  if (flags.debug) patterns.push('sple:*')
  else if (flags.verbose) patterns.push('sple:*,-sple:http*')

  debug.log = (...args: unknown[]) => {
    clearProgressIndicators(stderr)
    const line = redactSecrets(format(...args))
    stderr.write(`${line}\n`)
  }
  debug.enable(patterns.join(','))
}

export function createLogger (namespace: string): Logger {
  const logger = debug(`${LOG_PREFIX}${namespace}`)
  return (message: string, ...args: unknown[]) => {
    logger(message, ...args)
  }
}

export function redactSecrets (value: string, knownSecrets: string[] = []): string {
  let result = redactSensitiveValues(value, knownSecrets)
  const bearerRedaction = ['Bearer', REDACTED].join(' ')
  result = result.replace(/\bBearer\s+\S+/giv, bearerRedaction)
  for (const key of SECRET_QUERY_KEYS) {
    const pattern = new RegExp(`\\b${key}=([^&\\s]+)`, 'giv')
    result = result.replace(pattern, `${key}=${REDACTED}`)
  }
  for (const key of SECRET_JSON_KEYS) {
    const pattern = new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`, 'giv')
    result = result.replace(pattern, `$1"${REDACTED}"`)
  }
  return result
}
