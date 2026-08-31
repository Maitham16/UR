# Usage Guide

UR is a terminal agent. Running `ur` opens an interactive session in the current directory, while `ur -p` runs one non-interactive prompt and exits.

## Interactive Mode

```sh
ur
```

On the first interactive run in a folder without a workspace model, UR opens
the provider-first model picker before the REPL. A validated choice is saved to
`.ur/settings.local.json` and reused in that workspace. A global user model is
not silently copied into new folders. Shared `.ur/settings.json`, managed,
`--settings`, agent, CLI, environment, and resumed-session choices remain
explicit inputs and skip this one-time picker.

Use interactive mode for iterative coding, debugging, research, and repository exploration. The session can read project instructions, use tools, call slash commands, and keep resumable conversation history.

Useful options:

```sh
ur --model qwen2.5-coder:7b
ur --add-dir ../other-project
ur --permission-mode ask
ur --continue
ur --resume
ur --screen-reader
```

Useful commands from inside UR:

```text
/config thinking=false screenReader=true
/config editor=vim vimEscape=jj
/session list
/session archive
/session unarchive <session-id>
/fix-bug describe the failure and reproduction steps
/research init current-tools --question "What changed?"
/mode redteam
/design3d doctor
/design3d init product-shot --engine blender --units mm --format blend
/design3d init studio-scene --engine 3dsmax --units cm --format max
```

`/mode redteam` is a session-only security-research policy mode. Its first use
shows a mandatory warning and requires `/mode redteam --accept-risk`. It removes
UR's topic-level security restrictions while retaining target scope, tool
permissions, sandboxing, action approvals, and audit evidence. It cannot change
the selected provider/model's own policy. See [Redteam mode](REDTEAM.md).

`/design3d doctor` reports installed applications. `MISSING` means that optional
application is not installed or is not on `PATH`; it is not a UR failure. On
macOS, Autodesk 3ds Max is expected to be missing because it is a Windows
application. Use Blender locally, or run the 3ds Max project on a Windows host.

When UR needs a focused clarification, it uses the `AskUserQuestion` dialog.
Professional clarification prompts can provide up to eight concrete options;
UR also accepts custom "Other" answers. If a model supplies only one concrete
suggestion, UR keeps it and adds a neutral `Different answer` rejection path
instead of showing an internal validation error or inventing another choice.

## Print Mode

Print mode is useful for scripts and shell pipelines:

```sh
ur -p --model qwen2.5-coder:7b "write a changelog entry for the current diff"
```

In a fresh workspace without a configured model, print mode exits before any
model request and tells the caller to pass `--model <model>` or run interactive
setup. This keeps automation deterministic instead of selecting a default.

Output formats:

```sh
ur -p --output-format text "explain src/main.tsx"
ur -p --output-format json "return a JSON summary of this repo"
ur -p --output-format stream-json "stream progress while answering"
ur -p --output-format stream-json --forward-subagent-text "delegate and stream nested results"
```

WebSearch allows 200 provider searches per session by default. Set
`UR_MAX_WEB_SEARCHES_PER_SESSION` to another positive integer, or to
`unlimited` only for a trusted long-running job.

Structured output can be validated with a JSON schema:

```sh
ur -p \
  --output-format json \
  --json-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}' \
  "summarize this project"
```

## Models And Providers

For Ollama sessions, the wrapper in `bin/ur.js` honors explicit model choices
in this order:

1. `OLLAMA_MODEL`
2. `UR_MODEL`

If neither variable is set, a fresh workspace requires an interactive choice.
After the provider/model pair has been stored locally, that exact pair is used
for subsequent sessions.

You can also choose the model for a single session:

```sh
ur --model qwen2.5-coder:7b
ur --model qwen2.5-coder:latest
```

UR talks to the local Ollama app at `http://localhost:11434/api` by default, but you can point it at another Ollama server on your LAN or in another location:

```sh
# Discover and pick a LAN Ollama server at startup (session only)
ur --discover-ollama

# Point to a specific Ollama server for this session
ur --ollama-host http://192.168.1.50:11434

# Persistent setting (plain `ur` uses this host automatically)
ur --settings '{"ollama":{"host":"http://192.168.1.50:11434"}}'
```

