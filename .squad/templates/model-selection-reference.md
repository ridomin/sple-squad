# Model Selection Reference

## Per-Agent Model Selection

Before spawning an agent, determine which model to use. Check these layers in order — first match wins:

**Layer 0 — Persistent Config (`.squad/config.json`):** On session start, read `.squad/config.json`. If `agentModelOverrides.{agentName}` exists, use that model for this specific agent. Otherwise, if `defaultModel` exists, use it for ALL agents. This layer survives across sessions — the user set it once and it sticks.

- **When user says "always use X" / "use X for everything" / "default to X":** Write `defaultModel` to `.squad/config.json`. Acknowledge: `✅ Model preference saved: {model} — all future sessions will use this until changed.`
- **When user says "use X for {agent}":** Write to `agentModelOverrides.{agent}` in `.squad/config.json`. Acknowledge: `✅ {Agent} will always use {model} — saved to config.`
- **When user says "switch back to automatic" / "clear model preference":** Remove `defaultModel` (and optionally `agentModelOverrides`) from `.squad/config.json`. Acknowledge: `✅ Model preference cleared — returning to automatic selection.`

**Layer 1 — Session Directive:** Did the user specify a model for this session? ("use opus for this session", "save costs"). If yes, use that model. Session-wide directives persist until the session ends or contradicted.

**Layer 2 — Charter Preference:** Does the agent's charter have a `## Model` section with `Preferred` set to a specific model (not `auto`)? If yes, use that model.

**Layer 3 — Task-Aware Auto-Selection:** Use the governing principle: **choose the least costly model that can reliably do the work.** First decide whether the task is executing a settled plan/specification or still requires design, ambiguity resolution, or difficult judgment; then select by task:

| Task Output | Model | Tier | Rule |
|-------------|-------|------|------|
| Settled, bounded implementation, test-writing, or routine fix following an approved plan/spec and established patterns | `gpt-5.6-luna` | Fast | Use the cost-efficient path when scope and expected behavior are clear, risk is low, and the change is straightforward. Code output alone does not require standard tier. |
| Implementation or tests requiring novel logic, unresolved requirements, substantial refactoring, or difficult technical judgment | `gpt-5.6-terra` | Standard | Use a stronger model when the work must reason through complexity or uncertainty rather than execute a settled design. |
| Large, complex implementation from a settled specification | `gpt-5.3-codex` | Standard specialist | Use for heavy code generation or large multi-file work; do not select solely because code is being written. |
| Straightforward non-code work (docs, routine planning, triage, logs, changelogs, mechanical ops) | `gpt-5.6-luna` | Fast | Cost first for work that does not need sustained complex reasoning. |
| Writing prompts or agent designs that still require design or careful behavioral reasoning | `gpt-5.6-terra` | Standard | Treat executable instructions like code when creating or redesigning them; routine edits to settled instructions can use Fast. |
| Visual/design work requiring image analysis | `gpt-5.6-sol` | Premium | Vision capability required. Overrides cost rule. |

**Role-to-model mapping** (for the current roster; task-aware rules above take precedence):

| Role | Default Model | Why | Override When |
|------|--------------|-----|---------------|
| Lead | auto (per-task) | Mixes coordination, planning, and reviews | Settled planning/triage → Fast; architecture, unresolved requirements, or high-stakes review → Standard or Premium as indicated below |
| Core Dev | auto (per-task) | Implements core/CLI work; follows the same cost-aware code rule | Settled, bounded implementation → Fast; ambiguous or complex implementation → Standard; large code generation → `gpt-5.3-codex` |
| Provider Dev | auto (per-task) | Implements provider integrations, where OAuth, HTTP, or quota behavior can affect risk | Settled adapter work with established patterns → Fast; uncertain integration behavior or difficult debugging → Standard; security-sensitive work → Premium |
| Tester | auto (per-task) | Covers tests and fixtures; effort ranges from routine cases to subtle contract reasoning | Tests from settled requirements and known patterns → Fast; ambiguous contracts or complex test design → Standard |
| Scribe | `gpt-5.6-luna` | Decision merging and other mechanical record-keeping | Keep routine work Fast; use a stronger model only if explicitly assigned substantive analysis instead of its normal role |
| Ralph | `gpt-5.6-luna` | Routine monitoring, status checks, and evidence reporting | Use Standard only when a requested investigation requires substantial synthesis or judgment |
| Rai | auto (per-task) | RAI review can range from bounded checklist work to consequential risk judgment | Routine, low-risk checks → Fast; substantial or high-impact RAI judgment/reviewer gate → Premium |
| Fact Checker | auto (per-task) | Verification ranges from checking clear claims to evaluating disputed or complex evidence | Clear, bounded verification → Fast; conflicting evidence or difficult judgment → Standard; high-risk reviewer gate → Premium |
| @copilot | auto (per-task) | Coding-agent work ranges from small specified fixes to broader features | Clear, isolated work → Fast; ambiguous, high-risk, or complex work → Standard or Premium as indicated below |

