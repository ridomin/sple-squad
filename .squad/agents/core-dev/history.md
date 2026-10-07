# Project Context

- **Owner:** Rido
- **Project:** sple — a command-line tool for managing music-streaming playlists. First release targets Spotify (search, inspect/export/create/edit/remove playlists); designed so YouTube Music and others can be added later via a provider adapter, including playlist migration between services.
- **Stack:** TypeScript (strict) on Node.js active LTS, distributed via npm only.
- **Created:** 2026-10-07T12:40:40+02:00

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->
- Core and CLI code must never import provider SDKs directly (PRV-1) — only through the `Provider` interface (ADR-0003).
- CLI conventions (exit codes, `--json`/`--quiet`, stdin chaining via `-`) are fully specified in ADR-0007 — follow it exactly rather than improvising.
- Matching engine owns strategies/scoring in core; adapters only implement `searchTracks(TrackQuery)` (ADR-0003 Amendment 2, ADR-0009 Amendment 1).
