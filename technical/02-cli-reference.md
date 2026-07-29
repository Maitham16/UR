# 02 — CLI Reference (`ur` binary)

Source of truth: `src/entrypoints/cli.tsx` (fast paths), `src/main.tsx` (Commander program),
and the default external feature set in `scripts/bundle.mjs`. Unless a row is explicitly
labelled source-only, it is present in the standard npm build. Root `ur --help` intentionally
hides a few advanced global flags, including the system-prompt file variants, so presence in
this reference does not imply a visible root-help row.

Start interactive: `ur` — starts the Ink REPL in the current directory.
One-shot headless: `ur -p "prompt"` — prints the response and exits.

## Global flags

| Flag | Purpose | Example |
|---|---|---|
| `-h, --help` | Show help for the root command or selected subcommand | `ur provider --help` |
| `-v, --version` | Print version (`X.Y.Z (UR-Nexus)`) | `ur --version` |
| `-d, --debug [filter]` | Debug logging with category filter | `ur -d api,hooks` |
| `--debug-file <path>` | Write debug logs to a file (implies debug) | `ur --debug-file /tmp/ur.log` |
| `--verbose` | Override verbose setting | `ur --verbose` |
| `-p, --print` | Headless print mode (skips trust dialog — only use in trusted dirs) | `ur -p "explain this repo"` |
| `--output-format <fmt>` | `text`, `json`, `stream-json` (with `-p`) | `ur -p "hi" --output-format json` |
| `--input-format <fmt>` | `text` or realtime `stream-json` input (with `-p`; stream input requires stream output) | `ur -p --input-format stream-json --output-format stream-json` |
| `--json-schema <json>` | Validate the final headless response against a JSON Schema | `ur -p --json-schema '{"type":"object"}' "Return JSON"` |
| `--max-budget-usd <amount>` | Stop a print-mode run at a positive provider-cost budget | `ur -p --max-budget-usd 1 "Review this diff"` |
| `--include-partial-messages` | Stream partial chunks (needs `-p` + `stream-json`) | — |
| `--include-hook-events` | Emit hook lifecycle events in stream output | — |
| `--replay-user-messages` | Echo stdin user messages back on stdout (stream-json in/out) | — |
| `--bare` | Minimal mode: no hooks/LSP/plugins/auto-memory/UR.md; local Ollama only; sets `UR_CODE_SIMPLE=1` | `ur --bare` |
| `--offline` | Local-first: no cloud APIs, telemetry, auto-update, remote control | `ur --offline` |
| `--model <model>` | Session model (e.g. an Ollama tag) | `ur --model qwen2.5-coder:7b` |
| `--effort <low\|medium\|high\|max>` | Override reasoning effort for this session | `ur --effort high` |
| `--fallback-model <model>` | Auto-fallback when primary is overloaded (with `-p`) | — |
| `--agent <agent>` | Run as a named agent config | `ur --agent reviewer` |
| `--agents <json>` | Define custom agents inline (JSON) | — |
| `--betas <betas...>` | Beta API headers (API-key users) | — |
| `--ollama-host <url>` | Use a specific Ollama server for this session | `ur --ollama-host http://192.168.1.10:11434` |
| `--discover-ollama` | Discover Ollama servers on the LAN at startup and pick one | `ur --discover-ollama` |
| `--allowedTools, --allowed-tools <tools...>` / `--disallowedTools, --disallowed-tools <tools...>` | Permission allow/deny rules | `ur --allowed-tools "Bash(git:*)" Edit` |
| `--tools <tools...>` | Restrict the built-in tool set (`""` = none, `default` = all) | `ur --tools Bash,Edit,Read` |
| `--dangerously-skip-permissions` | Bypass all permission checks (sandboxed envs only) | — |
| `--allow-dangerously-skip-permissions` | Make bypass *available* but not default | — |
| `--permission-mode <mode>` | Start in a permission mode (e.g. `plan`) | `ur --permission-mode plan` |
| `--mcp-config <configs...>` | Load MCP servers from JSON files/strings | `ur --mcp-config ./mcp.json` |
| `--strict-mcp-config` | Ignore all other MCP configs besides `--mcp-config` | — |
| `--mcp-debug` | Deprecated MCP diagnostics alias; use `--debug` | — |
| `--system-prompt <text>` / `--system-prompt-file <file>` | Replace the default system prompt with inline or file content (mutually exclusive) | `ur --system-prompt-file ./agent-prompt.txt` |
| `--append-system-prompt <text>` / `--append-system-prompt-file <file>` | Append inline or file content to the default system prompt (mutually exclusive) | `ur --append-system-prompt "Use the project glossary"` |
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

