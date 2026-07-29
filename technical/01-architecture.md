# 01 — Runtime Architecture

Source of truth: `src/entrypoints/cli.tsx`, `src/main.tsx`, `src/QueryEngine.ts`, `src/query.ts`,
`src/tasks/`, `src/services/`, `src/state/AppState.tsx`.

## Process layout

```
bin/ur.js  →  dist/cli.js (bundled from src/entrypoints/cli.tsx)
                 │
                 ├─ fast paths (no full CLI load):
                 │    --version                     → prints "<version> (UR-Nexus)"
                 │    a2a serve                     → Agent-to-Agent HTTP server (src/services/agents/a2aServer.ts)
                 │    --ur-in-chrome-mcp            → Chrome-extension MCP server
                 │    --chrome-native-host          → Chrome native-messaging host
                 │    remote-control|rc|remote|sync|bridge → BRIDGE_MODE build only (not in npm build)
                 │    ps|logs|attach|kill, --bg     → BG_SESSIONS build only (not in npm build)
                 │    daemon [subcommand]           → DAEMON build only (not in npm build)
                 │    environment-runner            → BYOC_ENVIRONMENT_RUNNER build only
                 │    self-hosted-runner            → SELF_HOSTED_RUNNER build only
                 │    --worktree --tmux             → exec into tmux worktree before full load
                 │    --bare                        → sets UR_CODE_SIMPLE=1 (minimal mode)
                 │
                 └─ src/main.tsx  → commander CLI → Ink REPL (src/screens/REPL)
```

## The interactive loop

1. **REPL (Ink/React)** — renders the prompt, transcript, permission dialogs, spinners,
   status line, and dialog launchers (`src/screens/`, `src/components/`, vendored Ink fork in
   `src/ink/`). Input supports vim mode (`src/vim`), custom keybindings (`src/keybindings`),
   paste/image handling, `!` shell mode, and `/` command typeahead.
   Visual language: thinking blocks render dim/italic labeled "model reasoning to itself"
   (left-bordered when expanded via ctrl+o); user-facing answers carry an accent-colored ⏺
   marker; the live task panel (TaskListV2) is pinned in the fixed bottom region above the
   prompt — visible while the agent works, statuses updating in real time (ctrl+T toggles).
2. **Interactive controller** (`src/screens/REPL.tsx`) — owns the interactive
   conversation state and calls `query()` directly after assembling the system prompt,
   tools, permissions, hooks, file-state cache, and session state.
3. **QueryEngine** (`src/QueryEngine.ts`) — owns the equivalent multi-turn lifecycle for
   headless and SDK sessions. Its source explicitly reserves REPL integration for a future
   phase; it is not the controller used by `REPL.tsx`.
4. **query.ts** — the shared provider-agnostic agent loop: streams native
   Anthropic/OpenAI/Gemini/Ollama/OpenAI-compatible responses, validates and dispatches tool
   calls, applies permissions/hooks, and yields model/tool messages.
5. **Context management** — auto-compaction (`src/services/compact/`), context collapse
   (`src/services/contextCollapse/`), token accounting shown by `/context` and `/ctx_viz`.

## Execution reliability contract

Every main-session system prompt, including `--bare`, receives the same compact six-step
contract from `src/constants/executionContract.ts`: scope the request, act through structured
tools, maintain an ordered plan for 3+ steps, inspect every result, run proportional
verification, and report only observed evidence. Independent calls may be batched (up to
eight); dependent read → decide → write chains remain sequential. The contract also forbids
unchanged retries, empty turns, fabricated completion, and treating untrusted tool output as
instructions.

This is enforced beyond prompt wording:

- `src/services/tools/taskListGate.ts` blocks state-changing calls once the initial
  lightweight allowance is consumed unless an actionable task exists. Delegation and
  subagent mutations always require a parent task. Reads remain unrestricted.
- `src/services/tools/repeatedFailureGuard.ts` tracks canonicalized failing calls, refuses
  repeated identical failures, then aborts the stuck turn at a bounded threshold.
- the tool execution boundary revalidates the final input after hook rewrites; a hook cannot
  rewrite an already-approved call into an unvalidated or unapproved operation.
- `src/services/verifier/` ties file/command/test completion claims to successful tool
  results and issues a bounded corrective nudge when evidence is missing.
- provider adapters reject malformed, duplicate, incomplete, or non-object tool calls.
  Ollama additionally recovers conservative text-form calls for weaker models and preserves
  mixed text/image tool results.

## Command types (`src/types/command.ts`)

| Type | Meaning |
|---|---|
| `prompt` | Expands to text that is sent to the model (skills, `/commit`, `/review`, …) |
| `local` | Runs TypeScript locally and prints text output (`/cost`, `/eval`, `/bg`, …) |
| `local-jsx` | Renders an interactive Ink dialog (`/config`, `/model`, `/agents`, …) |

