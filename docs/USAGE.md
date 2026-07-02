# Usage Guide

UR is a terminal agent. Running `ur` opens an interactive session in the current directory, while `ur -p` runs one non-interactive prompt and exits.

## Interactive Mode

```sh
ur
```

Use interactive mode for iterative coding, debugging, research, and repository exploration. The session can read project instructions, use tools, call slash commands, and keep resumable conversation history.

Useful options:

```sh
ur --model qwen3-coder:480b-cloud
ur --add-dir ../other-project
ur --permission-mode ask
ur --continue
ur --resume
```

When UR needs a focused clarification, it uses the `AskUserQuestion` dialog.
Professional clarification prompts can provide up to eight concrete options;
UR also accepts custom "Other" answers when the dialog includes one.

## Print Mode

Print mode is useful for scripts and shell pipelines:

```sh
ur -p "write a changelog entry for the current diff"
```

Output formats:

```sh
ur -p --output-format text "explain src/main.tsx"
ur -p --output-format json "return a JSON summary of this repo"
ur -p --output-format stream-json "stream progress while answering"
```

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

If neither variable is set and `ollama` is the selected provider, UR lets its
Ollama router choose from the models exposed by your local Ollama app.

You can also choose the model for a single session:

```sh
ur --model qwen3-coder:480b-cloud
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

UR-AGENT also has explicit provider commands for legal access paths:

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
ur config set model <model>
ur config set base_url <url>
ur config set provider.fallback ollama
```

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

Provider values accept canonical IDs and common aliases. For example,
`openai-api`, `anthropic-api`, `gemini-api`, `openrouter`, `ollama`,
`lmstudio`, `llama.cpp`, and `vllm` are UR-native runtime providers, and
`codex-cli` (`chatgpt`), `claude-code-cli` (`claude`), `gemini-cli` (`gemini`),
and `antigravity-cli` (`agy`) are subscription CLI providers.

API modes are explicit. Keys are read from a key stored via
`ur connect <provider>` (OS keychain) or from the environment variables
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and
`OPENROUTER_API_KEY`. Subscription CLIs are optional, never required
dependencies, and never used as a silent fallback. UR-AGENT never scrapes
browser sessions, extracts OAuth tokens, or bypasses provider restrictions.
OpenAI-compatible local or cloud endpoints use `base_url` plus `model`.

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
ur context-pack compress
```

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

Example `UR.md` frontmatter hook:

```yaml
---
hooks:
  - event: BeforeCommit
    command: 'echo "Commit detected: $UR_CODE_HOOK_INPUT" >> /tmp/ur-commits.log'
---
```

Hooks are advisory by default. A `BeforeEdit`/`BeforeCommand`/`BeforeCommit` hook can block the action by returning `{"decision":"block","reason":"..."}` or exit code 2. `AfterEdit` and `OnFailure` hooks can return `{"hookSpecificOutput":{"hookEventName":"...","memory":{"kind":"accepted","text":"..."}}}` to append project memory automatically.

## Commands

UR includes slash commands and CLI subcommands for common workflows:

- `/help` or `ur --help` for command discovery
- `ur connect ...` to connect provider accounts (subscription login or stored API key)
- `ur mcp ...` to configure MCP servers
- `ur plugin ...` to manage plugins and marketplaces. Marketplace plugins can
  add MCP tools, commands, executable skills, templates, validators, language
  adapters, LSP servers, agents, hooks, and output styles.
- `ur agents` to list configured agents
- `ur agent-trends` to inspect coverage for current agent technology trends
- `ur a2a card` to print UR's Agent Card metadata for A2A discovery
- `ur bg ...` to run detached local background agents with optional worktrees and PRs
- `ur repo-edit ...` to index the repo, plan AST-aware renames, preview patches, and apply with rollback
- `ur safety ...` to inspect project shell safety policy and preview command risk
- `ur context-pack ...` to summarize architecture and persist project memory (decisions, constraints, commands, diffs, architecture, preferences, attempts, accepted, rejected)
- `ur code-index watch` to keep the local semantic code index fresh
- `ur code-index repo build` to build a richer semantic repo index (files, symbols, calls, tests, docs, configs)
- `ur skill init ...` and `ur skill run ...` for executable skill workflows
- `ur memory retention ...` to prune project-local memory by TTL, max entries, and decay
- `ur spec ...` to scaffold requirements, design, and tasks, run a spec task list, and verify with strict proof gates
- `ur escalate ...` to plan, run, or ask an oracle model for hard tasks
- `ur arena ...` to run multiple agents on the same task and select a winner
- `ur test-first ...` to detect compile/test/lint commands, store failure traces, and install after-edit gates
- `ur ci-loop ...` to run tests, repair failures, and rerun with a bounded loop
- `ur artifacts ...` to capture reviewable diffs, test runs, notes, and feedback
- `ur ide diff ...` to capture editor-readable inline diff bundles
- `ur acp ...` to start/stop/status the Agent Communication Protocol server for IDE extensions
- `ur exec ...` to run prompts in non-interactive mode with optional concurrency
- `ur eval run ...` to run a suite, grade results, and capture execution metrics
- `ur eval report ...` to show a saved report or write a single-suite dashboard
- `ur eval dashboard` to generate the local HTML dashboard across all reports
- `ur eval bench ...` to import local SWE-bench, Terminal-Bench, or Aider Polyglot exports
- `ur crew ...` to run lead+worker agent crews with optional automatic task decomposition
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
- `ur trigger ...` to parse GitHub/Slack webhook payloads and optionally launch a headless run
- `ur agent-templates ...`, `ur agent-task ...`, `ur agent-inspect`, `ur agent-features`, and `ur agent-trends` for agent template, PR handoff, timeline, and coverage utilities
- `ur role-mode ...` to install built-in Architect, Code, Debug, and Ask role modes
- `ur a2a ...` for Agent Card metadata, delegation tokens, and the opt-in A2A task server
- `ur sdk ...` to scaffold TS/Python headless SDK examples
- `ur doctor` to inspect CLI health
- `ur update` or `ur upgrade` to check for updates

Interactive sessions also check the published package version and show
`Update available: <current> -> <latest>` when a newer release is available.
Source checkouts print
`Development build detected. To update, pull latest source or install from npm.`
instead of attempting to mutate the checkout.

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
ur arena "implement a debounce helper" --agents 2 --dry-run
ur escalate run "refactor the cache layer" --force-oracle --dry-run
ur test-first detect
ur test-first --dry-run
ur skill init security-review
ur skill run security-review "src/auth.ts"
ur code-index repo build
ur code-index repo search "rate limiter"
ur test-first install
ur safety status
ur safety check --command "rm -rf build"
ur context-pack scan
ur context-pack remember --constraint "Run command evidence before claiming success"
ur context-pack remember --accepted "Use p-map for concurrency" --scope project
ur context-pack compress
ur acp serve --port 8123
ur exec "add tests for the parser" --concurrency 4 --json
ur ci-loop --command "bun test" --dry-run
ur artifacts capture-diff
ur bg run "fix the flaky parser test" --worktree --dry-run
ur worktree list
ur worktree clean --dry-run
ur repo-edit index
ur repo-edit plan rename oldName --to newName
ur repo-edit preview rename oldName --to newName
ur repo-edit apply rename oldName --to newName --check "bun test"
ur ide diff capture --title "Working tree review"
ur eval bench list
ur eval run starter --dry-run --json
ur eval run starter --metrics --json
ur eval report starter --dashboard
ur eval dashboard
ur crew create parser-crew --goal "fix the flaky parser test" --decompose --dry-run
ur crew run parser-crew --workers 3 --decompose --dry-run
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