Precedence: `--ollama-host` > `OLLAMA_HOST` env > `ollama.host` setting > `localhost:11434`.

`--discover-ollama` shows the picker every time but does **not** save the choice;
use `ollama.host` in settings if you want plain `ur` to default to a LAN host.

Models exposed by the chosen Ollama app are valid, including local models and
Ollama Cloud-backed models.

Ollama waits up to 15 minutes for response headers so cold loads and long
prefill are not mistaken for failure. Once streaming begins, local and Cloud
models use a five-minute *inactivity* watchdog that resets on every chunk; a
healthy long answer has no total runtime cutoff. Remote/CCR sessions and Cloud
non-streaming fallback retain a two-minute bound. Set
`UR_STREAM_IDLE_TIMEOUT_MS` for the stream-silence window or `API_TIMEOUT_MS`
for an explicit request-wide override.

When project verification requires approval, UR asks once per user turn. The
same pending compile/test/lint gate is not presented again after the user has
answered; a later user task can request its own approval normally.

UR-Nexus also has explicit provider commands for legal access paths:

```sh
ur provider list
ur provider status
ur provider doctor
# Optional external app bridge diagnostics:
ur auth chatgpt
ur config set provider ollama
ur provider doctor agy
ur config set provider openai-api
ur config set provider anthropic-api
ur config set provider gemini-api
ur config set provider openrouter
ur config set provider openai-compatible
ur config set provider unsloth
ur config set model <model>
ur config set base_url <url>
ur config set base_url <provider> <url>
ur config set provider.fallback ollama
ur config set openai_transport responses
ur config set responses.store false
ur config set responses.compact_threshold 20000
ur config set responses.tool_search hosted
```

`provider.fallback` only controls the recovery suggestion printed by provider
diagnostics. UR does not switch or retry across providers automatically; use
`ur config set provider <id>` after reviewing the failure.

The OpenAI API continues to use Chat Completions by default. Selecting
`openai_transport responses` opts into Responses semantic streaming,
background/poll/cancel support, WebSocket continuation, server compaction, and
deferred tool search. Remote storage is off by default. Local state contains
only bounded identifiers/status/cursors unless a 32-byte
`UR_OPENAI_RESPONSES_STATE_KEY` is supplied for AES-256-GCM compacted context.

In the interactive app, `/model` chooses a provider first and then a model from
that provider only. The saved pair controls the runtime backend for the next
agent request. There is no cross-provider fallback: OpenAI API does not fall
back to Ollama, Claude API does not fall back to Claude Code, and local/server
providers do not leak cloud model lists. Use `ur provider status` to inspect the
active provider, model, access type, and runtime backend.

The provider list shows API, local/server, and subscription CLI providers.
Subscription CLIs (Codex CLI, Claude Code, Gemini CLI, Antigravity) are
first-class: selecting one dispatches turns through the vendor's official CLI
using your subscription login (`ur auth <provider>`). The generic
`subscription` entry is an internal placeholder and is hidden from listings;
UR does not list fake subscription models.

Subscription CLI providers have an explicit external-CLI boundary. UR passes
prompt text to the official CLI and receives final text output. UR-native tool
calling, UR Bash/File tool execution, UR-native streaming, local command
permissions, sandbox guarantees, and verifier/done-gate checks apply to UR-run
tools/final UR output, not to actions the external CLI performs internally.
Use `ur provider status` or `ur provider doctor <provider>` to see provider
kind, external CLI usage, native tool/streaming support, and the boundary text.

Provider values accept canonical IDs and common aliases. For example,
`openai-api`, `anthropic-api`, `gemini-api`, `openrouter`, `ollama`,
`lmstudio`, `llama.cpp`, `vllm`, and `unsloth` are UR-native runtime providers, and
`codex-cli` (`chatgpt`), `claude-code-cli` (`claude`), `gemini-cli` (`gemini`),
and `antigravity-cli` (`agy`) are subscription CLI providers.

