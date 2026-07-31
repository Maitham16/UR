# UR-Nexus — project memory

UR-Nexus is this repo: `ur-agent` on npm, binary `ur`. A terminal coding agent
(Ink/React TUI) with local-first model support. You are likely being run BY the
very code you are editing — be careful, verify, and prefer small reviewable steps.

## Ground rules

- bun is canonical: `bun test`, `bun run typecheck`, `bun run lint`, `bun run build`.
  bun.lock is the only lockfile — never commit package-lock.json or yarn.lock.
- The full test suite must stay at 0 failures. Never use bun's global
  `mock.module()` in tests — it replaces modules for every test file in the
  process and poisons unrelated suites. Never import `ink-testing-library`
  (not a dependency; the repo vendors its own Ink fork in `src/ink/`).
- Many `src/` files are compiled react-compiler artifacts (`@ts-nocheck`,
  memo-cache `$[n]` arrays, trailing base64 sourcemap comments). When editing
  them: keep memo-cache dependency arrays consistent, or rewrite the file as
  clean TSX. New code is always clean TSX/TS.
- Release checklist (RELEASE.md): version must move in package.json,
  bunfig.toml MACRO.VERSION, documentation/index.html eyebrow, and
  extensions/vscode-ur-inline-diffs/package.json together, plus a CHANGELOG
  entry, then `bun run build` so dist/cli.js embeds it.
- `.ur/` is machine-local agent state (gitignored piece by piece) — never
  commit files under it without checking .gitignore.

## Architecture map (verified against code; details in technical/)

- Registries: commands `src/commands.ts` · tools `src/tools.ts` · providers
  `src/services/providers/providerRegistry.ts` · settings schema
  `src/utils/settings/types.ts` · hook events `src/entrypoints/sdk/coreTypes.ts`.
- Entry: `src/entrypoints/cli.tsx` (fast paths) → `src/main.tsx` (commander)
  → `src/screens/REPL.tsx` (Ink). Turn engine: `src/QueryEngine.ts` + `src/query.ts`.
- Ollama is the default backend (`src/services/api/ollama.ts`). Its tool-call
  pipeline is fragile with small local models — see "Local-model lessons".
- Text-form tool-call recovery lives in `src/cli/transports/kimiToolCalls.ts`
  (Kimi markers + bare-JSON args detection).
- Task system v2: tools TaskCreate/TaskUpdate/TaskGet/TaskList; store
  `src/utils/tasks.ts` (file-backed, fs-watched); pinned panel
  `src/components/TaskListV2.tsx` renders in REPL's fixed bottom region.
- File checkpoints: `src/utils/fileHistory.ts` — per-snapshot backups;
  `/rewind` restores checkpoints, `/undo` restores only the last-edited file's
  pre-turn content (never the v1 session-start backup — that was a data-loss bug).

## Local-model lessons (hard-won; do not regress)

- Ollama streams each completed tool call in its OWN chunk as a single-element
  array. Never merge tool_calls positionally by chunk index — append
  (`mergeToolCalls` in ollama.ts) or multi-call turns collapse to one call.
- Small models emit almost-JSON tool args (raw newlines inside strings,
  fences, trailing commas). Always repair via `parseToolInputJsonLenient`
  (src/utils/json.ts) before falling back to `{}` — a silent `{}` input
  surfaces as "required parameter missing" and traps models in retry loops.
- Models may emit the same call natively AND as narrated JSON text — dedupe
  by reconciled name + canonical (key-sorted) args before emitting blocks.
- If a model doesn't advertise the `tools` capability in `/api/show`, tool
  definitions are silently dropped; the system prompt gets a bare-JSON
  format hint and everything depends on text parsing. Prefer tools-capable
  models; check with `/model-doctor <model>`.

## UI conventions

- Thinking blocks: dim italic, labeled "model reasoning to itself — not the
  answer", left-bordered when expanded. Answer text: accent-colored ⏺ dot.
  Keep this contrast — users must never confuse internal reasoning with answers.
- The task panel stays pinned above the prompt while working; statuses update
  live (✔ done, ■ in progress, □ pending). When the user says "add to your
  tasks …", create the task immediately (TaskCreate prompt has the rule).

## Learning loop

- Learning is automatic: ci-loop / arena / escalation / test-first record
  pass/fail per category+model into `.ur/learning/stats.json` on completion
  (`recordOutcome` in learning.ts — pure JSON, never throws). The `auto`
  route strategy and escalate's difficulty bias consume it; ≥3 runs at ≥60%
  pass rate lets a proven cheap model win the route (that's the token saver).
  Never make recording able to fail a run, and never let thin evidence
  override the static heuristics.
- `autoMemoryExtractionInterval` setting throttles the turn-end auto-memory
  extraction fork (default 1 = every turn) — it's the user's token dial.

## Docs

- `technical/` holds code-derived specs (commands, tools, providers, config,
  memory, multi-agent, integrations). Regenerate from code, never from README.
- CHANGELOG.md entry style: user-facing impact first, implementation second.
