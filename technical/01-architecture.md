# 01 — Runtime Architecture

Source of truth: `src/entrypoints/cli.tsx`, `src/main.tsx`, `src/QueryEngine.ts`, `src/query.ts`,
`src/tasks/`, `src/services/`, `src/state/AppState.ts`.

## Process layout

```
bin/ur.js  →  dist/cli.js (bundled from src/entrypoints/cli.tsx)
                 │
                 ├─ fast paths (no full CLI load):
                 │    --version                     → prints "<version> (UR-Nexus)"
                 │    a2a serve                     → Agent-to-Agent HTTP server (src/services/agents/a2aServer.ts)
                 │    --ur-in-chrome-mcp            → Chrome-extension MCP server
                 │    --chrome-native-host          → Chrome native-messaging host
                 │    remote-control|rc|remote|sync|bridge → bridge (remote-control) daemon
                 │    ps|logs|attach|kill, --bg     → background session registry (~/.ur/sessions/)
                 │    daemon [subcommand]           → long-running supervisor (feature-gated)
                 │    environment-runner            → headless BYOC runner (feature-gated)
                 │    self-hosted-runner            → self-hosted runner poller (feature-gated)
                 │    --worktree --tmux             → exec into tmux worktree before full load
                 │    --bare                        → sets UR_CODE_SIMPLE=1 (minimal mode)
                 │
                 └─ src/main.tsx  → commander CLI → Ink REPL (src/screens/REPL)
```

## The interactive loop

1. **REPL (Ink/React)** — renders the prompt, transcript, permission dialogs, spinners,
   status line, and dialog launchers (`src/screens/`, `src/components/`, vendored Ink fork in
   `src/ink/`). Input supports vim mode (`src/vim`), custom keybindings (`src/keybindings`),
   paste/image handling, `!` shell mode, `#` memory notes, and `/` command typeahead.
   Visual language: provider thinking stays private on the normal screen and renders as
   dim/italic, left-bordered diagnostics only in transcript or verbose mode. Live ordinary
   assistant drafts are not mounted on the normal screen, and completed text blocks paired
   with a tool call are treated as work preludes and omitted there. Completed self-talk that
   is part of an answer renders as a one-line `Reasoning condensed` rail. These transformations
   are display-only: the stored message, exported transcript, and next-turn model context stay
   unchanged. User-facing final answers carry an accent-colored ⏺ marker. The
   `◭ Mashoofing…` activity row stays mounted through thinking, request, response, tool
   preparation, and tool execution. It appends the current in-progress task from the task
   board after the ellipsis, then parenthesized detail derived from the live phase; both are
   width-gated to keep the activity surface on one line.
   The task panel (TaskListV2) is pinned in the fixed bottom region above the prompt —
   visible while the agent works, statuses updating in real time (ctrl+T toggles). A prompt
   establishes a generation boundary but does not fabricate a planning task. The panel appears
   only after the model creates concrete tasks for genuinely multi-step, dependent, delegated,
   or explicitly requested tracked work. Direct one-step changes, informational replies,
   acknowledgements, and small corrections therefore keep the task surface quiet. Generation
   rollover preserves pending/in-progress snapshots after interruption; corrective replies,
   including `no` / `still` feedback, update relevant work rather than becoming new task titles.
   Legacy automatic placeholders from builds through 1.78.13 are hidden immediately and
   removed safely at the next generation boundary without reusing their task IDs.
2. **QueryEngine** (`src/QueryEngine.ts`) — orchestrates a turn: builds the system prompt,
   assembles the tool pool (`src/tools.ts:assembleToolPool` — built-ins + MCP, deny-rule
   filtered, sorted for prompt-cache stability), streams the model response, dispatches tool
   calls through the permission layer (`src/utils/permissions/`), runs hooks
   (`src/utils/hooks/`), tracks cost (`src/cost-tracker.ts`), and persists history
   (`src/history.ts`). It also owns bounded context recovery. Proactive compaction normally
   runs before the request; if a
   provider still rejects the live request for context size, the external build withholds
   that transient error, makes one media-stripped summary attempt, installs the compact
   boundary, and retries. Original messages remain in transcript storage and a second
   overflow surfaces normally rather than looping.
3. **query.ts** — the low-level provider-agnostic model call (native Anthropic/OpenAI/Gemini/
   Ollama/OpenAI-compatible streaming; `src/services/providers/` decides the backend).
4. **Context management** — auto-compaction (`src/services/compact/`), context collapse
   (`src/services/contextCollapse/`), token accounting shown by `/context` and `/ctx_viz`.

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
| `InProcessTeammateTask` | A teammate agent in agent-teams/swarm mode |
| `LocalWorkflowTask` | A running declarative workflow (`/workflow run`) |
| `MonitorMcpTask` | A Monitor-tool watch on an MCP resource/condition |
| `DreamTask` | Idle-time proactive task (KAIROS feature gate) |

All are visible in `/tasks` (alias `/bashes`) and stoppable via the `TaskStop` tool.

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
| `~/.ur/` | Global config, credentials (keychain-backed via `src/utils/secureStorage`), session registry, logs |
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
- `src/ssh/` — SSH remote sessions (`ur ssh <host>`).
- `src/upstreamproxy/` — proxying model traffic through a configured upstream.
- `src/voice/` — voice input mode (ships enabled as of 1.45; native audio backend optional).
- `src/buddy/` — companion sprite UI (feature-gated `BUDDY`).