API modes are explicit. Keys are read from a key stored via
`ur connect <provider>` (OS keychain) or from the environment variables
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and
`OPENROUTER_API_KEY`, and `UNSLOTH_API_KEY`. Subscription CLIs are optional, never required
dependencies, and never used as a silent fallback. UR-Nexus never scrapes
browser sessions, extracts OAuth tokens, or bypasses provider restrictions.
OpenAI-compatible local or cloud endpoints use `base_url` plus `model`.
Unsloth defaults to `http://localhost:8888/v1`, requires its Studio API key,
and is inference-only: UR does not manage Unsloth and disables its server-side
tools while retaining standard function calls inside UR's guarded tool loop.

UR stores `base_url` per provider. You can set different addresses for
Ollama, llama.cpp, vLLM, and Unsloth once, then switch providers without
re-entering any of them. `ur config get base_url` always reports the address
for the currently active provider.
Use `ur config set base_url <provider> <url>` to change one provider's address
without making it active first. The `/model` picker offers the same endpoint
entry flow for a disconnected local/server provider.

Use `/model` in an interactive session to select provider first and model
second. OpenAI API, Claude API, Gemini API, OpenRouter, Ollama, and
OpenAI-compatible endpoints stay separate; a subscription login does not grant
API-key access, and an API key does not grant subscription CLI access.

## Project Instructions

Add a `UR.md` file to the repository root for team-shared instructions. UR loads it as project context.

Use `UR.local.md` for private local instructions. It is ignored by `.gitignore`.

Project `.ur/` assets can hold settings, skills, agents, MCP config, and local runtime state. Commit only shared files. Keep local memory, generated indexes, logs, and local settings untracked.

For a manifest-backed summary of the repository, run:

```sh
ur context-pack scan
ur context-pack remember --decision "Use package scripts before ad hoc commands"
ur context-pack compress
```

## Project memory

`ur context-pack remember` stores durable project memory in `.ur/context/task-memory.jsonl`. Use it to record decisions, constraints, preferred commands, failed attempts, accepted patterns, rejected approaches, and architecture notes. The compressed summary in `.ur/context/compressed.md` is included in agent context.

Memory kinds:

- `decision`, `constraint`, `command`, `diff`, `note` — original task memory categories.
- `architecture` — architecture decisions and design rationale.
- `preference` — preferred commands, tools, or workflows.
- `attempt` — things you tried that did not work out (often written by `OnFailure` hooks).
- `accepted` — patterns or approaches that worked and should be reused.
- `rejected` — approaches that should not be repeated, optionally with an `alternative-to`.

```sh
ur context-pack remember --architecture "Repository pattern for data access" --status accepted --rationale "Testability"
ur context-pack remember --preference "Use bun test over jest"
ur context-pack remember --accepted "Use p-map for bounded concurrency" --scope project
ur context-pack remember --rejected "Switch to esbuild" --alternative-to "Keep bun bundle"
ur context-pack remember --attempt "Tried Deno runtime" --status superseded
ur context-pack remember --decision "Keep streaming" --cite-file src/parser.ts --lines 20:48
ur context-pack memory verify
ur context-pack memory revalidate
ur context-pack memory search --query "streaming"
ur context-pack memory quarantine
ur context-pack memory rollback --to <entry-id>
ur context-pack compress
```

New entries carry explicit source provenance, optional file/run/user/web
citations, and form a SHA-256 hash chain. File and run citations are rechecked
against captured content digests; stale and superseded memory is excluded from
normal resolution. Reads fail closed on malformed or tampered state.
`quarantine` preserves the complete original privately and restores the
verified prefix; `rollback` preserves a backup before truncating to the
requested entry.

## Lifecycle hooks

UR supports lifecycle hook events that fire around agent actions. Hooks are configured in `.ur/hooks.json` or `UR.md` frontmatter and receive JSON payloads.

