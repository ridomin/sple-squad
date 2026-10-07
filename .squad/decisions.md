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

#### Core Dev — PR #9 review fixes (package specifics)
**Context:** Rido left 3 inline review comments on PR #9 (`squad/1-repo-tooling-and-project-scaffolding`):
drop Vitest, drop Prettier, and use "standard js configured for ts" instead of the hand-rolled
`typescript-eslint` flat config. This is the final word on tooling for M0, superseding the earlier
Vitest/Prettier/typescript-eslint scaffold choices made in issue #1.

**Decisions:**

- **Test runner:** Node's built-in test runner. `src/**/*.test.ts` run directly via
  `node --test src` — no build/transpile step for tests. This relies on Node's native TypeScript
  type-stripping (stable by default since Node 24), which satisfies `node:test` auto-discovery of
  `*.test.ts` files. Verified locally on Node v26.8.2; CI uses `actions/setup-node@v4` with
  `node-version: lts/*`, which resolves to a type-stripping-capable LTS. `tsconfig.build.json`
  still excludes `*.test.ts` from the shipped `dist/` output, so this has no effect on the published
  package's `engines.node: >=20.0.0` requirement — that floor is about the compiled CLI, not the
  dev-time test run.
- **Lint — standard-for-ts package:** `eslint-config-love` (not
  `eslint-config-standard-with-typescript`, which `npm view` confirms is deprecated upstream in
  favor of `eslint-config-love` — same maintainer/lineage, same StandardJS-derived rule set for
  TypeScript). Verified `eslint-config-love@158.0.0` is current on npm and requires `eslint ^10.0.0`,
  so `eslint` was bumped from `^9.13.0` to `^10.12.0` alongside it. `eslint.config.js` is now just
  `love` spread onto `src/**/*.ts`, plus a narrow override on `src/**/*.test.ts` to turn off
  `@typescript-eslint/no-floating-promises` (node:test's `describe`/`it` callbacks aren't meant to be
  awaited) and `@typescript-eslint/no-magic-numbers` (assertion literals like `0`/`1` in test bodies).
  `typescript-eslint`, `@eslint/js`, and `eslint-config-prettier` were dropped as direct deps —
  `eslint-config-love` bundles its own `typescript-eslint`/`eslint-plugin-n`/`eslint-plugin-promise`.
- **Formatting:** Prettier removed entirely (`.prettierrc.json`, `.prettierignore`, the `prettier`
  and `eslint-config-prettier` deps, and the `format`/`format:check` scripts). Formatting is now
  whatever `love`'s rule set enforces, fixable via `npm run lint:fix`. Source files were reformatted
  to StandardJS style (no semicolons, single quotes) to match.
- Fixed a few `love`-surfaced strictness issues in `src/cli/index.ts` along the way: named constants
  for exit codes/argv indices instead of magic numbers, a runtime type guard instead of an unchecked
  `as` assertion on `JSON.parse(...)`, and `eslint-disable-next-line no-console` comments on the
  intentional CLI output lines.

**Verification:** `npm install && npm run build && npm run lint && npm test` all pass; the original
5 test cases are unchanged in behavior (translated from `expect` to `node:assert/strict`).

### 2026-10-07: tsconfig — `rewriteRelativeImportExtensions: true`, use `.ts` in relative imports
**By:** Core Dev (via PR #20, issue #5)
**What:** Added `rewriteRelativeImportExtensions: true` to `tsconfig.json`. Relative imports between source files should now use the real `.ts` extension (e.g. `from './format.ts'`), not `.js`. `tsc` rewrites these to `.js` in `dist` automatically.
**Why:** `src/core` gained its first multi-file import graph (canonical-track.ts, export/format.ts, export/invariants.ts). With `moduleResolution: NodeNext`, TS previously required `.js` extensions matching compiled output — but `npm test` runs `node --test` directly against the `.ts` sources (no build step), and Node's native TS support does not auto-map `.js` specifiers to sibling `.ts` files. Using `.js` extensions made tests fail with `ERR_MODULE_NOT_FOUND` even though `tsc` was happy. `rewriteRelativeImportExtensions` lets one `.ts`-extension import work for both `node --test` (source) and `tsc` (dist) without duplicating config.
**Scope:** Applies to all future `sple` source code with relative imports between TS modules (core, CLI, provider adapters). Test files already used this pattern for importing source (`src/cli/index.test.ts` → `'./index.ts'`); this decision extends it to source-to-source imports too.

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
