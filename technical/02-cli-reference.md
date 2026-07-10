# 02 — CLI Reference (`ur` binary)

Source of truth: `src/entrypoints/cli.tsx` (fast paths), `src/main.tsx` (commander program),
`src/cli/bg.ts` (background sessions).

Start interactive: `ur` — starts the Ink REPL in the current directory.
One-shot headless: `ur -p "prompt"` — prints the response and exits.

## Global flags

| Flag | Purpose | Example |
|---|---|---|
| `-v, --version` | Print version (`X.Y.Z (UR-Nexus)`) | `ur --version` |
| `-d, --debug [filter]` | Debug logging with category filter | `ur -d api,hooks` |
| `--debug-file <path>` | Write debug logs to a file (implies debug) | `ur --debug-file /tmp/ur.log` |
| `--verbose` | Override verbose setting | `ur --verbose` |
| `-p, --print` | Headless print mode (skips trust dialog — only use in trusted dirs) | `ur -p "explain this repo"` |
| `--output-format <fmt>` | `text`, `json`, `stream-json` (with `-p`) | `ur -p "hi" --output-format json` |
| `--include-partial-messages` | Stream partial chunks (needs `-p` + `stream-json`) | — |
| `--include-hook-events` | Emit hook lifecycle events in stream output | — |
| `--replay-user-messages` | Echo stdin user messages back on stdout (stream-json in/out) | — |
| `--bare` | Minimal mode: no hooks/LSP/plugins/auto-memory/UR.md; local Ollama only; sets `UR_CODE_SIMPLE=1` | `ur --bare` |
| `--offline` | Local-first: no cloud APIs, telemetry, auto-update, remote control | `ur --offline` |
| `--model <model>` | Session model (e.g. an Ollama tag) | `ur --model qwen2.5-coder:7b` |
| `--fallback-model <model>` | Auto-fallback when primary is overloaded (with `-p`) | — |
| `--agent <agent>` | Run as a named agent config | `ur --agent reviewer` |
| `--agents <json>` | Define custom agents inline (JSON) | — |
| `--betas <betas...>` | Beta API headers (API-key users) | — |
| `--ollama-host <url>` | Use a specific Ollama server for this session | `ur --ollama-host http://192.168.1.10:11434` |
| `--discover-ollama` | Discover Ollama servers on the LAN at startup and pick one | `ur --discover-ollama` |
| `--allowedTools <tools...>` / `--disallowedTools <tools...>` | Permission allow/deny rules | `ur --allowedTools "Bash(git:*)" Edit` |
| `--tools <tools...>` | Restrict the built-in tool set (`""` = none, `default` = all) | `ur --tools Bash,Edit,Read` |
| `--dangerously-skip-permissions` | Bypass all permission checks (sandboxed envs only) | — |
| `--allow-dangerously-skip-permissions` | Make bypass *available* but not default | — |
| `--permission-mode <mode>` | Start in a permission mode (e.g. `plan`) | `ur --permission-mode plan` |
| `--mcp-config <configs...>` | Load MCP servers from JSON files/strings | `ur --mcp-config ./mcp.json` |
| `--strict-mcp-config` | Ignore all other MCP configs besides `--mcp-config` | — |
| `-c, --continue` | Continue most recent conversation in cwd | `ur -c` |
| `-r, --resume [id]` | Resume by session ID or open picker | `ur -r 6f9…` |
| `--fork-session` | New session ID when resuming | `ur -c --fork-session` |
| `--from-pr [value]` | Resume the session linked to a GitHub PR | `ur --from-pr 123` |
| `--session-id <uuid>` | Force a specific session UUID | — |
| `-n, --name <name>` | Display name for the session | `ur -n "auth refactor"` |
| `--no-session-persistence` | Don't save the session (with `-p`) | — |
| `--settings <file-or-json>` | Load extra settings | `ur --settings ./ci-settings.json` |
| `--setting-sources <sources>` | Which scopes to load: `user,project,local` | `ur --setting-sources user` |
| `--add-dir <dirs...>` | Extra directories tools may access | `ur --add-dir ../lib` |
| `--ide` | Auto-connect to the IDE if exactly one is available | `ur --ide` |
| `--chrome` / `--no-chrome` | Enable/disable UR-in-Chrome integration | — |
| `-w, --worktree [name]` | Run the session in a fresh git worktree | `ur -w feature-x` |
| `--tmux` | With `--worktree`: open it in tmux/iTerm2 panes (`--tmux=classic` forces tmux) | `ur -w x --tmux` |
| `--plugin-dir <path>` | Load plugins from a dir for this session (repeatable) | `ur --plugin-dir ./my-plugins` |
| `--disable-slash-commands` | Disable all skills/commands | — |
| `--file <specs...>` | Download file resources at startup (`file_id:relative_path`) | — |
| `--bg, --background` | Detach: run as a background session | `ur --bg -p "run the test suite"` |
| `--update` / `--upgrade` | Redirect to `ur update` | — |