| Event | Fires | Payload |
| --- | --- | --- |
| `BeforeEdit` | Before `FileEditTool` writes a file. | `file_path`, `old_string`, `new_string`, `replace_all`, `tool_use_id` |
| `AfterEdit` | After a file edit succeeds. | Same as `BeforeEdit` plus `success: true`. Can write project memory. |
| `BeforeCommand` | Before a Bash/PowerShell command runs. | `command`, `shell_type`, `cwd`, `timeout_ms`, `sandbox`, `tool_use_id` |
| `AfterCommand` | After a command finishes. | `command`, `exit_code`, `stdout`, `stderr`, `tool_use_id` |
| `BeforeCommit` | After a successful `git commit` command. | `command`, `message`, `files`, `tool_use_id` |
| `OnFailure` | When a tool, turn, or API call fails. | `error`, `stage`, `tool_name`, `tool_use_id` |
| `Interrupt` | When a running turn is cancelled or replaced by a new prompt. | `reason`, `source`, optional `model` |
| `PreModelSwitch` | Before a picker, slash command, or CLI/config provider-model change is persisted. May block. | `from_provider`, `from_model`, `to_provider`, `to_model`, `source` |
| `PostModelSwitch` | After a provider-model change has been persisted and applied. | Same provider/model fields as `PreModelSwitch` |

Example `UR.md` frontmatter hook:

```yaml
---
hooks:
  - event: BeforeCommit
    command: 'echo "Commit detected: $UR_CODE_HOOK_INPUT" >> /tmp/ur-commits.log'
---
```

Hooks are advisory by default. A `BeforeEdit`/`BeforeCommand`/`BeforeCommit` hook can block the action by returning `{"decision":"block","reason":"..."}` or exit code 2. `AfterEdit` and `OnFailure` hooks can return `{"hookSpecificOutput":{"hookEventName":"...","memory":{"kind":"accepted","text":"..."}}}` to append project memory automatically.
`DirectoryAdded` fires after `/add-dir` authorizes and adds a directory, so
plugins and project automation can initialize directory-specific state.

## WebMCP site tools

With `UR_BROWSER_TOOL=1` and Playwright available, the built-in Browser tool
supports the imperative WebMCP API exposed by a live page. `site_tools` lists
tools registered through `document.modelContext.registerTool(...)`, and
`site_tool_call` invokes one by its exact name with JSON input. Browser-native
implementations are retained when present; UR installs a compatibility bridge
only when the browser does not expose the API.

Site definitions, schemas, and results are untrusted page content. Discovery is
read-only, invocation is classified as destructive and always passes through a
permission prompt, public-URL/redirect checks still apply, and names, inputs,
definitions, catalogue size, and outputs are bounded.

## Commands

UR includes slash commands and CLI subcommands for common workflows:

- `/help` or `ur --help` for command discovery
- `ur connect ...` to connect provider accounts (subscription login or stored API key)
- `ur mcp ...` to configure MCP servers, run the stdio server, or start the
  opt-in stateless Model Context Protocol Tasks/Apps server with `ur mcp serve-web`
- `ur ag-ui serve` to expose the secure AG-UI HTTP/SSE adapter to an explicitly
  allowed user-facing application
- `ur plugin ...` to manage plugins and marketplaces. Marketplace plugins can
  add MCP tools, commands, executable skills, templates, validators, language
  adapters, LSP servers, agents, hooks, and output styles. Use
  `ur plugin search [query]` for ranked cross-catalog discovery and
  `ur plugin show <name@marketplace>` to inspect provenance and capabilities
  before installation.
- `ur agents` to list configured agents
- `ur agent-trends` to inspect coverage for current agent technology trends
- `ur a2a card` to print legacy Agent Card metadata, or
  `ur a2a card --v1` to preview the current A2A 1.0 card
- `ur bg ...` to run and idempotently steer detached local background agents
  with optional worktrees and PRs
- `ur cloud ...` to run, synchronize, steer, and cancel local or managed
  best-of-N workers; managed selection requires explicit `PASS` plus a safe
  review branch and never fetches or merges it
- `ur agent-ci ...` to generate and run a policy-gated isolated CI agent that
  emits only a post-check, state-bound patch and manifest
