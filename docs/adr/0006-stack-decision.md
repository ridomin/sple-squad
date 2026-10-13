# ADR 0006: Stack decision — runtime, package manager, build, lint, test

- **Status:** Accepted (2026-10-07)
- **Date:** 2026-10-07
- **Deciders:** project owner (user); architect (author)
- **Related:** `docs/requirements.md` NFR-1; ADR 0007 (CLI conventions, reserves this ADR for M1-29)
- **Supersedes:** n/a

## Context

NFR-1 requires the reference implementation to be "TypeScript (strict) on Node.js active LTS, distributed via npm only... with no standalone binaries." Issue #1 (M0 — repo tooling and project scaffolding, PR #9) implemented this skeleton but did not record *why* each tool was chosen, and the first pass of that PR picked tools (Vitest, a hand-rolled ESLint ruleset, Prettier) that the project owner rejected in review. ADR 0007 reserves this slot ("ADR 0006 (stack) is reserved for M1-29") so the final, review-corrected choices have a durable record instead of living only in PR comments.

This ADR documents the stack as it actually landed after that review cycle, not the first draft.

## Decision

### 1. Runtime: Node.js, active LTS

- Node.js, targeting the **active LTS** release line (CI pins `node-version: lts/*`; `package.json` declares `"engines": { "node": ">=24.0.0" }`).
- Rationale: NFR-1 mandates "Node.js active LTS" directly. Active LTS gives a stable, security-patched runtime without chasing current/experimental releases, while still being new enough for `node:test`'s native TypeScript type-stripping (stable by default since Node 24) to run test files without a separate transpile step.
- No standalone binaries (`pkg`, `nexe`, etc.) — NFR-1 explicitly excludes them; distribution is npm-only (§2).

### 2. Package manager: npm

- npm (via `package-lock.json`), no Yarn/pnpm.
- Rationale: NFR-1 specifies "distributed via npm only (`npx sple` / global install)." Using npm as the package manager too (not just the registry) avoids a second lockfile format and keeps `npm ci` in CI authoritative.

### 3. Build tool: `tsc`

