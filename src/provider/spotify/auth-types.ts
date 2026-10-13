import type { StoredToken } from '../../core/config/types.ts'
import type { TokenStoreOptions } from '../../core/config/token-store.ts'

export type SpotifyLoginMode = 'loopback' | 'no-browser' | 'manual'

export interface SpotifyLoginOptions {
  clientId: string
  mode?: SpotifyLoginMode
  scopes?: string[]
}

export interface SpotifyLoginResult {
  userId: string
  displayName?: string
  scopes: string[]
  expiresAt?: string
}

export interface SpotifyLoginDependencies {
  fetchImpl?: typeof fetch
  saveToken?: (token: StoredToken) => Promise<void>
  tokenStoreOptions?: TokenStoreOptions
  readLine?: () => Promise<string | null>
  writeStderr?: (message: string) => void
  openBrowser?: (url: string) => Promise<void>
  now?: () => number
  callbackTimeoutMs?: number
}

export interface LoopbackListener {
  redirectUri: string
  waitForCode: () => Promise<string>
  close: () => Promise<void>
}
