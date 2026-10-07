// Provider interface and capabilities types (ADR-0003, incl. both
// amendments). Real adapters (Spotify, YouTube Music) land in separate
// issues (#6, #8); this module only defines the shapes they implement
// against. The `fake` provider (#4) is implemented here too, but its
// CLI-visible registration stays gated behind `SPLE_ENABLE_FAKE_PROVIDER=1`
// (see `../../provider/registry.ts`).
export type * from './capabilities.ts'
export type * from './provider.ts'
export * from './errors.ts'
export * from './fake/index.ts'
