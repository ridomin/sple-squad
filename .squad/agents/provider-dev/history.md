# Project Context

- **Owner:** Rido
- **Project:** sple — a command-line tool for managing music-streaming playlists. First release targets Spotify; designed so YouTube Music and others can be added later via a provider adapter, including playlist migration between services.
- **Stack:** TypeScript (strict) on Node.js active LTS, distributed via npm only.
- **Created:** 2026-10-07T12:40:40+02:00

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->
- Spotify: loopback redirect must be `http://127.0.0.1/callback` registered without a port (`localhost` is rejected); PKCE S256, no client secret needed.
- Spotify: owned-or-collaborator playlist items access only (spike S2); ISRC search filter works (spike S1); page sizes 50/50/100 (spike S3); Premium-required error detection unverified (spike S4, fallback regex `/premium/i`).
- YouTube Music: official Data API v3 only (ADR-0002); user brings own Google Desktop OAuth client + secret (non-confidential for installed apps); `search.list` capped at 100/day, everything else shares 10,000 units/day; no ISRC; preview adapter (M4a) has known deviations (§12 D12, issue #65) — not yet spec-compliant.
- Amazon Music is blocked (ADR-0001) — not planned, do not build against it.
