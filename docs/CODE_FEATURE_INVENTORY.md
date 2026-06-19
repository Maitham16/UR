# UR Agent code feature inventory

This file is a code-derived inventory of what this agent can do in the
`ur-agent` 1.15.0 source tree. It is meant to cover behavior that is easy to
miss in user-facing documentation.

Sources traced include:

- `package.json`
- `bin/ur.js`
- `src/entrypoints/cli.tsx`
- `src/main.tsx`
- `src/query.ts`
- `src/commands.ts`
- `src/tools.ts`
- `src/constants/prompts.ts`
- `src/tools/**`
- `src/commands/**`
- `src/services/**`
- `src/security/**`
- `src/utils/settings/**`
- `src/utils/plugins/**`
- `src/entrypoints/mcp.ts`
- `src/sdk/index.ts`
- `marketplace-plugins/**`

Notes:

- "Feature-gated" means the code exists but is conditional on env vars,
  feature flags, build type, user type, or settings.
- "Internal-only" means the code path is restricted to Anthropic/internal
  user types or similar checks in this tree.
- "Stub" means the source exposes a command/tool name but the implementation is
  intentionally disabled, null, or placeholder in this build.
- Copy-artifact files with names like `* 2.ts` are not treated as canonical;
  the cleanup pass removed the stale `escalate 2.ts` and `ollama 2.ts` copies.

## Package and binary entry

- Publishes the CLI as `ur` from `bin/ur.js`.
- Uses Bun as the runtime.
- Runs `dist/cli.js` when present, otherwise `src/entrypoints/cli.tsx` with
  build macros.
- Exposes package scripts for start, dev, bundling, release checks,
  typechecking, tests, smoke tests, secret scanning, package checks, and
  prepack bundling.
- Includes a dependency-free TypeScript SDK in `src/sdk/index.ts` that shells
  out to `ur -p --output-format json`.

## Startup and runtime modes

- Fast `--version`, `-v`, and `-V` handling before full CLI load.
- Normal interactive terminal UI.
- Headless print mode with `-p` / `--print`.
- Output modes:
  - `text`
  - `json`
  - `stream-json`
- Streaming JSON input mode via `--input-format stream-json`.
- Structured output through `--json-schema`.
- Optional inclusion of hook events, partial assistant messages, and replayed
  user messages in streamed output.
- Debug modes:
  - `--debug`
  - `--debug-to-stderr`
  - `--debug-file`
  - verbose mode
- Minimal `--bare` mode that forces simple/local behavior and skips many
  startup features such as hooks, LSP, plugin sync, attribution, auto-memory,
  background prefetches, keychain prefetch, and project instruction discovery.
- Init flows:
  - `--init`
  - `--init-only`
  - maintenance mode
- Resume flows:
  - continue last session
  - resume by session
  - fork/resume variants
  - resume from pull request context
  - no-persistence mode
  - rewind files
- Model controls:
  - model selection
  - effort selection
  - fallback model
  - workload flags
  - beta flags
  - custom agents passed by `--agents <json>`
- Turn and budget controls:
  - max turns
  - task budget
  - max budget
  - thinking controls
- System prompt controls:
  - override system prompt
  - append system prompt
  - load prompt additions from a file
  - dump system prompt when gated
- Workspace controls:
  - `--add-dir`
  - `--settings`
  - `--setting-sources`
  - `--ide`
  - `--strict-mcp-config`
  - `--session-id`
  - `--name`
  - `--file`
- Worktree controls:
  - `-w` / `--worktree [name]`
  - `--tmux`
  - tmux worktree fast path
- Background session controls, feature-gated:
  - `ps`
  - `logs`
  - `attach`
  - `kill`
  - `--bg` / `--background`
- Daemon and worker modes, feature-gated:
  - `daemon`
  - `--daemon-worker`
  - environment runner
  - self-hosted runner
- Browser and desktop integration entrypoints:
  - Chrome MCP mode
  - Chrome native host mode
  - computer-use MCP mode, feature-gated
  - deep-link handling, feature-gated
- Remote/session server entrypoints:
  - `server`
  - `open <cc-url>`
  - SSH remote runner, feature-gated
  - remote-control / assistant bridge, feature-gated
- A2A fast path in `bin/ur.js`:
  - local A2A HTTP server
  - health endpoint
  - agent-card endpoint
  - task endpoint
  - loopback-only protection unless bearer token is configured
  - dry-run mode
  - headless `ur -p --output-format json` execution for tasks

