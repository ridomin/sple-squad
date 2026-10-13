# Project Context

- **Owner:** Rido
- **Project:** sple — a TypeScript CLI for managing music-streaming playlists through provider adapters.
- **Assignment:** Temporary independent revision author for PR #44, limited to Lead's rejected findings. Core Dev is locked out of this revision cycle.

## Learnings

- CLI exit codes and argument validation follow ADR-0007.
- Canonical playlist-file validation must follow ADR-0008; reconcile implementation with the ADR before introducing runtime validation dependencies.
- Do not assume live Spotify behavior is verified; S1–S4 remain unverified.