- `ur workspace ...` to coordinate dependency-aware changes across repositories
- `ur learn playbooks ...` to mine and explicitly approve reusable workflows
- `/btw ...` to create or continue private durable tool-free side chats
- `ur repo-edit ...` to index the repo, map compiler/graph change impact, plan AST-aware edits, preview patches, and apply with rollback
- `ur research ...` to create evidence-backed workspaces with sanitized sources,
  cited findings, open questions, corroboration checks, and Markdown reports
- `ur design3d ...` to discover installed DCC/CAD apps and create, plan, build,
  inspect, or validate Blender, OpenSCAD, Autodesk 3ds Max, and reviewed custom
  application projects
- `ur safety ...` to inspect project shell safety policy and preview command risk
- `ur context-pack ...` to summarize architecture and persist project memory (decisions, constraints, commands, diffs, architecture, preferences, attempts, accepted, rejected)
- `ur code-index watch` to keep the local semantic code index fresh
- `ur code-index repo build` to build a richer semantic repo index (files, symbols, calls, tests, docs, configs)
- `ur skill init|run ...` for executable skill workflows, plus
  `ur skill verify|sign|keygen` for strict provenance and Ed25519 trust
- `ur memory retention ...` to prune project-local memory by TTL, max entries, and decay
- `ur spec ...` to scaffold requirements, design, and tasks, run a spec task list, and verify with strict proof gates
- `ur escalate ...` to plan, run, or ask an oracle model for hard tasks
- `ur arena ...` to verify multiple isolated candidates and select a winner
  with deterministic, model, or hybrid judging; oversized full diffs are
  excluded from model judging
- `ur test-first ...` to detect compile/test/lint commands, store failure traces, and install after-edit gates
- `ur ci-loop ...` to run tests in an explicit working directory, repair real
  failures, and rerun with a bounded loop. A "No tests found" result stops
  after one attempt and reports how to correct `--cwd`.
- `ur artifacts ...` to capture reviewable diffs, test runs, notes, feedback,
  and bounded non-symlink attachments with safe download headers/MIME fallback
- `ur ide diff ...` to capture editor-readable inline diff bundles
- `ur acp stdio` for the standard Agent Client Protocol editor transport with durable
  list/load/delete/resume, modes, config options, and commands; and
  `ur acp serve|stop|status` for the separate UR HTTP JSON-RPC API
- `ur exec ...` to run prompts in non-interactive mode with optional concurrency
- `ur eval run ...` to run isolated cases, grade redacted tool trajectories,
  and capture execution metrics
- `ur eval gate ...` to enforce pass, trajectory, test, cost, duration, and
  regression thresholds
- `ur eval report ...` to show a saved report or write a single-suite dashboard
- `ur eval dashboard` to generate the local HTML dashboard across all reports
- `ur eval bench ...` to import local SWE-bench, Terminal-Bench, or Aider Polyglot exports
- `ur crew ...` to run dependency-aware agent crews with parallel independent
  tasks and bounded, isolated worker recovery
- `ur pattern ...` to run multi-agent collaboration patterns (PEER, DOE, concurrent, handoff, debate, parallel)
- `ur workflow ...` to define, validate, graph, run, and resume declarative agent workflows
- `ur goal ...` to track long-horizon objectives that persist across sessions
- `ur task ...` to run worktree-per-task sessions with PR handoff
- `ur worktree ...` to list, inspect, and clean up UR agent worktrees
- `ur automation ...` to store and run project-local scheduled automation specs
- `ur sandbox ...` to inspect sandbox/permission architecture and command approval levels
- `ur knowledge ...` to manage a curated project knowledge base with provenance
- `ur semantic-memory ...` to build and search the project-local memory index
- `ur claim-ledger ...` to map generated claims to their sources
- `ur route ...` to classify a task and recommend a subagent and collaboration pattern
- `ur model-doctor` and `ur model-route ...` to inspect local Ollama models and pick one by capability fit
- `ur local-first` to report readiness for offline/no-cloud environments
- `ur browser-qa ...` to validate and smoke-run browser QA replay fixtures
- `ur desktop-qa ...` to run Electron fixtures with hashed masked screenshots;
  raw video/trace requires selector redaction to be disabled