## Main CLI command families

The CLI registers these top-level command families in `src/main.tsx`:

- `mcp`: configure and manage MCP servers.
- `auth`: login, status, and logout.
- `plugin` / `plugins`: validate, install, update, enable, disable, uninstall,
  and manage marketplaces.
- `setup-token`: configure a long-lived authentication token.
- `agents`: list configured agents.
- `agent-trends`: show coverage against current agent technology trends.
- `agent-features` / `agent-roadmap`: show or initialize agent feature
  scaffolds.
- `agent-templates` / `agent-template`: list or install reusable project
  agent templates.
- `automation` / `automations`: manage project-local automation specs and the
  resident scheduler.
- `agent-task` / `task-pr`: summarize task state, git diff status, and PR
  handoff commands.
- `model-doctor` / `model-capabilities`: inspect local Ollama model
  capabilities.
- `semantic-memory` / `memory-index`: build and search a project memory index.
- `claim-ledger` / `claims`: manage claim-to-source provenance.
- `browser-qa`: validate and smoke-run browser QA replay fixtures.
- `pattern` / `patterns`: run or install multi-agent collaboration patterns.
- `workflow` / `wf`: create, validate, graph, run, plan, and resume declarative
  workflows.
- `agent-inspect` / `inspect-agents`: reconstruct subagent timelines from
  transcripts.
- `route` / `intent`: classify task intent and recommend agents/patterns.
- `model-route` / `model-pick`: recommend a local Ollama model for a task.
- `crew` / `crews`: run a headless multi-agent crew with a shared board.
- `goal` / `goals`: track long-horizon objectives and resume workflows.
- `spec` / `specs`: spec-driven development scaffolding and execution.
- `escalate`: capability-aware local model escalation.
- `arena` / `best-of`: run competing agents in isolated worktrees and judge
  diffs.
- `bg` / `background-agent`: run detached local background agents with durable
  state, logs, optional worktrees, fanout, live steering, and opt-in PRs.
- `ci-loop` / `heal`: self-healing build/test loop with bounded fix attempts.
- `artifacts` / `artifact`: create, review, approve, reject, and capture
  deliverables; comments can steer linked background tasks.
- `trigger` / `mention`: parse webhook payloads and optionally launch a run.
- `sdk` / `embed`: show or scaffold programmatic SDK usage.
- `knowledge` / `kb`: curated project knowledge base with provenance.
- `eval` / `evals`: public agent eval harness.
- `code-index` / `codeindex`: semantic code index backed by local embeddings,
  including watch mode for auto-reindex.
- `memory retention`: project-local memory retention controls.
- `ide diff`: editor-readable inline diff bundles for native review surfaces.
- `role-mode` / `roles`: built-in role modes such as Architect, Code, Debug,
  and Ask.
- `a2a`: agent-to-agent card, server, and token utilities.
- `auto-mode`: inspect classifier defaults/config/critique when gated.
- `doctor`: updater and health diagnostics.
- `update` / `upgrade`: check and install updates.
- `install`: install native builds.
- `completion`: shell completion support.

Internal-only or gated command families include rollback, log, error, export,
task-list management, remote control, assistant bridge, and selected dev
commands.

## Slash command inventory

Slash commands are assembled from built-ins, skills, plugins, workflow commands,
MCP prompt commands, and feature-gated sources in `src/commands.ts`.

Code-visible slash command names include:

- `a2a-card`
- `actions`
- `add-dir`
- `advisor`
- `agent-features`
- `agent-inspect`
- `agent-task`
- `agent-templates`
- `agent-trends`
- `agents`
- `analyze`
- `arena`
- `artifacts`
- `automation`
- `branch`
- `brief`
- `browser`
- `browser-qa`
- `btw`
- `chrome`
- `ci-loop`
- `cite`
- `claim-ledger`
- `clear`
- `code-index`
- `color`
- `compact`
- `compliance`
- `config`
- `context`
- `convert`
- `copy`
- `cost`
- `create-skill`
- `crew`
- `desktop`
- `devcontainer`
- `diff`
- `dna`
- `doctor`
- `effort`
- `escalate`
- `eval`
- `evidence`
- `exit`
- `export`
- `extra-usage`
- `fast`
- `feedback`
- `files`
- `forget`
- `goal`
- `graph`
- `guardrails`
- `harden`
- `heapdump`
- `help`
- `hooks`
- `ide`
- `image`
- `index`
- `init`
- `install-github-app`
- `install-slack-app`
- `ir`
- `kali`
- `keybindings`
- `knowledge`
- `lab`
- `learn`
- `login`
- `logout`
- `mcp`
- `memory`
- `mode`
- `model`
- `model-doctor`
- `model-route`
- `os`
- `output-style`
- `paper`
- `passes`
- `pattern`
- `permissions`
- `plan`
- `playbook`
- `plugin`
- `pr-comments`
- `privacy-settings`
- `project`
- `insights`
- `rate-limit-options`
- `read`
- `release-notes`
- `reload-plugins`
- `remember`
- `remote-control`
- `remote-env`
- `rename`
- `research`
- `resume`
- `review` / `ultrareview`
- `rewind`
- `role-mode`
- `route`
- `sandbox`
- `scope`
- `sdk`
- `search`
- `security`
- `security-review`
- `semantic-memory`
- `session`
- `skills`
- `spec`
- `stability`
- `stats`
- `status`
- `statusline`
- `summarize`
- `tag`
- `tasks`
- `terminal-setup`
- `theme`
- `think-back` / `thinkback-play`
- `threat-model`
- `toolsmith`
- `trace`
- `trigger`
- `upgrade`
- `ur-doctor`
- `ur-init`
- `usage`
- `verify`
- `video`
- `vim`
- `voice`
- `vuln`
- `web-setup`
- `workflow`
- `workspace`
- `youtube`

Internal-only command stubs or restricted commands in the registry include
backfill sessions, break cache, bughunter, commit, commit/push/PR, context
visualization, good UR, issue, init verifiers, force snip, mock limits, bridge
kick, version, ultraplan, subscribe PR, reset limits, onboarding, share,
summary, teleport, trace/debug helpers, perf issue, env, OAuth refresh,
debug-tool-call, agents platform, and autofix PR.

Remote-safe slash commands are limited to session, exit, clear, help, theme,
color, vim, cost, usage, copy, btw, feedback, plan, keybindings, and
statusline.

Bridge-safe local commands include compact, clear, cost, summary,
release-notes, and files. Prompt commands are allowed in the bridge path, while
local JSX commands are blocked.

## Conversation loop features

- Maintains an assistant/user/tool message loop in `src/query.ts`.
- Streams assistant output and tool-use events.
- Executes tool calls through streaming and non-streaming orchestration.
- Supports parallel tool calls where the model emits them.
- Validates and repairs missing tool result blocks.
- Tracks tool-use summaries.
- Enforces turn limits and task budgets.
- Handles retryable API/model errors.
- Supports fallback models.
- Handles token-budget continuation.
- Applies tool result output budgets and content replacement.
- Supports large-output persistence and references.
- Performs auto-compaction and micro-compaction.
- Supports session-memory compaction.
- Supports post-compact cleanup.
- Has a disabled/stubbed context-collapse service in this build.
- Handles prompt-too-long recovery when feature-gated.
- Supports stop hooks and post-sampling hooks.
- Tracks verifier state and can inject reminders.
- Supports structured JSON output through a synthetic output tool.

## Prompt and behavioral system

The system prompt source in `src/constants/prompts.ts` includes:

- UR identity as a coding agent.
- Concise terminal-oriented output rules.
- Code editing expectations.
- Tool-use discipline and preference for file tools over shell ad hoc edits.
- Planning guidance for multi-step tasks.
- Guidance for using subagents.
- Guidance for invoking skills.
- Optional verification contract.
- Cyber-safety risk guidance.
- Hook instructions.
- MCP instructions.
- Memory instructions.
- Language and output-style customization.
- System reminders.
- Token-budget instructions.
- Brief/proactive sections.
- Scratchpad and function-result clearing sections.

For Ollama-backed providers, the prompt adds stricter instructions around:

- using structured tool calls rather than raw JSON/tool XML
- using `Write` and `Edit` for file changes
- preferring parallel tool calls
- planning before larger tasks
- stopping repeated failing calls
- verifying before claiming completion
- responding to command failures
- avoiding empty responses

`UR_CODE_SIMPLE` replaces this with a minimal prompt containing identity, cwd,
and date.

## Built-in tools

Tool assembly is centralized in `src/tools.ts`. Availability depends on mode,
feature flags, user type, MCP, and settings.

Core tools:

