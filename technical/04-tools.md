# 04 — Tool Reference (model-invocable tools)

Source of truth: `src/tools.ts:getAllBaseTools()` and each `src/tools/<Name>Tool/`.
Tools are what the model calls during a turn. The pool is assembled per-session
(`assembleToolPool`): built-ins + MCP tools, deny-rule filtered, deduped, sorted for
prompt-cache stability. `--tools`, `--allowedTools`, `--disallowedTools`, and
`/permissions` rules shape this pool.

"Example" below shows a natural-language request that causes the agent to use the tool —
users don't call tools directly.

## Core file & search tools

| Tool | Purpose | Key inputs | Example request |
|---|---|---|---|
| `Read` | Read a file (text, images, notebooks) | `file_path`, `offset`, `limit` | "Open src/auth.ts and explain the login flow" |
| `Write` | Create/overwrite a file | `file_path`, `content` | "Create a README for this package" |
| `Edit` | Exact string replacement in a file | `file_path`, `old_string`, `new_string`, `replace_all` | "Rename this variable in that file" |
| `NotebookEdit` | Replace/insert/delete Jupyter cells | `notebook_path`, `cell_id`, `new_source` | "Fix the broken cell in analysis.ipynb" |
| `Glob` | Fast filename pattern matching | `pattern`, `path` | "Find all *.test.ts files" |
| `Grep` | Regex content search (ripgrep-backed) | `pattern`, `path`, `glob`, output modes | "Where is refreshToken referenced?" |
| `CodeSearch` | Semantic code search over the local embedding index (only when `UR_CODE_INDEX` enabled) | `query` | "Find code that debounces user input" |
| `Bash` | Run shell commands; supports background tasks, sandboxing, safety checks (`src/tools/BashTool/bashSecurity.ts`) | `command`, `timeout`, `run_in_background`, sandbox overrides | "Run the test suite" |
| `PowerShell` | Windows PowerShell variant (enabled on Windows) | same shape as Bash | — |

## Web & network tools

| Tool | Purpose | Key inputs | Example request |
|---|---|---|---|
| `WebFetch` | Fetch a URL → markdown → analyze with a small model | `url`, `prompt` | "Summarize this blog post: https://…" |
| `web_search` | Web search | `query` | "Search for the fastify v5 migration guide" |
| `Api` | Direct HTTP calls with JSON extraction | `url`, `method`, `headers`, `body`, `timeout` (≤300s), `extract` (dotted path) | "Call GET https://api.github.com/repos/x/y and give me .stargazers_count" |
| `Browser` | Drive a real browser (Playwright): goto/click/type/screenshot/evaluate/fetch | `url`, `action`, `selector`, `text`, `expression` | "Open localhost:3000, click Login, screenshot the result" |

## Dev-workflow tools

| Tool | Purpose | Key inputs | Example request |
|---|---|---|---|
| `GitHub` | GitHub operations without leaving the agent | `action`: `pr_list`, `pr_view`, `pr_create`, `issue_list`, `issue_create`, `repo_view`, `search_code`; `repo`, `title`, `body`, `head`, `base`, `number`, `query`, `draft`, `limit` | "Open a draft PR for this branch against main" |
| `Docker` | Container operations | `action`: `ps`, `build`, `run`, `exec`, `logs`, `stop`, `rm`, `compose_up`, `compose_down`; `image`, `container`, `command`, `file`, `detach` | "Build the image and start compose" |
| `TestRunner` | Run the project's tests with auto-detected or explicit command | `command`, `pattern`, `timeout` (≤600s), `watch` | "Run only the auth tests" |
| `Database` | SQL against sqlite/postgres/mysql/duckdb; read-only by default | `connection`, `database`, `query`, `readonly` (default true) | "How many rows are in users.db's sessions table?" |
| `LSP` | Language-server queries: goToDefinition, findReferences, hover, documentSymbol… (needs `ENABLE_LSP_TOOL=1`) | operation + position | "Find all references of parseConfig" |

## Planning, tasks & interaction