## Subcommands

### Sessions & lifecycle
| Command | Purpose | Example |
|---|---|---|
| `ur update` / `ur upgrade` | Check npm for a newer UR-Nexus release (`autoUpdatesChannel` selects the channel) | `ur update` |
| `ur doctor` | Installation health check | `ur doctor` |
| `ur import-session <path>` | Validate and import a previously exported transcript | `ur import-session ./session.jsonl` |
| `ur thread [action] [id]` | Share and inspect session threads through the local review server; invalid IDs and missing transcripts exit nonzero | `ur thread share` |

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
| `ur mcp serve-http` | Run the opt-in stateless MCP 2026 HTTP adapter with Tasks/Apps | `UR_MCP_HTTP_TOKEN=… ur mcp serve-http` |
| `ur mcp reset-project-choices` | Reset approved/rejected `.mcp.json` prompts | — |

### Agent & automation (headless)
| Command | Purpose | Example |
|---|---|---|
| `ur exec [prompts...]` | Non-interactive runs with deterministic task planning, a live task board, bounded parallel agents, strict evidence checks, and optional per-prompt worktrees (also `/exec`); each prompt owns one shared worktree, not one worktree per planned subtask | `ur exec "fix lint" "run tests" --concurrency 2` |
| `ur bg [action] [task...]` | Detached background agents (run/fanout/list/status/logs/steer/attach/kill) | `ur bg steer <id> --message "run the regression"` |
| `ur cloud [action]` | Verified local best-of-N or managed candidates with safe-branch eligibility, sync, logs, steering, and cancellation | `ur cloud run "fix parser" --runner managed --attempts 3` |
| `ur agent-ci [action] [name]` | Policy-gated isolated CI agent and pinned GitHub workflow | `ur agent-ci init default` |
| `ur workspace [action]` | Dependency-aware multi-repository worktrees and explicit PR/rollback plans | `ur workspace validate checkout` |
| `ur task start <name>` / `run <id>` / `pr <id>` / `list` / `status <id>` | Worktree-capable background task sessions and explicit PR handoff | `ur task start rate-limiter --worktree` |
| `ur worktree [action] [id]` | List/inspect/clean agent worktrees | `ur worktree clean` |
| `ur automation [action] [name]` | Cron-style project automations (`--schedule`, `--prompt`, `run-due`, `install` launchd/systemd/cron) | `ur automation create nightly --schedule "0 3 * * *" --prompt "run tests"` |
| `ur eval [action]` | Isolated evals with redacted trajectory grading and CI gates | `ur eval gate smoke --min-pass-rate 1` |
| `ur arena [task...]` | Verified best-of-N with deterministic/model/hybrid judging | `ur arena "speed up parser" --agents 3 --judge hybrid --verify "bun test"` |
| `ur desktop-qa [action]` | Bounded Electron fixtures with masked screenshots and privacy-compatible optional video/trace evidence | `ur desktop-qa run .ur/desktop-qa/fixtures/smoke.json` |
| `ur learn playbooks [action]` | Mine, approve, run, reject, or disable evidence-backed workflows | `ur learn playbooks mine --min-runs 3` |
| `ur crew [action] [name]` | Lead + workers over a shared task board | `ur crew create fixers --goal "eliminate flaky tests"` |
| `ur agents` | List configured built-in, user, project, and flag-provided agents | `ur agents` |
| `ur ci-loop` | Run build/test in an explicit working directory, auto-fix until green | `ur ci-loop --command "npm test" --cwd ./packages/app --max-attempts 3` |
| `ur escalate [action] [task...]` | Fast model with auto-escalation to an oracle model | `ur escalate run "hard proof" --oracle gpt-5.5` |
| `ur route [task...]` | Classify task → recommend subagent/pattern | `ur route "debug flaky test"` |
| `ur spec [action] [name] [phase]` | Scaffold and advance requirements/design/task specifications with approval and proof gates | `ur spec init checkout --goal "one-click checkout"` |
| `ur goal [action] [name]` | Persist long-horizon objectives and resume their associated workflow | `ur goal add v2-launch --objective "ship v2"` |
| `ur workflow [action] [name] [stepId]` | Initialize, validate, graph, plan, run, approve, advance, complete, or reset declarative workflows | `ur workflow approve release publish` |
| `ur pattern [action] [name] [task...]` | List, inspect, install, compile, or execute PEER/DOE collaboration patterns | `ur pattern run debate "adopt tRPC?" --execute` |
| `ur skill [action] [name] [args...]` | List, inspect, run, approve/reset, initialize, verify, sign, or keygen tool-bounded skills | `ur skill run release-checklist` |
| `ur skill approve / reset / verify / sign / keygen` | Resume/reset approval-gated runs, validate provenance, Ed25519-sign a skill, or create a trusted signing key | `ur skill verify release-notes --require-trusted` |
| `ur context-pack memory verify / revalidate / search / quarantine / rollback` | Audit, resolve citations, or recover the tamper-evident project memory chain | `ur context-pack memory revalidate --json` |

