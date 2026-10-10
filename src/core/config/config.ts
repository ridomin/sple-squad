// Config precedence resolution (ADR 0004 §1, CLI-6): flags > process
// environment > `.env` file > built-in defaults. `loadConfigFromDisk` merges
// `.env` values into `process.env` without overriding already-set variables.
// See `env-file.ts` for the `.env` permission check.
import { readFile } from 'node:fs/promises'
import { getConfigFilePath, type PlatformEnv } from './paths.ts'
import { checkEnvFilePermissions } from './env-file.ts'
import type { ProviderId } from './types.ts'
import { registerSensitiveValue } from '../security/secrets.ts'

const DEFAULT_PROVIDER: ProviderId = 'spotify'
const VALID_PROVIDER_IDS: readonly ProviderId[] = ['spotify', 'youtube-music', 'fake']
const ENV_FILE_NAME = '.env'
const FAKE_PROVIDER_ENABLED_VALUE = '1'
const EMPTY_LENGTH = 0
const USAGE_ERROR_EXIT_CODE = 2

export const ENV_VAR_SPOTIFY_CLIENT_ID = 'SPLE_SPOTIFY_CLIENT_ID'
export const ENV_VAR_YOUTUBE_MUSIC_CLIENT_ID = 'SPLE_YOUTUBE_MUSIC_CLIENT_ID'
export const ENV_VAR_GOOGLE_CLIENT_SECRET = 'SPLE_GOOGLE_CLIENT_SECRET'
export const ENV_VAR_DEFAULT_PROVIDER = 'SPLE_DEFAULT_PROVIDER'
export const ENV_VAR_ENABLE_FAKE_PROVIDER = 'SPLE_ENABLE_FAKE_PROVIDER'

