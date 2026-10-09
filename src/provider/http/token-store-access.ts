// Ready-made `loadToken`/`saveToken` pair backed by the real token store
// (ADR 0004, `core/config/token-store.ts`), so an adapter wiring up
// `HttpClient` doesn't have to reinvent token persistence.
import { loadTokens, saveTokens, type TokenStoreOptions } from '../../core/config/token-store.ts'
import type { ProviderId, StoredToken } from '../../core/config/types.ts'

export interface TokenStoreAccess {
  loadToken: () => Promise<StoredToken | null>
  saveToken: (token: StoredToken) => Promise<void>
}

export function tokenStoreAccess (providerId: ProviderId, options: TokenStoreOptions = {}): TokenStoreAccess {
  return {
    loadToken: async () => await loadTokens(providerId, options),
    saveToken: async (token) => {
      await saveTokens(providerId, token, options)
    }
  }
}
