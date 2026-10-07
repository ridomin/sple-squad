// Placeholder for provider adapters (Spotify, YouTube Music, fake provider).
// The `Provider` interface and capability types (issue #3) now live in
// `../core/provider/`; re-exported here so adapter code under this directory
// can import from a relative sibling path. Real adapters land in issues #4,
// #6, #8.
export * from '../core/provider/index.ts'