## Subcommands

### Sessions & lifecycle
| Command | Purpose | Example |
|---|---|---|
| `ur ps` | List background sessions (registry in `~/.ur/sessions/`) | `ur ps` |
| `ur logs <id>` | Show a background session's output | `ur logs 3f2a` |
| `ur attach <id>` | Attach to a background session | `ur attach 3f2a` |
| `ur kill <id>` | Kill a background session | `ur kill 3f2a` |
| `ur update` / `ur up` | Self-update (`autoUpdatesChannel` setting selects channel) | `ur update` |
| `ur rollback [target]` | Roll back an update | `ur rollback` |
| `ur doctor` | Installation health check | `ur doctor` |
| `ur log` / `ur error` | Show logs / recent errors | — |
| `ur export` | Export conversation data | — |

### Model / provider
| Command | Purpose | Example |
|---|---|---|
| `ur provider list` | List providers and their status | `ur provider list` |
| `ur provider status` | Connection status for all providers | — |
| `ur provider doctor [provider]` | Diagnose a provider connection | `ur provider doctor ollama` |
| `ur provider models [provider]` | List models a provider offers | `ur provider models openrouter` |
| `ur provider select-model <provider> <model...>` | Pin a model for a provider | — |
| `ur connect [action] [provider]` | Connect/store credentials (also `/connect` in REPL) | `ur connect openrouter --key sk-…` |
| `ur model-doctor [model]` | Probe a local Ollama model's agent capabilities | `ur model-doctor llama3.3` |
| `ur model-route [task...]` | Recommend best model for a task | `ur model-route "refactor auth"` |
| `ur local-first` | Report offline/no-cloud readiness | `ur local-first --json` |

### MCP
| Command | Purpose | Example |
|---|---|---|
| `ur mcp add <name> <commandOrUrl> [args...]` | Add an MCP server (`--transport stdio\|http\|sse`, `--header`, `-s user\|project\|local`) | `ur mcp add fs -- npx @modelcontextprotocol/server-filesystem /tmp` |
| `ur mcp add-json <name> <json>` | Add from raw JSON | `ur mcp add-json db '{"command":"…"}'` |
| `ur mcp add-from-ur-desktop` | Import servers from UR Desktop | — |
| `ur mcp list / get <name> / remove <name>` | Inspect and remove servers | `ur mcp get fs` |
| `ur mcp serve` | Run UR itself as an MCP server (exposes UR tools) | `ur mcp serve` |
| `ur mcp reset-project-choices` | Reset approved/rejected `.mcp.json` prompts | — |

