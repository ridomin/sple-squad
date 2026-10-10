// Config precedence resolution (ADR 0004 §1, CLI-6): flags > process
// environment > built-in defaults. Node may populate `process.env` from a
// `.env` file before this application starts.
import type { ProviderId } from './types.ts'
import { registerSensitiveValue } from '../security/secrets.ts'

const DEFAULT_PROVIDER: ProviderId = 'spotify'
const VALID_PROVIDER_IDS: readonly ProviderId[] = ['spotify', 'youtube-music', 'fake']
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
  // globals. Node may populate it from a `.env` file before startup.
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
// default. Empty/whitespace-only values count as unset (ADR 0004 §1).
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
