# Project Context

- **Owner:** Rido
- **Project:** sple — a command-line tool for managing music-streaming playlists. First release targets Spotify (search, inspect/export/create/edit/remove playlists); designed so YouTube Music and others can be added later via a provider adapter, including playlist migration between services.
- **Stack:** TypeScript (strict) on Node.js active LTS, distributed via npm only. Spec and ADRs are language-neutral so other languages can port it.
- **Created:** 2026-10-07T12:40:40+02:00

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->
- `docs/requirements.md` is v0.4 (Draft, 2026-10-07), spec-review-for-ports pass. Reading order for a port: requirements.md, then ADR 0003 (provider interface), 0004 (files), 0005 (track model), 0007 (CLI contract), 0008 (canonical file + schemas/), 0009 (matching), 0010 (HTTP/OAuth).
- Nearly all open questions in §10 are resolved (Q1–Q26); only Q8 (interactive mode) is explicitly deferred.
- M0–M3 are largely done per §11/§12: M3 (import + matching) done 2026-10-05; M4a (YouTube read-only) has a preview adapter that does not yet meet spec (tracked as deviation D12, issue #65).
- Amazon Music is blocked externally (ADR-0001) and not planned; only Spotify (shipped) and YouTube Music (M4a/M4b) are in scope.
