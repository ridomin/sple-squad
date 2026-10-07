// Config precedence resolution (ADR 0004 §1, CLI-6): flags > process
// environment > `.env` file > built-in defaults. This module does not do any
// file I/O itself — see `loadConfigFromDisk` below for the thin I/O wrapper,
// and `env-file.ts` for `.env` parsing/permission checks.
import { readFile } from 'node:fs/promises'
import { getConfigFilePath, type PlatformEnv } from './paths.ts'
import { checkEnvFilePermissions, parseDotEnv } from './env-file.ts'
import type { ProviderId } from './types.ts'

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
  // Defaults to `process.env`; override in tests to avoid mutating globals.
  processEnv?: NodeJS.ProcessEnv
  // Parsed contents of the `.env` file (see `parseDotEnv`); defaults to {}.
  envFileVars?: Record<string, string>
}

function isValidProviderId (value: string): value is ProviderId {
  return (VALID_PROVIDER_IDS as readonly string[]).includes(value)
}

function isSetValue (value: string | undefined): value is string {
  return value !== undefined && value.trim().length > EMPTY_LENGTH
}

// Looks up `key`, preferring the process environment over the parsed `.env`
// file (CLI-6); an empty/whitespace-only value counts as unset (ADR 0004 §1).
function pickEnvValue (
  key: string,
  processEnv: NodeJS.ProcessEnv,
  envFileVars: Record<string, string>
): string | undefined {
  const { [key]: fromProcess } = processEnv
  if (isSetValue(fromProcess)) {
    return fromProcess.trim()
  }
  const { [key]: fromFile } = envFileVars
  if (isSetValue(fromFile)) {
    return fromFile.trim()
  }
  return undefined
}

function resolveRequestedProvider (
  cliProvider: string | undefined,
  processEnv: NodeJS.ProcessEnv,
  envFileVars: Record<string, string>
): ProviderId {
  const fromFlag = isSetValue(cliProvider) ? cliProvider.trim() : undefined
  const requested = fromFlag ?? pickEnvValue(ENV_VAR_DEFAULT_PROVIDER, processEnv, envFileVars) ?? DEFAULT_PROVIDER

  if (!isValidProviderId(requested)) {
    throw new UsageError(
      `Invalid provider "${requested}" (expected one of: ${VALID_PROVIDER_IDS.join(', ')})`
    )
  }
  return requested
}

// Merges config sources per CLI-6 precedence: CLI flag > process env > .env
// file > default. Empty/whitespace-only values count as unset (ADR 0004 §1).
export function resolveConfig (options: ResolveConfigOptions = {}): SpleConfig {
  const { cliProvider, processEnv = process.env, envFileVars = {} } = options
  const pick = (key: string): string | undefined => pickEnvValue(key, processEnv, envFileVars)

  return {
    defaultProvider: resolveRequestedProvider(cliProvider, processEnv, envFileVars),
    spotifyClientId: pick(ENV_VAR_SPOTIFY_CLIENT_ID) ?? null,
    youtubeMusicClientId: pick(ENV_VAR_YOUTUBE_MUSIC_CLIENT_ID) ?? null,
    googleClientSecret: pick(ENV_VAR_GOOGLE_CLIENT_SECRET) ?? null,
    enableFakeProvider: pick(ENV_VAR_ENABLE_FAKE_PROVIDER) === FAKE_PROVIDER_ENABLED_VALUE
  }
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
  // Amendment 1): a parse failure or a too-permissive `.env` file.
  warnings: string[]
}

function isErrnoException (err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}

interface EnvFileReadResult {
  vars: Record<string, string>
  warnings: string[]
}

async function readEnvFile (envFilePath: string): Promise<EnvFileReadResult> {
  const warnings: string[] = []
  try {
    const content = await readFile(envFilePath, 'utf8')
    const vars = parseDotEnv(content)
    const permissionWarning = await checkEnvFilePermissions(envFilePath)
    if (permissionWarning !== null) {
      warnings.push(permissionWarning)
    }
    return { vars, warnings }
  } catch (err) {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      // Missing file is not an error (ADR 0004 §3).
      return { vars: {}, warnings }
    }
    const reason = err instanceof Error ? err.message : String(err)
    warnings.push(`Failed to load .env: ${reason}`)
    return { vars: {}, warnings }
  }
}

// Reads `<configDir>/.env` (if present), parses it, and resolves the final
// config per CLI-6 precedence. A missing file is not an error. A file that
// cannot be read/parsed produces a warning and the CLI continues without it
// (ADR 0004 §3).
export async function loadConfigFromDisk (
  options: LoadConfigFromDiskOptions = {}
): Promise<LoadConfigResult> {
  const { cliProvider, processEnv, envFilePath, platformEnv } = options
  const resolvedEnvFilePath = envFilePath ?? getConfigFilePath(ENV_FILE_NAME, platformEnv)
  const { vars: envFileVars, warnings } = await readEnvFile(resolvedEnvFilePath)

  const resolveOptions: ResolveConfigOptions = { envFileVars }
  if (cliProvider !== undefined) {
    resolveOptions.cliProvider = cliProvider
  }
  if (processEnv !== undefined) {
    resolveOptions.processEnv = processEnv
  }

  return { config: resolveConfig(resolveOptions), warnings }
}
