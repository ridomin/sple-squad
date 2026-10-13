// Provider interface and capabilities types (ADR-0003, incl. both
// amendments). The fake provider (#4) is implemented here, but its
// CLI-visible registration stays gated behind `SPLE_ENABLE_FAKE_PROVIDER=1`
// (see `../../provider/registry.ts`). Spotify's provider/auth adapter lives
// under `../../provider/spotify/`.
export type * from './capabilities.ts'
export type * from './provider.ts'
export * from './errors.ts'
export * from './fake/index.ts'