- Plain `tsc -p tsconfig.build.json` (strict mode: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`) compiles `src/` to `dist/`, which is the only thing published (`"files": ["dist"]`).
- `tsconfig.build.json` extends `tsconfig.json` and excludes `src/**/*.test.ts`, so test sources never ship in the npm package.
- Rationale: NFR-1 requires "TypeScript (strict)". No bundler (esbuild/rollup/webpack) is used — the CLI is a plain Node ESM package with no browser target and no need for a single-file bundle, so `tsc` alone satisfies the build with the least tooling.

### 4. Lint (and formatting): `eslint-config-love`

- `eslint.config.js` applies `eslint-config-love` (flat config) to `src/**/*.ts`, with narrow per-file rule overrides for test files (`no-floating-promises`, `no-magic-numbers` off, since `node:test`'s `it`/`describe` return intentionally-unawaited promises and exit codes read fine as literals in assertions).
- There is **no separate formatter**. Formatting is whatever `eslint-config-love` enforces via `eslint --fix` (StandardJS style: no semicolons, single quotes) — no Prettier, no `.prettierrc.json`.
- Rationale: PR #9's review rejected the first pass's hand-rolled `typescript-eslint` flat config ("instead of custom eslint rules use standard js configured for ts") and its Prettier setup ("dont need prettier"). The fix checked `eslint-config-standard-with-typescript` first and found it deprecated upstream in favor of `eslint-config-love` (same StandardJS-for-TypeScript lineage, current on npm); `eslint` was bumped to `^10.12.0` to satisfy love's peer dependency. One linter enforcing both rules and style avoids maintaining two configs that can drift or conflict (see `.squad/decisions.md`, 2026-10-07).

### 5. Test tool: `node:test`

- Tests run via `node --test` (no path argument, relying on Node's default recursive discovery of `src/**/*.test.ts`), using `node:test` + `node:assert/strict`. `npm test` runs this directly against TypeScript sources — Node's native type-stripping needs no separate transpile step for tests.
- Rationale: PR #9's review rejected the first pass's Vitest setup ("do not use vitest or jest, just use default node test framework"). `node:test` is built into the runtime NFR-1 already mandates, so it adds zero test-framework dependencies. One CI-observed caveat: passing a bare directory (`node --test src`) throws `MODULE_NOT_FOUND` on some Node active-LTS point releases (reproduced on Node 24.21.0; works on Node 26.8.2) because `src` resolves as a CommonJS entry module rather than a test glob — the fix is to call `node --test` with no path (or an explicit glob, `"src/**/*.test.ts"`), which both scripts and CI now use.

## Alternatives considered

- **Node current/experimental release instead of active LTS.** Rejected: NFR-1 specifies active LTS explicitly; LTS gives CI and users a stable, long-supported target.
- **Yarn or pnpm.** Rejected: NFR-1 ties distribution to npm; a second package manager adds a lockfile format with no corresponding requirement.
- **A bundler (esbuild/rollup/webpack) for the build.** Rejected: the CLI has no browser target and ships as a plain Node ESM package; `tsc` alone is sufficient and keeps the dependency surface minimal.
- **Standalone binaries (`pkg`, `nexe`, single-executable-application).** Rejected: NFR-1 explicitly excludes standalone binaries; npm-only distribution is the stated requirement.
- **Hand-rolled `typescript-eslint` flat config (first pass of PR #9).** Rejected in review: a custom ruleset requires ongoing curation; StandardJS-for-TypeScript is an established, low-maintenance convention.
- **`eslint-config-standard-with-typescript`.** Rejected: deprecated upstream in favor of `eslint-config-love` (confirmed via `npm view` during the PR #9 review fix); same lineage, but `eslint-config-love` is the maintained package.
- **Prettier (first pass of PR #9).** Rejected in review: a second formatter config can drift from or conflict with the linter's style rules; `eslint-config-love` already dictates formatting, so `eslint --fix` is the single source of style truth.
- **Vitest / Jest (first pass of PR #9, Vitest).** Rejected in review: both add a test-framework dependency on top of a runtime (`node:test`) that already ships one, with no feature `sple`'s test suite needs that `node:test` lacks.

## Consequences

- M0's reference implementation (issue #1 / PR #9) already conforms to this ADR; no further migration is needed.
- Future M-series work must not reintroduce Vitest/Jest, Prettier, or hand-rolled ESLint rule sets — `npm run lint` and `npm test` are the only gates, and both run in CI (`.github/workflows/ci.yml`) via `npm ci && npm run build && npm run lint && npm test` on `node-version: lts/*`.
- A port in another language (NFR-1) is free to choose its own build/lint/test tooling; this ADR's choices are TypeScript-reference-implementation-specific and are not part of the language-neutral contract (unlike ADRs 0003/0004/0005/0007/0008/0009/0010).
- Bumping the Node LTS floor (`engines.node`) or the `eslint`/`eslint-config-love` major versions is a routine dependency update, not an amendment to this ADR, unless it changes one of the decisions above (e.g., switching away from `node:test`).

## Sources

- `docs/requirements.md` NFR-1.
- PR #9 review comments (`ridomin/sple-squad#9`): rejected Vitest/Jest, custom ESLint config, and Prettier; requested `node:test` and "standard js configured for ts".
- `.squad/decisions.md`, 2026-10-07: "Tooling conventions — no Vitest/Jest, no Prettier, StandardJS-for-TS lint".
- `eslint-config-love` (npm): https://www.npmjs.com/package/eslint-config-love
- Node.js test runner docs: https://nodejs.org/api/test.html
- Node.js release schedule (LTS): https://nodejs.org/en/about/previous-releases