- `Bash`: run shell commands with permissions, sandbox checks, timeout,
  background execution, read-only auto-approval heuristics, destructive command
  warnings, output truncation/persistence, image output handling, git operation
  tracking, and UI collapsing for common read/search commands.
- `PowerShell`: PowerShell command execution with similar permission,
  path-safety, destructive-warning, and constrained-language checks.
- `Read`: read text files, selected line ranges, images, notebooks, and PDF
  page ranges; blocks binary or risky device paths; enforces size/token limits;
  tracks reads before edits.
- `Edit`: replace exact strings in files after prior read; validates paths,
  permissions, concurrent modifications, max file size, and secret exposure;
  records diffs/history.
- `Write`: create or overwrite files; requires prior read for existing files;
  validates permissions and unexpected modifications; records diffs/history.
- `NotebookEdit`: edit notebook cells.
- `Glob`: find files by glob pattern.
- `Grep`: search file contents with optimized ripgrep-backed behavior.
- `CodeSearch`: semantic code search through a local embedding index.
- `WebFetch`: fetch a URL and run a prompt over retrieved content.
- `WebSearch`: web search through the configured model/tool backend.
- `TodoWrite`: maintain conversation-local todo state.
- `Agent`: launch subagents synchronously or in the background; supports custom
  agents, built-in agents, plugin agents, MCP requirements, worktree isolation,
  remote mode, permission modes, cwd, background output files, teams, memory,
  and model overrides.
- `TaskOutput`: read background task output. Deprecated in favor of reading the
  output file directly.
- `TaskStop`: stop background tasks.
- `TaskCreate`, `TaskGet`, `TaskUpdate`, `TaskList`: task-list v2 tools for
  tracked work items, ownership, status, and blockers.
- `TeamCreate`, `TeamDelete`, `SendMessage`: multi-agent team coordination.
- `AskUserQuestion`: ask structured user questions from the agent loop.
- `EnterPlanMode` and `ExitPlanMode`: proposal/approval planning flow.
- `EnterWorktree` and `ExitWorktree`: enter or leave isolated worktree sessions.
- `Skill`: execute prompt-backed skills from local skills, bundled skills,
  plugins, or MCP.
- `Brief`: send concise status messages or user-facing updates.
- `SendUserFile`: send a generated file to the user, feature-gated.
- `ListMcpResourcesTool` and `ReadMcpResourceTool`: enumerate and read MCP
  resources.
- `ToolSearch`: deferred tool discovery over tool metadata.
- `Config`: read/write supported settings, internal-only in this build.
- `REPL`: internal REPL tooling.
- `Tungsten`: internal-only tooling.
- `SuggestBackgroundPR`: internal-only background PR suggestion.
- `LSP`: language-server diagnostics and symbol context, feature-gated.
- `WorkflowTool`: workflow execution helper, feature-gated.
- `CronCreate`, `CronDelete`, `CronList`: schedule recurring tasks,
  feature-gated.
- `RemoteTrigger`: trigger remote runs, feature-gated.
- `Monitor`: monitoring helper, feature-gated or stubbed depending on build.
- `Sleep`: wait/sleep tool.
- `PushNotification`: push notifications, feature-gated.
- `SubscribePR`: subscribe to PR changes, feature-gated/internal.
- `Snip`: snip tool, feature-gated/internal.
- `WebBrowserTool`, `CtxInspectTool`, `TerminalCaptureTool`: present as
  tool surfaces but stubbed or disabled in this build.
- `StructuredOutput`: synthetic tool used for JSON-schema output.
- `mcp__<server>__<tool>`: dynamically assembled MCP server tools.

Simple/bare mode keeps the tool set narrow, generally `Bash`, `Read`, and
`Edit`, with REPL mode substituting `REPL` where applicable.

## Built-in agents

Built-in agents live under `src/tools/AgentTool/built-in`:

- `general-purpose`: broad-purpose subagent with all tools.
- `Explore`: read/search-only exploration agent, no file writes.
- `plan`: planning agent for implementation designs, no file writes.
- `verification`: adversarial verification agent for checking tests, builds,
  browser behavior, and task completion.
- `statusline-setup`: statusline configuration agent with read/edit tools.
- `urCodeGuide`: UR documentation and guide agent with read/search/web tools.

Custom agents can be loaded from user, project, managed, flag, or plugin
sources. Agent definitions can configure:

