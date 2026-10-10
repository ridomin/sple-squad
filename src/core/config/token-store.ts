// Token file I/O and lifecycle (ADR 0004 §2, Amendment 1 "`tokens.json`
// rules"): read/write/delete the versioned, per-provider token store.
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getConfigFilePath, type PlatformEnv } from './paths.ts'
import { TOKENS_SCHEMA_VERSION, type ProviderId, type StoredToken, type TokensFile } from './types.ts'
import { registerSensitiveValue } from '../security/secrets.ts'

const TOKENS_FILE_NAME = 'tokens.json'
const FILE_MODE_OWNER_RW = 0o600
const JSON_INDENT = 2
const EMPTY_LENGTH = 0

export interface TokenStoreOptions {
  // Overrides the resolved tokens.json path; used by tests to avoid touching
  // the real user config directory.
  filePath?: string
  platformEnv?: PlatformEnv
}

function resolveFilePath (options: TokenStoreOptions): string {
  return options.filePath ?? getConfigFilePath(TOKENS_FILE_NAME, options.platformEnv)
}

function isErrnoException (err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString (value: unknown): value is string {
  return typeof value === 'string' && value.length > EMPTY_LENGTH
}

function hasValidOptionalStrings (candidate: Record<string, unknown>): boolean {
  const optionalStringFields = ['refreshToken', 'expiresAt', 'displayName', 'refreshTokenExpiresAt'] as const
  return optionalStringFields.every((field) => {
    const { [field]: fieldValue } = candidate
    return fieldValue === undefined || typeof fieldValue === 'string'
  })
}

function hasValidScopes (candidate: Record<string, unknown>): boolean {
  return Array.isArray(candidate.scopes) &&
    candidate.scopes.every((scope: unknown) => typeof scope === 'string')
}

function isStoredToken (value: unknown): value is StoredToken {
  if (!isRecord(value)) {
    return false
  }

  return (
    isNonEmptyString(value.accessToken) &&
    hasValidScopes(value) &&
    isNonEmptyString(value.userId) &&
    isNonEmptyString(value.grantedAt) &&
    hasValidOptionalStrings(value)
  )
}

function emptyTokensFile (): TokensFile {
  return { schemaVersion: TOKENS_SCHEMA_VERSION, providers: {} }
}

function parseTokensFile (parsed: unknown, filePath: string): TokensFile {
  if (!isRecord(parsed)) {
    throw new Error(`Invalid tokens file at ${filePath}: expected a JSON object`)
  }
  if (parsed.schemaVersion !== TOKENS_SCHEMA_VERSION) {
    throw new Error(
      `Invalid tokens file at ${filePath}: unsupported schemaVersion ${JSON.stringify(parsed.schemaVersion)}`
    )
  }
  const providers: TokensFile['providers'] = isRecord(parsed.providers) ? parsed.providers : {}
  return { schemaVersion: TOKENS_SCHEMA_VERSION, providers }
}

async function readRawFileOrNull (filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (err) {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      return null
    }
    throw err
  }
}

async function readTokensFile (filePath: string): Promise<TokensFile> {
  const raw = await readRawFileOrNull(filePath)
  if (raw === null) {
    return emptyTokensFile()
  }

  const parsed: unknown = JSON.parse(raw)
  return parseTokensFile(parsed, filePath)
}

// Writes tokens.json atomically with 0600 permissions (Amendment 1): a temp
// file in the same directory, then rename over the real path, so the file is
// never readable by others, even briefly.
async function writeTokensFileAtomic (filePath: string, data: TokensFile): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${String(process.pid)}.${String(Date.now())}.tmp`
  const json = JSON.stringify(data, null, JSON_INDENT)

  await writeFile(tempPath, json, { mode: FILE_MODE_OWNER_RW })
  // writeFile's `mode` is subject to the process umask; chmod explicitly so
  // the file is 0600 regardless of umask (POSIX only; harmless on Windows).
  await chmod(tempPath, FILE_MODE_OWNER_RW)
  await rename(tempPath, filePath)
}

const FIRST_ACCOUNT_INDEX = 0

function registerTokenSecrets (token: StoredToken): void {
  registerSensitiveValue(token.accessToken)
  registerSensitiveValue(token.refreshToken)
}

// Loads the stored token for a provider. Returns null if tokens.json is
// missing, the provider has no entry, or its `accounts` array is empty
// (Amendment 1: all three mean "not logged in").
export async function loadTokens (
  providerId: ProviderId,
  options: TokenStoreOptions = {}
): Promise<StoredToken | null> {
  const filePath = resolveFilePath(options)
  const file = await readTokensFile(filePath)
  const token = file.providers[providerId]?.accounts[FIRST_ACCOUNT_INDEX]

  if (token === undefined) {
    return null
  }
  if (!isStoredToken(token)) {
    throw new Error(`Invalid stored token for provider "${providerId}" in ${filePath}`)
  }
  registerTokenSecrets(token)
  return token
}

// Saves (creates or replaces) the single stored account for a provider.
// Only `accounts[0]` is ever read or written (one account per provider,
// FR-AUTH-6).
export async function saveTokens (
  providerId: ProviderId,
  token: StoredToken,
  options: TokenStoreOptions = {}
): Promise<void> {
  if (!isStoredToken(token)) {
    throw new Error(`Refusing to save invalid token for provider "${providerId}"`)
  }
  registerTokenSecrets(token)

  const filePath = resolveFilePath(options)
  const file = await readTokensFile(filePath)
  const providers: TokensFile['providers'] = {
    ...file.providers,
    [providerId]: { accounts: [token] }
  }

  await writeTokensFileAtomic(filePath, { schemaVersion: TOKENS_SCHEMA_VERSION, providers })
}

// Removes a provider's tokens entirely (logout); other providers are
// untouched. A missing file, or a provider with no stored tokens, is not an
// error.
export async function deleteTokens (
  providerId: ProviderId,
  options: TokenStoreOptions = {}
): Promise<void> {
  const filePath = resolveFilePath(options)
  const file = await readTokensFile(filePath)
  const { providers: existingProviders } = file
  const { [providerId]: existingEntry, ...providers } = existingProviders
  if (existingEntry === undefined) {
    return
  }
  await writeTokensFileAtomic(filePath, { schemaVersion: TOKENS_SCHEMA_VERSION, providers })
}