### Agent & automation (headless)
| Command | Purpose | Example |
|---|---|---|
| `ur exec [prompts...]` | Non-interactive runs with concurrency (also `/exec`) | `ur exec "fix lint" "run tests" --concurrency 2` |
| `ur bg [action] [task...]` | Detached background agents (run/fanout/list/status/logs/attach/kill) | `ur bg run "migrate configs" --worktree --pr` |
| `ur task create <subject>` / `list` / `get <id>` / `update <id>` | Work-item registry | `ur task create "Add rate limiter"` |
| `ur worktree [action] [id]` | List/inspect/clean agent worktrees | `ur worktree clean` |
| `ur automation [action] [name]` | Cron-style project automations (`--schedule`, `--prompt`, `run-due`, `install` launchd/systemd/cron) | `ur automation create nightly --schedule "0 3 * * *" --prompt "run tests"` |
| `ur eval [action]` | Eval harness (init/run/report/compare/leaderboard/bench) | `ur eval run smoke --json` |
| `ur arena [task...]` | N agents compete on one task, judge picks winner | `ur arena "speed up parser" --agents 3` |
| `ur crew [action] [name]` | Lead + workers over a shared task board | `ur crew create fixers --goal "eliminate flaky tests"` |
| `ur ci-loop` | Run build/test, auto-fix until green | `ur ci-loop --command "npm test" --max-attempts 3` |
| `ur escalate [action] [task...]` | Fast model with auto-escalation to an oracle model | `ur escalate run "hard proof" --oracle gpt-5.5` |
| `ur route [task...]` | Classify task → recommend subagent/pattern | `ur route "debug flaky test"` |
| `ur spec / goal / workflow / pattern / skill …` | Spec-driven dev, goals, workflows, patterns, skills (see docs 08–10) | `ur spec init checkout --goal "one-click checkout"` |

### Servers & integration endpoints
| Command | Purpose | Example |
|---|---|---|
| `ur a2a serve` | Agent-to-Agent HTTP server | `ur a2a serve --port 8765 --token secret` |
| `ur a2a card` | Print the A2A agent card | `ur a2a card --a2a-base-url https://host` |
| `ur a2a token mint / verify <token>` | Mint/verify A2A tokens | — |
| `ur acp serve / stdio / stop / status` | ACP server for IDE extensions | `ur acp serve --port 9100` |
| `ur server` | Direct-connect HTTP session server (`--port`, `--host`, `--auth-token`, `--unix`, `--workspace`, `--idle-timeout`, `--max-sessions`, `--permission-mode`) | `ur server --port 8080 --auth-token t0k3n` |
| `ur ssh <host> [dir]` | Run UR against a remote host over SSH | `ur ssh devbox ~/repo` |
| `ur open <cc-url>` | Open a deep link | — |
| `ur remote-control` (`rc`, `remote`, `sync`, `bridge`) | Serve this machine for remote-control clients (mobile/web) | `ur rc` |
| `ur daemon [subcommand]` | Supervisor daemon (feature-gated) | — |
| `ur environment-runner` / `ur self-hosted-runner` | Headless runner processes (feature-gated) | — |

### Auth
| Command | Purpose | Example |
|---|---|---|
| `ur auth status` | Show auth state | `ur auth status --json` |
| `ur auth chatgpt / claude / gemini / antigravity` | Subscription CLI logins (providers currently `disabled: true` in the registry) | `ur auth chatgpt --device-auth --dry-run` |
| `ur login` / `ur logout` | UR account OAuth (hidden when using 3P services) | — |

### Plugins
| Command | Purpose | Example |
|---|---|---|
| `ur plugin validate <path>` | Validate a plugin/marketplace manifest | `ur plugin validate ./my-plugin` |
| `ur plugin list` (`--available`, `--json`) | List installed plugins | — |
| `ur plugin doctor [--path <dir>]` | Diagnose plugin problems | — |
| `ur plugin marketplace add <source>` (`--sparse`, `--scope`) | Register a marketplace (git URL/path) | `ur plugin marketplace add github.com/acme/ur-plugins` |
| `ur plugin marketplace list / remove <name> / update [name]` | Manage marketplaces | — |
| `ur plugin install <plugin>` / `uninstall` / `enable` / `disable [-a]` / `update` (`-s user\|project\|local`) | Manage plugins | `ur plugin install fmt@acme -s project` |

## Notes

- Any slash command that is `type: 'local'` also works from the shell as `ur <command>` when
  registered in `src/main.tsx` (the list above) — e.g. `ur agent-trends --json`.
- `ur new / list / reply` are template-job commands (feature-gated `TEMPLATES`).
- Exit codes: fatal startup errors print `Fatal startup error: …` and exit 1.
