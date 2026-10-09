// Provider interface and capabilities types (ADR-0003, incl. both
// amendments). Real adapters (Spotify, YouTube Music) and the fake provider
// land in separate issues (#4, #6, #8); this module only defines the shapes
// they implement against.
export type * from './capabilities.ts'
export type * from './provider.ts'
export * from './errors.ts'
