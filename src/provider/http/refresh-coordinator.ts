// Single-flight token refresh (ADR-0010 §3): concurrent requests in one
// process share one in-flight refresh, and a request that still holds the
// pre-refresh access token reuses the last completed refresh's result
// instead of refreshing again.

export class RefreshCoordinator<Token extends { accessToken: string }> {
  private pending: Promise<Token> | null = null
  private lastFromAccessToken: string | null = null
  private lastResult: Token | null = null

  /**
   * Refreshes `token`, or reuses an in-flight/just-completed refresh when
   * `token.accessToken` is the one that triggered it.
   */
  async refresh (token: Token, doRefresh: (token: Token) => Promise<Token>): Promise<Token> {
    if (this.pending !== null) {
      return await this.pending
    }
    if (this.lastResult !== null && this.lastFromAccessToken === token.accessToken) {
      return this.lastResult
    }

    const { accessToken } = token
    this.lastFromAccessToken = accessToken
    const inFlight = doRefresh(token)
    this.pending = inFlight
    try {
      const result = await inFlight
      this.lastResult = result
      return result
    } finally {
      this.pending = null
    }
  }
}
