# UR-AGENT 1.15.0 Upgrade Notes

UR 1.15.0 keeps the agent local-first and Ollama-centered. The new agent
platform surfaces do not add Anthropic, OpenAI, or other direct provider API
dependencies. Network-facing behavior remains opt-in.

## New Local Agent Surfaces

### Background agents

```sh
ur bg run "fix the flaky parser test" --worktree
ur bg fanout "try three parser fixes" --agents 3 --worktree
ur bg list
ur bg status <id>
ur bg logs <id> --tail 100
ur bg attach <id>
ur bg kill <id>
```

State is stored under `.ur/background/`. Worktrees are stored under
`.ur/worktrees/`. Pull requests are created only when `--pr` is passed and then
use the existing local `gh` CLI path.

### Context and memory retention

```sh
ur config set compaction.autoThreshold 80
ur memory retention show
ur memory retention set --ttl-days 90 --max-entries 5000 --decay-days 30
ur memory retention prune
```

`compaction.autoThreshold` is a global percentage threshold from 50 to 95. The
retention command prunes project-local `.ur/memory/*.jsonl` files.

### Code-index watcher

```sh
ur config set codeIndex.autoReindex true
ur code-index watch --graph
ur code-index watch --dry-run --json
```

The watcher uses local filesystem events and the same local Ollama embedding
path as `ur code-index build`.

### Artifact steering

```sh
ur artifacts add --kind plan --title "Plan" --task <bg_id>
ur artifacts comment <artifact_id> --feedback "Prefer the simpler parser path"
```

Comments are written to the artifact and to the linked background task inbox so
long-running work has durable steering feedback. Background workers now run in
stream-json mode and inject new inbox comments into the child agent as
`priority: "now"` user turns while the process is active.

### A2A task server

```sh
ur a2a card
ur a2a serve --host 127.0.0.1 --port 8765 --token "$UR_A2A_TOKEN"
ur a2a token mint --secret "$UR_A2A_DELEGATION_SECRET" --scope coding-agent
```

The server is opt-in. It refuses off-loopback binds unless a static bearer token
or delegation secret is configured. Task execution is backed by UR background
tasks and local `ur -p`; no external model provider API is introduced.

Useful routes:

- `GET /healthz`
- `GET /.well-known/agent-card.json`
- `POST /a2a/tasks`
- `GET /a2a/tasks`
- `GET /a2a/tasks/:id`
- `GET /a2a/tasks/:id/output`
- `POST /a2a/tasks/:id/cancel`
- `DELETE /a2a/tasks/:id`

### IDE inline diff bundles

```sh
ur ide diff capture --title "Parser fix"
ur ide diff list
ur ide diff show diff-1
ur ide diff comment diff-1 --feedback "Inline note" --file src/parser.ts --line 42
ur ide diff schema
```

Bundles are stored under `.ur/ide/diffs/` as a manifest, per-diff metadata, and
unified patch files. The repo also ships a native VS Code extension at
`extensions/vscode-ur-inline-diffs/` that lists bundles, opens patch previews,
and writes comments back into the UR metadata.

### Benchmark adapters

```sh
ur eval bench list
ur eval bench swe-bench --file swe.jsonl --name local-swe
ur eval bench terminal-bench --file terminal.jsonl --name local-terminal
ur eval bench aider-polyglot --file aider.jsonl --name local-polyglot
ur eval run local-swe --dry-run
```

Adapters import local JSON or JSONL exports into UR eval suites. They do not
download datasets or call external services.

## Release Verification

Run these before publishing:

```sh
bun test test/agentFeatureCommands.test.ts test/agentDelegation.test.ts test/codeIndex.test.ts
bun run typecheck
npm pack --dry-run
```

Optional local smoke checks:

```sh
bun src/entrypoints/cli.tsx bg list
bun src/entrypoints/cli.tsx memory retention show
bun src/entrypoints/cli.tsx code-index watch --dry-run
bun src/entrypoints/cli.tsx eval bench list
bun src/entrypoints/cli.tsx ide diff schema
```
