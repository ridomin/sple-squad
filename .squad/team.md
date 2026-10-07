# Squad Team

> sple-squad

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work, enforces handoffs and reviewer gates. |

## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Lead | Lead | `.squad/agents/lead/charter.md` | ✅ Active |
| Core Dev | Core/CLI Dev | `.squad/agents/core-dev/charter.md` | ✅ Active |
| Provider Dev | Provider Dev | `.squad/agents/provider-dev/charter.md` | ✅ Active |
| Tester | Tester | `.squad/agents/tester/charter.md` | ✅ Active |

## Built-in Support Agents

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Scribe | Decision Merger | `.squad/agents/scribe/charter.md` | 📋 Silent |
| Ralph | Work Monitor | `.squad/agents/ralph/charter.md` | 🔄 Monitor |
| Rai | RAI Reviewer | `.squad/agents/Rai/charter.md` | 🛡️ RAI |
| Fact Checker | Devil's Advocate & Verification Agent | `.squad/agents/fact-checker/charter.md` | 🔍 Verifier |

## Coding Agent

<!-- copilot-auto-assign: false -->

| Name | Role | Charter | Status |
|------|------|---------|--------|
| @copilot | Coding Agent | — | 🤖 Coding Agent |

### Capabilities

**🟢 Good fit — auto-route when enabled:**
- Bug fixes with clear reproduction steps
- Test coverage (adding missing tests, fixing flaky tests)
- Lint/format fixes and code style cleanup
- Dependency updates and version bumps
- Small isolated features with clear specs
- Boilerplate/scaffolding generation
- Documentation fixes and README updates

**🟡 Needs review — route to @copilot but flag for squad member PR review:**
- Medium features with clear specs and acceptance criteria
- Refactoring with existing test coverage
- API endpoint additions following established patterns
- Migration scripts with well-defined schemas

**🔴 Not suitable — route to squad member instead:**
- Architecture decisions and system design
- Multi-system integration requiring coordination
- Ambiguous requirements needing clarification
- Security-critical changes (auth, encryption, access control)
- Performance-critical paths requiring benchmarking
- Changes requiring cross-team discussion

## Issue Source

- **Repository:** ridomin/sple-squad
- **Connected:** 2026-10-07
- **Filters:** none — tracking milestone M0 issues #1–#8

## Project Context

- **Owner:** Rido
- **Project:** sple-squad
- **Description:** `sple` — a CLI for managing and migrating music-streaming playlists (Spotify first, YouTube Music next); TypeScript, provider-adapter architecture.
- **Created:** 2026-10-07