### Knowledge, verification & developer workflows
| Command | Purpose | Example |
|---|---|---|
| `ur agent-features [action]` | Report or scaffold the shipped agent feature surfaces | `ur agent-features --json` |
| `ur agent-inspect` | Reconstruct subagent prompts, tools, verdicts, failures, and usage from a transcript | `ur agent-inspect --file session.jsonl --json` |
| `ur agent-task [action]` | Summarize task/diff state and prepare an explicitly requested PR handoff | `ur agent-task status --json` |
| `ur agent-templates [action] [names...]` | List or install reusable project agent templates | `ur agent-templates install reviewer test-runner` |
| `ur artifacts [action] [id]` | Capture, review, approve, reject, and comment on durable artifacts | `ur artifacts capture-diff` |
| `ur audit [action] [file]` | Export or strictly verify the hash-chained action audit trail; empty, malformed, or tampered JSONL fails closed with a nonzero exit | `ur audit verify .ur/audit.jsonl` |
| `ur browser-qa [action] [fixture]` | Validate or run bounded browser replay fixtures | `ur browser-qa run home-page-smoke --dry-run` |
| `ur claim-ledger [action]` | Maintain claim-to-source provenance records | `ur claim-ledger validate` |
| `ur code-index [action] [query...]` | Build or query the local semantic code index | `ur code-index search "token refresh"` |
| `ur config set <key> <value...>` | Set a supported non-secret provider/model/Responses setting (`provider`, fallback/command path, model/base URL, OpenAI transport, or Responses store/compact/tool-search controls) | `ur config set openai_transport responses` |
| `ur grade-trajectory` | Grade captured agent control flow, tool order, and step budget | `ur grade-trajectory --file run.jsonl --min-score 70` |
| `ur knowledge [action] [args...]` | Manage the curated project knowledge base with provenance | `ur knowledge search auth` |
| `ur memory-integrity [action]` | Record, verify, or quarantine file-backed memory state | `ur memory-integrity verify` |
| `ur memory-suggest` | Propose durable, non-secret facts from the current session | `ur memory-suggest --help` |
| `ur recipe [action] [rest...]` | Initialize, list, and run structured-output playbooks; missing/invalid recipes and schema-invalid completed runs exit nonzero | `ur recipe list` |
| `ur repo-edit [action] [rest...]` | Index, preview, and apply rollback-safe repository edits | `ur repo-edit preview rename oldName newName` |
| `ur role-mode [action] [name]` | List or install the Architect, Code, Debug, and Ask role modes | `ur role-mode install architect` |
| `ur selftest [action]` | Run observable end-to-end drills against the shipped CLI | `ur selftest run` |
| `ur semantic-memory [action] [query...]` | Build and search the project-local lexical memory index (token overlap, not embeddings) | `ur semantic-memory search "release policy"` |
| `ur sources` | Inspect the current process's bounded in-memory untrusted-source ledger; a fresh standalone shell invocation normally has no prior-session entries | `ur sources --flagged --json` |
| `ur test-first [action]` | Detect and run compile/test/lint loops or install edit-time gates | `ur test-first detect` |
| `ur trigger [action]` | Parse GitHub/Slack mention payloads and optionally launch a bounded headless run | `ur trigger parse --file payload.json --source github` |
| `ur wiki [action]` | Generate and query the living repository wiki and prompt-injectable map; unknown actions and unavailable hook installation exit nonzero | `ur wiki generate` |