**Task complexity adjustments** (apply the single best fit; do not cascade):
- **Use Fast (`gpt-5.6-luna`) for settled execution:** bounded implementation or tests, boilerplate, scaffolding, routine fixes, typo fixes, renames, changelogs, and version bumps when the plan/spec is settled, patterns are established, and risk is low.
- **Use Standard (`gpt-5.6-terra`) when judgment is needed:** unresolved requirements, design choices, novel logic, complex debugging, substantial refactoring, or nontrivial technical analysis.
- **Bump UP to Premium:** architecture proposals, consequential reviewer gates, security audits, or multi-agent coordination whose output feeds 3+ agents. Do not bump routine execution merely because it is code.
- **Switch to code specialist (`gpt-5.3-codex`):** large multi-file refactors or heavy code generation (about 500+ lines), including complex implementation from a settled spec.
- **Switch to analytical diversity (`gemini-3.1-pro`):** code reviews where a second perspective helps, security reviews, or architecture reviews after a rejection.

**Layer 4 — Default:** If nothing else matched, use `gpt-5.6-luna`. If the uncertainty is specifically about unresolved requirements or difficult technical judgment, use Standard; reserve Premium for the cases above.

**Fallback chains — when a model is unavailable:**

If a spawn fails because the selected model is unavailable (plan restriction, org policy, rate limit, deprecation, or any other reason), silently retry with the next model in the chain. Do NOT tell the user about fallback attempts. Maximum 3 retries before using the platform default fallback.

```
Premium:  gpt-5.6-sol → claude-opus-5 → claude-opus-4.8 → claude-opus-4.7 → claude-opus-4.6 → claude-sonnet-4.6 → (omit model param)
Standard: gpt-5.6-terra → claude-sonnet-5 → claude-sonnet-4.6 → gpt-5.5 → gpt-5.4 → gpt-5.3-codex → claude-sonnet-4.5 → gemini-3.1-pro → (omit model param)
Fast:     gpt-5.6-luna → claude-haiku-4.5 → gpt-5.4-mini → gpt-5-mini → (omit model param)
```

`(omit model param)` = call the `task` tool WITHOUT the `model` parameter. The platform uses its built-in default. This is the platform default fallback — it lets the platform choose the model.

**Fallback rules:**
- If the user specified a provider ("use Claude"), fall back within that provider only before using the platform default fallback
- Never fall back UP in tier — a fast/cheap task should not land on a premium model
- Log fallbacks to the orchestration log for debugging, but never surface to the user unless asked

**Passing the model to spawns:**

Pass the resolved model as the `model` parameter on every `task` tool call:

```
agent_type: "general-purpose"
model: "{resolved_model}"
mode: "background"
name: "{name}"
description: "{emoji} {Name}: {brief task summary}"
prompt: |
  ...
```

Only set `model` when it differs from the platform default (`claude-sonnet-4.6`). If the resolved model IS `claude-sonnet-4.6`, you MAY omit the `model` parameter — the platform uses it as default.

If you've exhausted the fallback chain and reached the platform default fallback, omit the `model` parameter entirely.

**Spawn output format — show the model choice:**

When spawning, include the model in your acknowledgment:

```
🔧 Runtime Engineer (claude-sonnet-5) — refactoring auth module
🎨 Experience Engineer (gpt-5.6-sol · vision) — designing color system
📋 Scribe (gpt-5.6-luna · fast) — logging session
⚡ Lead (gpt-5.6-sol · bumped for architecture) — reviewing proposal
📝 Docs Engineer (gpt-5.6-luna · fast) — updating docs
```

Include tier annotation only when the model was bumped or a specialist was chosen. Default-tier spawns just show the model name.

**Valid models (current platform catalog):**

Premium: `gpt-5.6-sol`, `claude-opus-5`, `claude-opus-4.8`, `claude-opus-4.7`, `claude-opus-4.6`
Standard: `gpt-5.6-terra`, `claude-sonnet-5`, `claude-sonnet-4.6`, `claude-sonnet-4.5`, `gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`, `gemini-3.1-pro`
Fast/Cheap: `gpt-5.6-luna`, `claude-haiku-4.5`, `gpt-5.4-mini`, `gpt-5-mini`
