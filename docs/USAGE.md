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

## Models

The wrapper in `bin/ur.js` honors explicit model choices in this order:

1. `OLLAMA_MODEL`
2. `UR_MODEL`

If neither variable is set, UR lets its Ollama router choose from the models
exposed by your local Ollama app. That list can include local models and
Ollama Cloud-backed models. If routing cannot discover a model list, the
built-in fallback is `qwen3-coder:480b-cloud`.

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

Models exposed by the chosen Ollama app are valid, including local models and Ollama Cloud-backed models. UR does not call provider APIs directly or manage model API keys.

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

## Commands

UR includes slash commands and CLI subcommands for common workflows:

- `/help` or `ur --help` for command discovery
- `ur mcp ...` to configure MCP servers
- `ur plugin ...` to manage plugins and marketplaces
- `ur agents` to list configured agents
- `ur agent-trends` to inspect coverage for current agent technology trends
- `ur a2a card` to print UR's Agent Card metadata for A2A discovery
- `ur bg ...` to run detached local background agents with optional worktrees and PRs
- `ur repo-edit ...` to index the repo, plan AST-aware renames, preview patches, and apply with rollback
- `ur safety ...` to inspect project shell safety policy and preview command risk
- `ur context-pack ...` to summarize architecture and persist task decisions, constraints, commands, and diffs
- `ur code-index watch` to keep the local semantic code index fresh
- `ur memory retention ...` to prune project-local memory by TTL, max entries, and decay
- `ur spec ...` to scaffold requirements, design, and tasks, then run a spec task list
- `ur escalate ...` to plan, run, or ask an oracle model for hard tasks
- `ur arena ...` to run multiple agents on the same task and select a winner
- `ur test-first ...` to detect compile/test/lint commands, store failure traces, and install after-edit gates
- `ur ci-loop ...` to run tests, repair failures, and rerun with a bounded loop
- `ur artifacts ...` to capture reviewable diffs, test runs, notes, and feedback
- `ur ide diff ...` to capture editor-readable inline diff bundles
- `ur acp ...` to start/stop/status the Agent Communication Protocol server for IDE extensions
- `ur exec ...` to run prompts in non-interactive mode with optional concurrency
- `ur eval bench ...` to import local SWE-bench, Terminal-Bench, or Aider Polyglot exports
- `ur doctor` to inspect CLI health
- `ur update` or `ur upgrade` to check for updates

Interactive sessions also check the published package version and show
`Update available: <current> -> <latest>` when a newer release is available.

Run each command with `--help` for exact flags.

Agent platform examples:

```sh
ur spec init demo --goal "1. add a utils.add function 2. add a test"
ur spec run demo --all --dry-run
ur arena "implement a debounce helper" --agents 2 --dry-run
ur escalate run "refactor the cache layer" --force-oracle --dry-run
ur test-first detect
ur test-first --dry-run
ur test-first install
ur safety status
ur safety check --command "rm -rf build"
ur context-pack scan
ur context-pack remember --constraint "Run command evidence before claiming success"
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