- description
- tool allowlist
- disallowed tools
- prompt
- model
- effort
- permission mode
- required MCP servers
- hooks
- max turns
- skills
- initial prompt
- memory
- background behavior
- isolation mode

Agent resolution considers built-ins, plugins, user settings, project settings,
CLI-provided agents, and managed settings.

## Agent-platform features

The `src/services/agents/**` area implements a large set of higher-level agent
systems:

- A2A server and Agent Card metadata, with task submit/list/status/output/cancel
  routes backed by local background tasks.
- Background-agent runner under `.ur/background`, including stream-json stdin
  injection for live artifact steering.
- HMAC-based attenuated A2A delegation tokens with audience, subject, scope,
  and TTL.
- Arena/best-of workflow: run multiple agents in isolated worktrees, judge
  diffs, optionally apply the winner.
- Reviewable artifacts under `.ur/artifacts`.
- IDE diff bundles under `.ur/ide/diffs` plus the
  `extensions/vscode-ur-inline-diffs` native VS Code review extension.
- Benchmark adapters that import local SWE-bench, Terminal-Bench, and Aider
  Polyglot JSON/JSONL exports into UR eval suites.
- CI loop: run build/test commands, capture failures, spawn a fix agent, rerun
  with bounded attempts, optionally commit/push.
- Crew mode: lead agent decomposes a goal into a shared task board that worker
  agents claim and execute.
- Long-horizon goals persisted across sessions.
- Spec-driven development under `.ur/specs`.
- Declarative workflows with steps, dependencies, gates, resume state, and
  graph rendering.
- Live workflow board.
- Scheduler service for automations through launchd, systemd, cron, or daemon
  mode.
- Knowledge base with source provenance, chunking, dense embeddings, search,
  list, prune, and status.
- Learning from artifact outcomes into model/category success stats and
  lessons.
- Local model routing based on capability fit.
- Intent routing for task category, agent choice, and collaboration pattern.
- Multi-agent collaboration patterns such as PEER and DOE.
- Webhook trigger parsing for GitHub, Slack, and generic payloads.
- Execution target wrappers for local, Docker, and devcontainer execution.
- Eval harness with suites, cases, checks, reports, and replayable runs.
- Agent inspector for reconstructing subagent timelines from transcripts.
- Capability-aware model escalation between fast and oracle models.
- Feature scaffold and reusable agent-template installation.

## Memory and project knowledge

- User/project/team memory loading.
- Relevant memory scan.
- Conversation/session memory compaction.
- Memory extraction from sessions.
- Auto-dream background memory consolidation.
- Team memory sync.
- Secret scanning and guards for team memory writes.
- Memory commands:
  - remember
  - forget
  - memory
  - semantic-memory
  - knowledge
- Lightweight project file operations under `src/ur/fileops.ts`:
  - read project files
  - search text-like files
  - maintain `.ur/index/files.txt`
- Project DNA generation under `src/ur/projectDna.ts`:
  - language detection
  - package manager detection
  - build/test/lint/run command detection
  - key folders
  - git/readme context
  - `.ur/project_dna.md`
- Project notes and research graph helpers under `src/ur/**`.

## Verification and quality gates

The verifier service in `src/services/verifier/**` includes:

- L1 deterministic verifier enabled by default unless disabled by env.
- Modes:
  - `off`
  - `loose`
  - `strict`
- Empty-turn detection.
- Done-claim detection against actual tool/mutation evidence.
- Project gates from `.ur/verify.json`.
- Loop detection.
- Rejection cap.
- Optional L2 verification subagent through env opt-in.
- Manual deeper verification through `/verify`.
- Verifier reminders injected back into the conversation loop.

## Permissions and sandboxing

Permission modes:

- `default`
- `plan`
- `acceptEdits`
- `bypassPermissions`
- `dontAsk`
- `auto`, feature-gated

Permission features:

- Tool-level allow, deny, and ask rules.
- MCP server/tool permission rules.
- CLI, command, session, user, project, local, and managed setting sources.
- Permission request hooks.
- Permission-denial tracking.
- Auto-mode classifier integration when gated.
- Dangerous Bash/PowerShell rule detection.
- Auto-mode stripping of dangerous rules.
- Additional directory validation.
- Security restriction gates.

Sandbox configuration supports:

- enabled/disabled state
- fail-if-unavailable
- automatic Bash approval when sandboxed
- explicit unsandboxed command allowances
- network allowed domains
- managed-only network controls
- Unix socket controls
- local binding controls
- proxy ports
- filesystem read/write allow and deny rules
- ignored violations
- weaker nested/network isolation flags
- excluded commands
- custom ripgrep behavior

