# Project Context

- **Owner:** Rido
- **Project:** sple — a command-line tool for managing music-streaming playlists. First release targets Spotify; designed so YouTube Music and others can be added later via a provider adapter, including playlist migration between services.
- **Stack:** TypeScript (strict) on Node.js active LTS, distributed via npm only.
- **Created:** 2026-10-07T12:40:40+02:00

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->
- NFR-6: ≥ 80% line coverage on core and adapters; HTTP mocked with recorded fixtures; automated tests never call real provider APIs.
- Matching engine has fixed test vectors specified in ADR-0009 Amendment 1 (NFKD + mark stripping, punctuation folding, fixed decoration list, duration tolerance, title/artist overlap gate).
- Fake provider (`fake`) exists for tests and to prove the Provider abstraction works; enabled via `SPLE_ENABLE_FAKE_PROVIDER=1`.