Commands come from seven static sources merged in `src/commands.ts:getCommands()` (priority order):
bundled skills → built-in plugin skills → skill-dir commands (`.ur/skills`, `~/.ur/skills`) →
workflow commands → plugin commands → plugin skills → built-ins. Availability is filtered per
auth state (`availability: 'ur-ai' | 'console'`) and per command `isEnabled()`. Dynamic skills
are inserted before built-ins. `normalizeCommandTokens()` then makes lookup deterministic:
the first source to claim a canonical or user-facing token wins, later canonical collisions
are omitted, and only conflicting aliases are removed from otherwise distinct commands.

## Background task types (`src/tasks/types.ts`)

| Task type | What it is |
|---|---|
| `LocalShellTask` | A backgrounded shell command (Bash tool `run_in_background`, `/tasks` list) |
| `LocalAgentTask` | An in-process subagent run (Agent tool / `/bg`-style local agents) |
| `RemoteAgentTask` | A cloud/remote agent session |
| `InProcessTeammateTask` | A teammate agent implementation registered in every build; instances are created only while agent-teams/swarm mode is enabled |
| `LocalWorkflowTask` | Reserved WORKFLOW_SCRIPTS state type; the standard npm build does not create it |
| `MonitorMcpTask` | Reserved MONITOR_TOOL state type; the standard npm build does not create it |
| `DreamTask` | Background auto-memory consolidation task; the implementation is always registered, while runs require `autoDreamEnabled` or its runtime feature configuration |

`/tasks` (alias `/bashes`) shows active states held in `AppState`. `TaskStop` can stop only
types with a registered concrete implementation; persisted unknown or source-only task
types fail with `unsupported_type` instead of pretending cleanup succeeded.

## Services worth knowing (`src/services/`)

- `providers/` — provider registry, credentials, connection tests (see doc 05).
- `mcp/` — MCP client (stdio/SSE/HTTP), OAuth for MCP servers, tool/resource discovery.
- `lsp/` — Language Server Protocol client used by the LSP tool and `/ide` diagnostics.
- `agents/` — the multi-agent layer: a2aServer, acpServer, arena, crew, decomposer,
  escalation, intentRouter, modelRouter, headlessAgent, backgroundRunner, evals, benchmarks,
  goals, spec, workflows, knowledge, learning, memoryRetention (see docs 09/10).
- `verifier/` — done-detector, loop-detector, project quality gates, subagent nudges.
- `guardrails/` — declarative input/output guardrails engine (see doc 12).
- `safety/` — project shell-safety policy engine (see doc 12).
- `compact/`, `contextCollapse/`, `SessionMemory/`, `extractMemories/` — context and memory.
- `settingsSync/`, `remoteManagedSettings/`, `policyLimits/` — settings distribution and org policy.
- `analytics/`, `telemetry` (OTel) — usage metrics; disabled in `--offline`.

## State on disk

| Path | Contents |
|---|---|
| `~/.ur/` | Global config, session registry, logs, and secure-storage data. macOS uses Keychain when available; other platforms currently use a mode-0600 file fallback |
| `~/.ur/projects/<slug>/` | Per-project session transcripts and history |
| `.ur/` (repo) | Project state: `settings.json`, `settings.local.json`, `artifacts/`, `specs/`, `workflows/`, `guardrails/`, `safety-policy.json`, `knowledge/`, `memory/`, `index/`, `tools/`, `devcontainer.json`, `automations/`, `evals/`, `context/`, `runs/`, `actions.jsonl` (stability ledger) |
| `UR.md` / `UR.local.md` | Project instruction memory (analogue of CLAUDE.md), auto-loaded each session |

## Local web surface

The artifacts server (`/artifacts serve`) hosts everything reviewable on one
port: `/artifacts`, `/diff`, `/dashboard` (cloud tasks, background agents,
task board, learning stats), `/threads/<id>` (shared session transcripts via
`ur thread share`), and `/api/dashboard` for JSON.

## Native/TS subsystems

- `src/native-ts/yoga-layout`, `color-diff`, `file-index` — vendored native-speed helpers.
- `src/ssh/` — SSH remote-session source used only by builds compiled with `SSH_REMOTE`;
  the standard npm build does not expose `ur ssh`.
- `src/upstreamproxy/` — proxying model traffic through a configured upstream.
- `src/voice/` — voice-input subsystem. The standard npm bundle is compiled
  with `VOICE_MODE`; actual use still requires UR OAuth, the runtime kill-switch
  to remain enabled, microphone access, and a supported audio backend.
- `src/buddy/` — companion sprite UI (feature-gated `BUDDY`).