// A command-level usage error (ADR 0004 §1, ADR 0007): exits with code 2.
export class UsageError extends Error {
  readonly exitCode = USAGE_ERROR_EXIT_CODE
  constructor (message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

export interface SpleConfig {
  defaultProvider: ProviderId
  spotifyClientId: string | null
  youtubeMusicClientId: string | null
  googleClientSecret: string | null
  enableFakeProvider: boolean
}

export interface ResolveConfigOptions {
  // The `--provider` CLI flag value, if given; the only flag CLI-6 defines
  // today. Wins over everything else.
  cliProvider?: string
  // Defaults to `process.env`; override in tests to avoid reading/mutating
  // globals. Expected to already contain any `.env` values merged in by
  // `loadConfigFromDisk`.
  processEnv?: NodeJS.ProcessEnv
}

function isValidProviderId (value: string): value is ProviderId {
  return (VALID_PROVIDER_IDS as readonly string[]).includes(value)
}

function isSetValue (value: string | undefined): value is string {
  return value !== undefined && value.trim().length > EMPTY_LENGTH
}

// Looks up `key` in the process environment; an empty/whitespace-only value
// counts as unset (ADR 0004 §1).
function pickEnvValue (key: string, processEnv: NodeJS.ProcessEnv): string | undefined {
  const { [key]: value } = processEnv
  return isSetValue(value) ? value.trim() : undefined
}

function resolveRequestedProvider (
  cliProvider: string | undefined,
  processEnv: NodeJS.ProcessEnv
): ProviderId {
  const fromFlag = isSetValue(cliProvider) ? cliProvider.trim() : undefined
  const requested = fromFlag ?? pickEnvValue(ENV_VAR_DEFAULT_PROVIDER, processEnv) ?? DEFAULT_PROVIDER

  if (!isValidProviderId(requested)) {
    throw new UsageError(
      `Invalid provider "${requested}" (expected one of: ${VALID_PROVIDER_IDS.join(', ')})`
    )
  }
  return requested
}

// Merges config sources per CLI-6 precedence: CLI flag > process env >
// default. (The `.env` file is folded into `processEnv` beforehand by
// `loadConfigFromDisk`.) Empty/whitespace-only values
// count as unset (ADR 0004 §1).
export function resolveConfig (options: ResolveConfigOptions = {}): SpleConfig {
  const { cliProvider, processEnv = process.env } = options
  const pick = (key: string): string | undefined => pickEnvValue(key, processEnv)
  const config: SpleConfig = {
    defaultProvider: resolveRequestedProvider(cliProvider, processEnv),
    spotifyClientId: pick(ENV_VAR_SPOTIFY_CLIENT_ID) ?? null,
    youtubeMusicClientId: pick(ENV_VAR_YOUTUBE_MUSIC_CLIENT_ID) ?? null,
    googleClientSecret: pick(ENV_VAR_GOOGLE_CLIENT_SECRET) ?? null,
    enableFakeProvider: pick(ENV_VAR_ENABLE_FAKE_PROVIDER) === FAKE_PROVIDER_ENABLED_VALUE
  }
  registerSensitiveValue(config.spotifyClientId)
  registerSensitiveValue(config.youtubeMusicClientId)
  registerSensitiveValue(config.googleClientSecret)
  return config
}

export interface LoadConfigFromDiskOptions {
  cliProvider?: string
  processEnv?: NodeJS.ProcessEnv
  // Overrides the resolved `.env` path; used by tests to avoid touching the
  // real user config directory.
  envFilePath?: string
  platformEnv?: PlatformEnv
}

export interface LoadConfigResult {
  config: SpleConfig
  // Non-fatal messages for the CLI to print to stderr (ADR 0004 §1,
  // Amendment 1): a load failure or a too-permissive `.env` file.
  warnings: string[]
}

function isErrnoException (err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/v
const ENV_LINE_SEPARATOR = /\r?\n/v
const MINIMUM_SEPARATOR_INDEX = 1
const FIRST_LINE_NUMBER = 1
const FIRST_CHARACTER_AFTER_QUOTE = 1
const QUOTED_VALUE_MINIMUM_LENGTH = 2

function envSyntaxError (message: string, lineNumber: number): never {
  throw new SyntaxError(`${message} on line ${lineNumber}`)
}

function parseEnvValue (value: string, lineNumber: number): string {
  const trimmedValue = value.trim()
  const startsWithQuote = trimmedValue.startsWith('"') || trimmedValue.startsWith("'")
  const endsWithQuote = trimmedValue.endsWith('"') || trimmedValue.endsWith("'")
  if (startsWithQuote) {
    if (
      trimmedValue.length < QUOTED_VALUE_MINIMUM_LENGTH ||
      !trimmedValue.endsWith(trimmedValue.charAt(EMPTY_LENGTH))
    ) {
      envSyntaxError('Unclosed quote in .env entry', lineNumber)
    }
    return trimmedValue.slice(FIRST_CHARACTER_AFTER_QUOTE, -FIRST_CHARACTER_AFTER_QUOTE)
  }
  if (endsWithQuote) {
    envSyntaxError('Unclosed quote in .env entry', lineNumber)
  }
  return trimmedValue
}

function parseEnvLine (rawLine: string, lineNumber: number): [string, string] | null {
  const line = rawLine.trim()
  if (line.length === EMPTY_LENGTH || line.startsWith('#')) return null

  const separatorIndex = line.indexOf('=')
  if (separatorIndex < MINIMUM_SEPARATOR_INDEX) {
    envSyntaxError('Invalid .env entry', lineNumber)
  }

  const key = line.slice(EMPTY_LENGTH, separatorIndex).trim()
  if (!ENV_KEY_PATTERN.test(key)) {
    envSyntaxError('Invalid .env variable name', lineNumber)
  }

  const value = parseEnvValue(line.slice(separatorIndex + MINIMUM_SEPARATOR_INDEX), lineNumber)
  return [key, value]
}

export function parseEnvFile (contents: string): Array<[string, string]> {
  const variables: Array<[string, string]> = []
  for (const [index, rawLine] of contents.split(ENV_LINE_SEPARATOR).entries()) {
    const variable = parseEnvLine(rawLine, index + FIRST_LINE_NUMBER)
    if (variable !== null) variables.push(variable)
  }
  return variables
}

// Loads the supported .env syntax into the supplied environment without
// overriding variables already set there. Parsing the file ourselves keeps
// loading available across the declared Node >=20 range.
async function loadEnvFileVars (
  envFilePath: string,
  environment: NodeJS.ProcessEnv
): Promise<string[]> {
  const warnings: string[] = []
  const contents = await readFile(envFilePath, 'utf8').catch((err: unknown): null => {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      // Missing file is not an error (ADR 0004 §3).
      return null
    }
    const reason = err instanceof Error ? err.message : String(err)
    warnings.push(`Failed to load .env: ${reason}`)
    return null
  })
  if (contents === null) return warnings

  const variables = parseEnvFile(contents)
  const missingVariables = new Map<string, string>()
  for (const [key, value] of variables) {
    if (environment[key] === undefined && !missingVariables.has(key)) {
      missingVariables.set(key, value)
    }
  }
  Object.assign(environment, Object.fromEntries(missingVariables))
  const permissionWarning = await checkEnvFilePermissions(envFilePath)
  if (permissionWarning !== null) {
    warnings.push(permissionWarning)
  }
  return warnings
}

// Loads `<configDir>/.env` (if present) into the selected environment, then
// resolves the final config per CLI-6 precedence. A missing file is not an
// error. A file that cannot be read produces a warning and the CLI continues
// without it (ADR 0004 §3).
export async function loadConfigFromDisk (
  options: LoadConfigFromDiskOptions = {}
): Promise<LoadConfigResult> {
  const { cliProvider, processEnv, envFilePath, platformEnv } = options
  const resolvedEnvFilePath = envFilePath ?? getConfigFilePath(ENV_FILE_NAME, platformEnv)
  const environment = processEnv ?? process.env
  const warnings = await loadEnvFileVars(resolvedEnvFilePath, environment)

  const resolveOptions: ResolveConfigOptions = {}
  if (cliProvider !== undefined) {
    resolveOptions.cliProvider = cliProvider
  }
  resolveOptions.processEnv = environment

  return { config: resolveConfig(resolveOptions), warnings }
}
