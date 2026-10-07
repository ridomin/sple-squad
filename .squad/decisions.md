# Squad Decisions

## Active Decisions

### 2026-10-07: Project starts from zero — no pre-existing code
**By:** Rido (via Copilot)
**What:** `docs/requirements.md` §11/§12 claim M0–M3 are already implemented (including a YouTube preview adapter, issue #65/D12). This repo contains no source code — only `docs/`. Confirmed with Rido: the project starts from scratch. §11/§12's "done"/"preview adapter exists" claims are stale and must be corrected to reflect the true starting state before planning proceeds. The real next milestone is **M0 — Foundations**, not M4a.
**Why:** Prevents the team from planning work (e.g. M4a) against code that doesn't exist, and keeps `docs/requirements.md` as an accurate source of truth for implementation.

### 2026-10-07: Tooling conventions — no Vitest/Jest, no Prettier, StandardJS-for-TS lint
**By:** Rido (via PR #9 review comments)
**What:** For `sple`'s TypeScript codebase:
- **Tests:** use Node's built-in test runner (`node:test` + `node:assert`), not Vitest or Jest.
- **Lint:** use StandardJS configured for TypeScript (not custom hand-rolled ESLint rule sets).
- **Formatting:** no Prettier — formatting is whatever the StandardJS lint config enforces (via `eslint --fix`), not a separate formatter/config file.
**Why:** Keeps the toolchain minimal and dependency-light; avoids maintaining parallel formatter + linter configs that can drift or conflict.
**Scope:** Applies to all current and future `sple` source code (core, CLI, provider adapters, tests) — not just the M0 scaffold in #1.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