| Tool | Purpose | Example request |
|---|---|---|
| `TodoWrite` | Maintain the session todo list | (agent tracks multi-step work) |
| `TaskCreate` / `TaskGet` / `TaskUpdate` / `TaskList` | Structured task list v2 (dependencies, statuses) — replaces TodoWrite when `todo v2` enabled | "Track these five subtasks" |
| `EnterPlanMode` / `ExitPlanMode` | Enter/leave plan mode; plan approval flow | "Plan first, then implement" |
| `AskUserQuestion` | Multiple-choice questions to the user | (agent asks when blocked on a decision) |
| `TaskOutput` / `TaskStop` | Read output of / stop a background task | "Kill the dev server you started" |
| `EnterWorktree` / `ExitWorktree` | Move the session into/out of an isolated git worktree (worktree mode) | "Do this in a scratch worktree" |
| `SendUserMessage` | Send a mid-turn brief message to the user (Brief tool) | — |

## Multi-agent tools

| Tool | Purpose | Example request |
|---|---|---|
| `Agent` | Spawn a subagent (built-in types: `general-purpose`, `Explore`, `Plan`, `verification`, `statusline-setup`, `ur-code-guide`, plus user agents from `/agents` and `.ur/agents/`) | "Use a subagent to survey how errors are handled repo-wide" |
| `SendMessage` | Message another running agent/teammate | (agent coordination) |
| `TeamCreate` / `TeamDelete` | Create/remove agent teams (swarm mode, `isAgentSwarmsEnabled`) | "Spin up a team for this migration" |
| `ListPeers` | List peer agents (UDS inbox feature) | — |
| `Skill` | Invoke a skill programmatically (model-triggered skills) | "Use the dockerize skill" |
| `Workflow` | Run declarative workflow scripts (WORKFLOW_SCRIPTS gate) | — |

## Scheduling & monitoring (feature-gated)

| Tool | Gate | Purpose |
|---|---|---|
| `CronCreate` / `CronDelete` / `CronList` | AGENT_TRIGGERS | Local scheduled jobs (used by `/loop`, `/automation`) |
| `RemoteTrigger` | AGENT_TRIGGERS_REMOTE | Manage scheduled remote agents via API |
| `Monitor` | MONITOR_TOOL | Stream events from long-running watches |
| `Sleep` | PROACTIVE/KAIROS | Wait for a duration |
| `PushNotification` | KAIROS | Push a notification to the user's devices |
| `SendUserFile` | KAIROS | Deliver a file to the user |
| `SubscribePR` | KAIROS_GITHUB_WEBHOOKS | Subscribe to PR webhook events |

## MCP & discovery

| Tool | Purpose |
|---|---|
| `ListMcpResourcesTool` / `ReadMcpResourceTool` | List/read resources exposed by connected MCP servers |
| `mcp__<server>__<tool>` | Every connected MCP server's tools join the pool under this naming |
| `ToolSearch` | When the tool pool is large, less-used tools are deferred; this searches and loads their schemas on demand |

## Internal / special

| Tool | Gate | Purpose |
|---|---|---|
| `Config` | USER_TYPE=ant | Get/set UR settings programmatically |
| `Tungsten` | USER_TYPE=ant | Internal |
| `REPL` | REPL mode | Wraps Bash/Read/Edit inside a persistent VM; hides the primitives |
| `SuggestBackgroundPR` | ant | Suggest spinning work into a background PR |
| `StructuredOutput` | synthetic | Enforces structured output schemas in headless runs |
| `CtxInspect`, `TerminalCapture`, `WebBrowser`, `Snip`, `overflow_test`, `VerifyPlanExecution` | various flags | Context inspection, terminal panel capture, alt browser, history snip, testing |

## Permission model interaction

Every tool call passes through the permission layer (`src/utils/permissions/`,
`src/hooks/useCanUseTool.tsx`):
1. Deny rules (`/permissions`, settings `permissions.deny`) — blanket-denied tools are
   stripped from the pool before the model even sees them (`filterToolsByDenyRules`).
2. Allow rules auto-approve matching calls (e.g. `Bash(git:*)`).
3. Otherwise the user is prompted; `--dangerously-skip-permissions` bypasses (guarded by
   org policy `skipDangerousModePermissionPrompt` / policyLimits).
4. Bash additionally runs command safety analysis (`bashSecurity.ts`, destructive-command
   warnings, project safety policy from `/safety`) and optional OS sandboxing
   (`src/utils/sandbox`, `/sandbox` command, `sandbox` settings).
