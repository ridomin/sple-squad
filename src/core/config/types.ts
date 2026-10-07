// Shared types for the config/token-store modules (ADR 0004). `ProviderId`
// mirrors ADR 0003's definition; it is re-declared here (not imported) because
// the provider module is still a placeholder (issue #3) and this module must
// not depend on unimplemented code. Once #3 lands, this should become a
// re-export of the provider module's `ProviderId`.
export type ProviderId = 'spotify' | 'youtube-music' | 'fake'

// A single stored OAuth token for one provider account (ADR 0004 Amendment 1).
export interface StoredToken {
  accessToken: string
  refreshToken?: string
  expiresAt?: string
  scopes: string[]
  userId: string
  displayName?: string
  grantedAt: string
  refreshTokenExpiresAt?: string
}

export interface ProviderTokens {
  accounts: StoredToken[]
}

export const TOKENS_SCHEMA_VERSION = 1

// On-disk shape of tokens.json: `{ schemaVersion: 1, providers: { ... } }`.
export interface TokensFile {
  schemaVersion: typeof TOKENS_SCHEMA_VERSION
  providers: Partial<Record<ProviderId, ProviderTokens>>
}