- `ur trigger parse|run ...` to inspect GitHub/Slack/Teams/Gmail/generic payloads,
  and `ur trigger serve` to receive verified events over HTTP, deduplicate them,
  and resume one durable UR session per conversation (see
  [TRIGGERS.md](TRIGGERS.md))
- `ur agent-templates ...`, `ur agent-task ...`, `ur agent-inspect`, `ur agent-features`, and `ur agent-trends` for agent template, PR handoff, timeline, and coverage utilities
- `ur selftest run` spawns the shipped binary against real directories and
  checks the features end-to-end, then prints the manual drills — the ones
  needing a live model — as prompts with a concrete expectation each. Run it
  after upgrading; unit tests passing is not the same as the feature working.
- `ur sources` lists every untrusted block that entered the session (web fetches,
  MCP results) with its source, size, digest and any injection signals.
  `ur sources --check "<span>"` reports which source contains a span, or states
  that it was not grounded in anything fetched. The ledger is per-process and
  in-memory by design.
- `ur grade-trajectory --file <transcript.jsonl> --min-score 70` grades a run on
  tool choice, verification, instruction compliance, safety and efficiency, and
  exits non-zero below the threshold so it can gate CI. Rules are deterministic;
  no model judges another model.
- `ur agent-inspect --costs [subagentsDir]` breaks a fan-out down per agent.
  Subagent turns are never in the parent transcript — they are written to
  `{sessionId}/subagents/agent-{agentId}.jsonl` — so without this a fan-out
  that burned most of the budget looks identical to one that did not.
  Attribution is by filename, since the Agent tool's input carries no agent id.
  On a local runtime `calculateUSDCost` returns 0, so tokens are shown and the
  money column is omitted rather than printing a wall of `$0.00`. Add `--json`
  for the raw rows.
- `ur role-mode ...` to install built-in Architect, Code, Debug, and Ask role modes
- `ur a2a ...` for a negotiated Agent-to-Agent server with automatic compatibility
  binding, scoped delegation tokens, durable protocol state, and separate UR
  compatibility task routes
- `ur sdk ...` to scaffold TS/Python headless SDK examples
- `ur doctor` to inspect CLI health
- `ur update` or `ur upgrade` to check for updates

Interactive sessions also check the published package version and show
`Update available: <current> -> <latest>` when a newer release is available.
Source checkouts print
`Development build detected. To update, pull latest source or install from npm.`
instead of attempting to mutate the checkout.

See [Frontier Agent Workflows](FRONTIER_AGENT_FEATURES.md) for the complete
managed-worker, steering, learned-playbook, cited-memory, Agentic CI,
trajectory, desktop-QA, side-chat, multi-repository, and arena trust model.

## Large prompts, parallel work, and compact reasoning

UR turns a multi-part prompt into a bounded task graph instead of guessing
future task IDs. The normal target is 2–8 concrete tasks (hard limit 12): tasks
are created first, real IDs are captured, and dependencies are then connected
in dependency order. `ur exec` materializes this graph deterministically; the
interactive agent follows the same lifecycle and its task/agent tools enforce
the concurrency boundary.

Interactive work uses a strict-hybrid task policy by default. One atomic,
low-risk outcome can be implemented directly. Before the first mutation, UR
requires a visible task for requests with two or more outcomes, enumerated or
sequenced work, plan mode, delegation, dependencies, project-sized work, and
release, publishing, deployment, migration, security, credential, permission,
sandbox, or production risk. Read-only inspection never needs a task, so the
agent can understand the repository before it creates the board. A custom tool
profile without `TaskCreate` remains usable and does not deadlock.

The default can be tuned in `.ur/settings.json` or user settings:

```json
{
  "tasks": {
    "requireBeforeChanges": {
      "enabled": true,
      "freeReads": 3
    }
  }
}
```