### Servers & integration endpoints
| Command | Purpose | Example |
|---|---|---|
| `ur a2a serve` | Negotiated A2A v1 JSON-RPC/HTTP+JSON plus stable v0.3 and UR compatibility routes | `UR_A2A_TOKEN=… ur a2a serve --port 8765` |
| `ur a2a card` | Print the A2A agent card | `ur a2a card --a2a-base-url https://host` |
| `ur a2a token mint / verify <token>` | Mint/verify A2A tokens | — |
| `ur ag-ui serve` | Secure AG-UI HTTP/SSE adapter with capability discovery | `ur ag-ui serve --allow-origin https://app.example` |
| `ur acp stdio` | Native ACP v1 with durable lifecycle/replay, modes, config, commands, permissions, MCP, and streaming | `ur acp stdio` |
| `ur acp serve / stop / status` | UR HTTP compatibility API used by the bundled IDE extensions | `ur acp serve --port 9100` |
| `ur ide [action] [rest...]` | Diagnose IDE connections and manage inline-diff bundles | `ur ide doctor` |
| `ur computer [action] [rest...]` | Screenshot or, with explicit approval, control the local desktop | `ur computer screenshot` |
| `ur speak [text...]` | Read text aloud through the supported local speech backend | `ur speak "Build complete"` |
| `ur sdk [action]` | Show or scaffold the generated headless UR SDK wrapper | `ur sdk init` |

### Safety & permission controls
| Command | Purpose | Example |
|---|---|---|
| `ur permission-profile [action] [name]` | List, activate, or clear named permission profiles | `ur permission-profile use reviewing` |
| `ur safety [action] [rest...]` | Inspect, initialize, and evaluate the project shell-safety policy | `ur safety check --command "git push" --json` |
| `ur sandbox [action] [commandArg...]` | Inspect OS sandbox support and command approval levels | `ur sandbox status --json` |

### Auth
| Command | Purpose | Example |
|---|---|---|
| `ur auth status` | Show auth state | `ur auth status --json` |
| `ur auth chatgpt / claude / gemini / antigravity` | Subscription CLI logins (providers currently `disabled: true` in the registry) | `ur auth chatgpt --device-auth --dry-run` |
| `ur auth login` / `ur auth logout` | Hidden legacy UR account OAuth compatibility actions; provider access should use `ur connect` or `ur auth <provider>` | — |

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
- Root adapters preserve argument boundaries by quoting Commander values and local handlers
  decode them with `parseArguments`; paths and task text containing spaces are not split.
- Local-command exit codes follow a stable script contract: `0` means the requested operation
  completed (including a documented dry run, list/status query, empty search result, or advisory
  safety classification), `1` means execution/data/resource/verification failure, and `2` means
  invalid syntax, action, or option. Workflow/spec/pattern/test-first runs, automation/trigger
  children, PR creation, browser smoke checks, repository edits, and integrity validators propagate
  unsuccessful outcomes instead of printing failure text with status 0. Fatal startup errors print
  `Fatal startup error: …` and exit 1.

## Source-only and nonstandard-build CLI surfaces

These implementations exist in the repository but are dead-code-eliminated from the
standard npm artifact. They must not be treated as available merely because their source
can be imported in tests:

| Build gate / audience | Source-only surface |
|---|---|
| `BG_SESSIONS` | `--bg`, `--background`, `ur ps`, `ur logs`, `ur attach`, `ur kill` |
| `BRIDGE_MODE` | `ur remote-control` and aliases `rc`, `remote`, `sync`, `bridge` |
| `DIRECT_CONNECT` | `ur server`, `ur open <cc-url>` |
| `SSH_REMOTE` | `ur ssh <host> [dir]` |
| `DAEMON` | `ur daemon` and its internal worker entrypoint |
| `BYOC_ENVIRONMENT_RUNNER` / `SELF_HOSTED_RUNNER` | `ur environment-runner`, `ur self-hosted-runner` |
| `TEMPLATES` | template-job `ur new`, `ur list`, `ur reply` fast paths |
| internal (`USER_TYPE=ant`) | `ur up`, `ur rollback`, `ur log`, `ur error`, `ur export`, and the separate `task create/list/get/update` registry |

The shipped `ur bg` command is a different, public background-agent implementation under
`src/commands/bg/`; it remains available even though the process-level `BG_SESSIONS` fast
paths are not.
