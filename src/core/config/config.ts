// Config precedence resolution (ADR 0004 §1, CLI-6): flags > process
// environment > `.env` file > built-in defaults. `.env` loading is done with
// Node's built-in `process.loadEnvFile` (ADR 0004 Amendment 1) — it merges
// the file into `process.env` without overriding already-set variables, so
// by the time `resolveConfig` runs, `process.env` already reflects the full
// precedence. See `loadConfigFromDisk` below for the thin I/O wrapper, and
// `env-file.ts` for the `.env` permission check.
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
  // `process.loadEnvFile` (see `loadConfigFromDisk`).
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
// `loadConfigFromDisk`/`process.loadEnvFile`.) Empty/whitespace-only values
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

// Loads `<configDir>/.env` into `process.env` (if present) with Node's
// built-in `process.loadEnvFile` — it never overrides a variable that's
// already set, which is exactly the CLI-6 "process env > .env file"
// precedence. A missing file is not an error (ADR 0004 §3).
async function loadEnvFileVars (envFilePath: string): Promise<string[]> {
  const warnings: string[] = []
  try {
    process.loadEnvFile(envFilePath)
    const permissionWarning = await checkEnvFilePermissions(envFilePath)
    if (permissionWarning !== null) {
      warnings.push(permissionWarning)
    }
  } catch (err) {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      // Missing file is not an error (ADR 0004 §3).
      return warnings
    }
    const reason = err instanceof Error ? err.message : String(err)
    warnings.push(`Failed to load .env: ${reason}`)
  }
  return warnings
}

// Loads `<configDir>/.env` (if present) into `process.env`, then resolves
// the final config per CLI-6 precedence. A missing file is not an error. A
// file that cannot be loaded produces a warning and the CLI continues
// without it (ADR 0004 §3).
export async function loadConfigFromDisk (
  options: LoadConfigFromDiskOptions = {}
): Promise<LoadConfigResult> {
  const { cliProvider, processEnv, envFilePath, platformEnv } = options
  const resolvedEnvFilePath = envFilePath ?? getConfigFilePath(ENV_FILE_NAME, platformEnv)
  const warnings = await loadEnvFileVars(resolvedEnvFilePath)

  const resolveOptions: ResolveConfigOptions = {}
  if (cliProvider !== undefined) {
    resolveOptions.cliProvider = cliProvider
  }
  if (processEnv !== undefined) {
    resolveOptions.processEnv = processEnv
  }

  return { config: resolveConfig(resolveOptions), warnings }
}