## MCP integration

MCP features:

- CLI management through `ur mcp`.
- MCP stdio server via `src/entrypoints/mcp.ts`.
- Exposes built-in tools through MCP.
- Converts Zod schemas to JSON schema for MCP tools.
- Runs tools in non-interactive context with normal permission checks.
- Server scopes:
  - local
  - user
  - project
  - dynamic
  - enterprise
  - urai
  - managed
- Transports:
  - stdio
  - SSE
  - HTTP
  - WebSocket
  - SDK/in-process
  - IDE variants
  - UR.ai proxy
- Config support:
  - command/args/env
  - URL/headers
  - headers helper
  - OAuth
  - client IDs and client secrets
  - callback ports
  - auth server metadata URL
  - XAA identity-provider settings, feature-gated
- Connection states:
  - connected
  - failed
  - needs auth
  - pending
  - disabled
- MCP resources and prompt commands.
- Official registry lookup/cache.
- Environment variable expansion.
- Channel allowlists, permissions, and notifications.
- Elicitation handling.
- VS Code SDK MCP support.
- Tool normalization as `mcp__server__tool`.

## Hooks

Hook events include:

- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `Notification`
- `UserPromptSubmit`
- `SessionStart`
- `SessionEnd`
- `Stop`
- `StopFailure`
- `SubagentStart`
- `SubagentStop`
- `PreCompact`
- `PostCompact`
- `PermissionRequest`
- `PermissionDenied`
- `Setup`
- `TeammateIdle`
- `TaskCreated`
- `TaskCompleted`
- `Elicitation`
- `ElicitationResult`
- `ConfigChange`
- `WorktreeCreate`
- `WorktreeRemove`
- `InstructionsLoaded`
- `CwdChanged`
- `FileChanged`

Hook command types:

- shell command hooks
- PowerShell hooks
- prompt/LLM hooks
- HTTP hooks
- agent/verifier hooks

Hook features:

- conditional `if` permission-rule filters
- timeouts
- status messages
- once-only hooks
- async command hooks
- async rewake behavior
- model selection for prompt/agent hooks
- HTTP headers and allowed environment variables
- exit-code semantics that can block, feed stderr to the model, erase prompts,
  or decide permission requests depending on event type

## Security features

The `src/security/**` subsystem and related slash commands provide:

- Security command dispatcher.
- Source-code security audit.
- Secret scanning and redaction.
- Attack-surface mapping.
- Dependency inventory.
- OSV vulnerability audit.
- Dockerfile, Kubernetes, Terraform, and cloud/IaC audit.
- Threat modeling.
- Network snapshot and packet-capture summary helpers.
- Incident response collection.
- IR timeline support.
- Containment planning.
- Compliance reports.
- SSDF, CIS, ASVS, OWASP, CWE, and MITRE mappings.
- Playbooks.
- Local security labs.
- Hardening checks.
- Safe command runner.
- Policy/classifier helpers.
- Vulnerability-intelligence helpers.
- Web audit helpers.

Security slash-command families include:

- `/security`
- `/security-review`
- `/threat-model`
- `/vuln`
- `/ir`
- `/compliance`
- `/playbook`
- `/lab`
- `/harden`
- `/kali`

`/security` subcommands include scan, code, secrets, attack-surface,
dependencies, classify, status, rules, report, scope, mode, threat-model, vuln,
net, ir, attack, compliance, playbook(s), lab, secure-design, secure-api,
secure-ci, secure-docker, and secure-deploy.

## Plugins and marketplaces

Plugin loading supports:

- installed marketplace plugins
- session-only `--plugin-dir`
- plugin manifests
- plugin commands
- plugin agents
- plugin skills
- plugin hooks
- output styles
- MCP servers
- LSP servers
- plugin settings
- duplicate-name handling
- enable/disable state
- trust warnings
- marketplace add/list/remove/update
- sparse marketplace checkouts
- cached marketplace installs
- versioned plugin cache
- seed caches
- zip caches
- legacy cache migration
- blocked marketplaces
- strict known-marketplace policy
- managed plugin settings

Bundled marketplace plugin families in `marketplace-plugins/**`:

- code review
- evaluate response
- explain error
- git summary
- GitHub issues, PR creation, PR review, repo health, and GitHub workflow skill
- GitLab issues, merge request creation/review, pipeline, and GitLab workflow
  skill
- hello example plugin
- Hugging Face model/dataset search, downloads, model cards, and HF workflow
  skill
- Miro board, diagram, export, stickies, and Miro workflow skill
- Obsidian backlinks, daily notes, MOC, second brain, vault search, and second
  brain skill
- PowerPoint deck creation, markdown-to-deck, review, theme, and deck-craft
  skill
- release notes
- skill forge and skill authoring
- Word document creation, markdown-to-docx, edit, review, and document-craft
  skill

## Configuration features

The Config tool supports these settings where available:

- `theme`
- `editorMode`
- `verbose`
- `preferredNotifChannel`
- `autoCompactEnabled`
- `autoMemoryEnabled`
- `autoDreamEnabled`
- `fileCheckpointingEnabled`
- `showTurnDuration`
- `terminalProgressBarEnabled`
- `todoFeatureEnabled`
- `model`
- `alwaysThinkingEnabled`
- `permissions.defaultMode`
- `language`
- `teammateMode`
- `classifierPermissionsEnabled`, internal-only
- `voiceEnabled`, feature-gated
- `remoteControlAtStartup`, feature-gated
- push-notification settings, feature-gated

The broader settings schema also covers:

- environment variables
- API-key helpers
- AWS/GCP auth refresh
- XAA identity-provider settings
- file suggestions
- gitignore behavior
- cleanup retention
- attribution
- git instructions
- permission allow/deny/ask/default mode/additional dirs
- model lists and model overrides
- MCP allow/deny/project approvals
- hooks
- worktree symlink and sparse settings
- hook disabling
- default shell
- managed-only hooks, permissions, and MCP settings
- HTTP hook URL/env policies
- strict plugin-only customization
- statusline command
- enabled plugins
- extra marketplaces
- marketplace blocklists
- authentication organization/method
- output style
- language
- sandbox settings
- surveys
- spinner
- syntax highlighting
- terminal title
- thinking and effort
- advisor
- fast mode
- prompt suggestions
- agent settings
- company announcements
- plugin config
- remote defaults
- auto updates/channels
- reduced motion
- auto memory and auto dream
- dangerous-mode prompts
- auto-mode config
- SSH configs
- UR.md excludes
- plugin trust message state

## Model/provider behavior

- This external build routes model calls through an Ollama provider shim.
- The Ollama router inspects local models and classifies likely coding/fast
  capabilities.
- Auto-routing is on by default through `UR_OLLAMA_AUTO_ROUTE`.
- Simple prompts can route to a faster model.
- Complex coding prompts can route to the best available coder model.
- Model doctor and model route commands expose capability reports and
  recommendations.
- Embedding-backed features use local Ollama embeddings such as
  `nomic-embed-text` where configured.

## UI and terminal experience

Terminal/UI features include:

- Ink/React interactive UI.
- Theming and color controls.
- Vim mode.
- Status line configuration.
- Keybinding help.
- Cost and usage displays.
- Session browser and resume UI.
- Compacting UI.
- Permission prompts.
- MCP approval UI.
- Plugin management UI.
- Install/setup flows.
- Feedback and BTW commands.
- Terminal setup.
- Desktop, Chrome, IDE, remote environment, and OS integration commands.
- Voice command surface, feature-gated.
- Image/video/youtube command surfaces.

## SDK and embedding

`src/sdk/index.ts` exposes:

- `query`
- `queryJSON`
- `UrClient`
- `parseResultText`

The SDK is intentionally small and dependency-free. It shells out to the local
`ur` binary in print mode, uses JSON output, supports cwd/env/bin overrides, and
can pass max turns, model, permission mode, and extra args.

## Documentation gaps this inventory exposes

The code includes many features that are easy to miss if reading only user docs:

- Agent-platform workflows, goals, specs, crews, arena, CI loop, artifacts,
  triggers, evals, and learning.
- A2A card/server/token support.
- Rich hook event model.
- Plugin marketplace and bundled plugin system.
- Security audit, incident-response, compliance, and lab features.
- Local knowledge, semantic memory, project DNA, and code-index subsystems.
- Verifier and project gate logic.
- Multiple remote/background/daemon/server modes.
- MCP server mode that exposes UR tools to other clients.
- Feature-gated browser, Chrome, computer-use, voice, push, cron, and remote
  features.