Set `enabled` to `false` for advisory task tracking. Set `freeReads` to `0` for
the fully strict policy that requires a task before every mutation, including
an atomic change. The positive atomic classification otherwise stays direct
regardless of how many read-only tools were needed.

A user prompt does not create a placeholder task. The task panel stays quiet
for informational conversation, direct one-step changes, acknowledgements, and
small corrections. For genuinely multi-step work, multiple independently
verifiable outcomes, dependencies, delegation, or an explicit request for a
task list, the model creates concrete tasks after it understands the work. Task
subjects describe outcomes and never copy the raw prompt. Replies such as
corrections (including `no` / `still` feedback), approvals, and interruptions
reuse and update the relevant explicit unfinished board rather than starting
empty or adding the reply as another task. A terminal board is archived only
when the next prompt is genuinely new work. Legacy automatic placeholders from
older builds are hidden and removed at the next prompt boundary.

Plan mode has one narrow exception to the mutation gate: UR may write or edit
the exact plan file for the active session while the rest of the workspace
remains read-only. In any permission mode, the main session may delegate early
research to UR's shipped `Explore` and `Plan` agents before tasks exist. Those
two definitions are mechanically forced into plan permission mode even when
the parent is in Accept Edits or Approve All. Models are instructed to select
`subagent_type="Explore"` for this work. If a provider still labels an explicit
read-only brief—or an unambiguous research-and-report-only brief—
`general-purpose`, UR reduces that main-session call to the shipped Explore
definition before gating. A brief that also directs implementation, testing,
command execution, or workspace changes remains task-gated. Ordinary
general-purpose work, custom overrides, nested agents, named/team workers,
worktrees, and cwd overrides still require an actionable parent task. When the user approves the plan,
`ExitPlanMode` preserves any existing actionable board or creates a bounded set
of professional, deduplicated implementation tasks plus a verification task
that depends on them. Implementation therefore starts with visible tracking
without requiring the model or user to recover from a circular
`TaskListRequired` error.

Independent read-only tasks can run in parallel. A task that may write to the
shared checkout is serialized with other possible writers, even when it comes
from another top-level prompt or crew worker. Parallel writers require explicit
worktree isolation. Agent worktrees use the exact current commit and require a
clean source checkout, so uncommitted work is never silently omitted or based
on an unrelated remote revision.

While the agent works, the `◭ Mashoofing…` row stays visible and its
parenthesized phase changes with activity: `thinking`, `requesting`,
`responding`, `preparing tool`, or `working`. Elapsed thinking time and token
activity continue to appear when available. The active task follows the
ellipsis—for example, `◭ Mashoofing… · Fixing timeout handling (thinking)`—and
is truncated or omitted on narrow terminals instead of wrapping the UI.

The normal screen does not mount live assistant drafts. During tool work it
shows the persistent `Mashoofing` row and compact tool summaries, then presents
the stable final answer. Completed "I'll inspect..." text paired with a tool
call is also omitted from the normal projection. Press `ctrl+o` to inspect the
complete stored trace; verbose diagnostics can expose live text when needed.
If self-talk is embedded inside a completed answer, UR replaces only that
region with a slim `Reasoning condensed` rail. All of this is presentation-only:
session history, exports, and the model's next-turn context retain the original
text, and no extra model/API call or reduced reasoning budget is involved.

When a provider reports that the context limit was reached despite the normal
proactive threshold, UR withholds that transient error, runs one emergency
compaction, and retries the interrupted turn automatically. Oversized images or
documents are replaced with markers only in the emergency summary request so a
large Computer screenshot cannot block recovery; the original transcript is
not rewritten. If that single bounded recovery fails—or automatic compaction
was explicitly disabled—UR shows the manual `/compact` or `/clear` action.

## Status bar

Interactive sessions include a compact bottom status bar when stdout is a real
terminal:

```text
Ollama | llama3 | ask | main
```

When a newer npm release exists, the bar appends an
`update <version> available` segment. The bar is not rendered in
non-interactive mode, CI, dumb terminals, or assistant viewer mode. Custom
status-line hooks override the built-in bar.

## IDE Integration

UR can write editor-readable inline diff bundles for review:

```sh
ur ide diff capture --title "Parser fix"
ur ide diff list
ur ide diff show <id>
```

The bundled VS Code extension is packaged locally from
`extensions/vscode-ur-inline-diffs/` when UR installs it. It does not rely on
the stale marketplace extension ID, and it only reads or writes
`.ur/ide/diffs` files in the current workspace.

Run each command with `--help` for exact flags.

Agent platform examples:

```sh
ur spec init demo --goal "1. add a utils.add function 2. add a test"
ur spec run demo --all --dry-run
ur spec run demo --all --kernel
ur spec verify demo --kernel
ur arena "implement a debounce helper" --agents 3 --judge hybrid --verify "bun test"
ur agent-ci init default
ur cloud run "fix the parser race" --runner managed --attempts 3
ur escalate run "refactor the cache layer" --force-oracle --dry-run
ur test-first detect
ur test-first --dry-run
ur skill init security-review
ur skill run security-review "src/auth.ts"
ur skill verify security-review --require-trusted
ur code-index repo build
ur code-index repo search "rate limiter"
ur test-first install
ur safety status
ur safety check --command "rm -rf build"
ur context-pack scan
ur context-pack remember --constraint "Run command evidence before claiming success"
ur context-pack remember --accepted "Use p-map for concurrency" --scope project
ur context-pack remember --decision "Keep streaming" --cite-file src/parser.ts --lines 20:48
ur context-pack memory verify
ur context-pack memory revalidate
ur context-pack compress
UR_MCP_HTTP_TOKEN='<secret>' ur mcp serve-web --port 8976
ur acp serve --port 8123
ur exec "add tests for the parser" --concurrency 4 --json
ur ci-loop --command "bun test" --cwd . --dry-run
ur artifacts capture-diff
ur bg run "fix the flaky parser test" --worktree --dry-run
ur learn playbooks mine --min-runs 3
ur workspace init checkout
ur desktop-qa validate .ur/desktop-qa/fixtures/smoke.json
ur worktree list
ur worktree clean --dry-run
ur repo-edit index
ur repo-edit plan rename oldName --to newName
ur repo-edit preview rename oldName --to newName
ur repo-edit apply rename oldName --to newName --check "bun test"
ur repo-edit impact checkoutTotal --depth 5
ur research init current-tools --question "What changed in current coding agents?"
ur research source current-tools --url https://example.com/changelog --title "Official changelog"
ur research finding current-tools --text "Tool discovery shipped." --cite S1
ur research verify current-tools
ur research report current-tools --out docs/research/current-tools.md
ur design3d doctor
ur design3d init web-model --engine blender --units m --format glb
ur design3d init printable-part --engine openscad --units mm --format stl
ur design3d init max-scene --engine 3dsmax --units cm --format max
ur design3d build design3d/web-model --dry-run
ur design3d validate design3d/web-model
ur ide diff capture --title "Working tree review"
ur eval bench list
ur eval run starter --dry-run --json
ur eval run starter --metrics --json
ur eval gate starter --min-pass-rate 1 --min-trajectory-score 0.9
ur eval report starter --dashboard
ur eval dashboard
ur crew create parser-crew --goal "fix the flaky parser test" --decompose --dry-run
ur crew run parser-crew --workers 3 --decompose --dry-run
ur crew run parser-crew --workers 3 --worktrees --max-attempts 2
ur pattern parallel "refactor login without changing behavior" --execute --dry-run
```

## Permissions

By default, UR asks before sensitive tool actions. For automation, use explicit allow and deny lists:

```sh
ur -p \
  --allowed-tools "Read,Edit,Bash(git:*)" \
  --disallowed-tools "Bash(rm:*)" \
  "inspect the current diff"
```

Avoid `--dangerously-skip-permissions` unless the session is inside a disposable sandbox.

Use `ur safety check --command "<cmd>"` before adding risky shell commands to
scripts, docs, automations, or verifier gates. The safety policy separates
read/write/execute/network permissions, asks before destructive operations,
recommends sandboxing for risky commands, and denies common secret exfiltration
patterns.
