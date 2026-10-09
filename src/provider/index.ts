// Provider adapters (Spotify, YouTube Music, fake provider). The `Provider`
// interface and capability types (issue #3) live in `../core/provider/`;
// re-exported here so adapter code under this directory can import from a
// relative sibling path. The fake provider (issue #4) is implemented in
// `../core/provider/fake/`; `./registry.ts` is the CLI-facing, env-gated
// registration point for it. Real adapters land in issues #6, #8.
export * from '../core/provider/index.ts'
export * from './registry.ts'
