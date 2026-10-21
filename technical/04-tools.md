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
| `CodeSearch` | Semantic code search over the local embedding index — auto-enabled when a built index exists (`ur code-index build`); `UR_CODE_INDEX=off` disables | `query` | "Find code that debounces user input" |
| `Bash` | Run shell commands; supports background tasks, sandboxing, safety checks (`src/tools/BashTool/bashSecurity.ts`), and a process-group-aware macOS compatibility implementation for generated GNU `timeout` commands; commands with unterminated quotes are rejected pre-execution with an actionable diagnostic (errorCode 11, heredoc guidance) | `command`, `timeout`, `run_in_background`, sandbox overrides | "Run the test suite" |
| `PowerShell` | Windows PowerShell variant (enabled on Windows) | same shape as Bash | — |

## Web & network tools

| Tool | Purpose | Key inputs | Example request |
|---|---|---|---|
| `WebFetch` | Fetch a public HTTP(S) URL → markdown → analyze with a small model; DNS and redirects are checked against private/reserved addresses. A query-scoped, URL-keyed circuit breaker refuses repeated permanent 4xx links even when the hidden prompt changes, bounds alternating dead links, and leaves transient responses retryable | `url`, `prompt` | "Summarize this blog post: https://…" |
| `Computer` | Desktop control: screenshot (read-only), click, type. Clicks bounds-checked against real screen geometry; state-changing actions always ask. macOS/Linux only |
| `web_search` | Web search | `query` | "Search for the fastify v5 migration guide" |
| `Api` | Direct public HTTP(S) calls with JSON extraction; private targets, unsafe redirects, oversized responses, GET bodies, and silent sensitive-header sends are rejected/confirmed | `url`, `method`, `headers`, `body`, `timeout` (≤300s), `extract` (dotted path) | "Call GET https://api.github.com/repos/x/y and give me .stargazers_count" |
| `Browser` | Drive a persistent Playwright browser session: goto/click/type/screenshot/evaluate/fetch; every navigation and subrequest is URL-guarded | `url`, `action`, `selector`, `text`, `expression` | "Open the public staging UI, click Login, screenshot the result" |

## Dev-workflow tools

| Tool | Purpose | Key inputs | Example request |
|---|---|---|---|
| `GitHub` | GitHub operations without leaving the agent; PR/issue creation always enters the permission path and requires non-interactive title/body input | `action`: `pr_list`, `pr_view`, `pr_create`, `issue_list`, `issue_create`, `repo_view`, `search_code`; `repo`, `title`, `body`, `head`, `base`, `number`, `query`, `draft`, `limit` | "Open a draft PR for this branch against main" |
| `Docker` | Container operations | `action`: `ps`, `build`, `run`, `exec`, `logs`, `stop`, `rm`, `compose_up`, `compose_down`; `image`, `container`, `command`, `file`, `detach` | "Build the image and start compose" |
| `TestRunner` | Run project tests through the Bash permission/sandbox/hook path with auto-detected or explicit command | `command`, `pattern`, `timeout` (≤600s), `watch` | "Run only the auth tests" |
| `Database` | SQL against sqlite/postgres/mysql/duckdb; read-only mode is enforced by both classification and each database engine | `connection`, `database`, `query`, `readonly` (default true) | "How many rows are in users.db's sessions table?" |
| `LSP` | Language-server queries: goToDefinition, findReferences, hover, documentSymbol… (needs `ENABLE_LSP_TOOL=1`) | operation + position | "Find all references of parseConfig" |

## Planning, tasks & interaction

| Tool | Purpose | Example request |
|---|---|---|
| `TodoWrite` | Maintain the session todo list | (agent tracks multi-step work) |
| `TaskCreate` / `TaskGet` / `TaskUpdate` / `TaskList` | Structured task tracking with dependencies and statuses. The default strict-hybrid gate requires an actionable task before mutation for multi-outcome, sequenced, planned, delegated, project-sized, and high-risk lifecycle work, while atomic low-risk requests stay direct. No synthetic task is created merely because the user sent a prompt; explicit boards are resumed and reconciled across replies and interruptions | "Track these five subtasks" |
| `EnterPlanMode` / `ExitPlanMode` | Enter/leave plan mode; plan approval flow | "Plan first, then implement" |
| `AskUserQuestion` | Mandatory for every real user-facing question with two or more plausible concrete answers. Prefer 2-8 focused choices, preserve every meaningful choice when there are more, and use plain text only for genuinely open-ended questions with no useful concrete alternatives. Malformed single-suggestion output gains a neutral rejection path without inventing an answer | (agent needs a user decision) |
| `TaskStop` | Stop a background task; completed task results are delivered automatically | "Kill the dev server you started" |
| `NvidiaSpecial` | Describe or run a generated NVIDIA Special contract without replacing the active agent. Uses each Build card's exact HTTP/NVCF/gRPC endpoint, method, function ID, request/response schema, validates exact JSON, binds local files, uploads NVIDIA Assets, polls async work, and saves returned media/binary/JSON artifacts | "Use NVIDIA Cosmos to generate a video" |
| `EnterWorktree` / `ExitWorktree` | Move the session into/out of an isolated git worktree (worktree mode) | "Do this in a scratch worktree" |
| `SendUserMessage` | Send a mid-turn brief message to the user (Brief tool) | — |

## Multi-agent tools

The table below lists tools present in the public build. Internal overlay
modules that export `null` are compile-time placeholders, are never added to
the tool pool, and are not supported user-facing tools.

| Tool | Purpose | Example request |
|---|---|---|
| `Agent` | Spawn a subagent (built-in types: `general-purpose`, `Explore`, `Plan`, `verification`, `statusline-setup`, `ur-code-guide`, plus user agents from `/agents` and `.ur/agents/`). Public builds always register the shipped read-only `Explore`/`Plan` definitions. From the main session in any permission mode, only those definitions can run before an actionable task exists; their plan permissions override the parent. A provider that mislabels an explicit read-only or pure research/report brief as `general-purpose` is reduced to shipped Explore before gating. Briefs containing implementation or mutation directives and all custom, nested, named/team, worktree, and cwd delegation remain gated | "Use a subagent to survey how errors are handled repo-wide" |
| `SendMessage` | Message another running agent/teammate | (agent coordination) |
| `TeamCreate` / `TeamDelete` | Create/remove agent teams (swarm mode, `isAgentSwarmsEnabled`) | "Spin up a team for this migration" |
| `Skill` | Invoke a skill programmatically (model-triggered skills) | "Use the dockerize skill" |

## Automation and communication (implemented, feature-gated)

| Tool | Gate | Purpose |
|---|---|---|
| `CronCreate` / `CronDelete` / `CronList` | AGENT_TRIGGERS | Local scheduled jobs (used by `/loop`, `/automation`) |
| `RemoteTrigger` | AGENT_TRIGGERS_REMOTE | Manage scheduled remote agents via API |
| `Sleep` | PROACTIVE/KAIROS | Wait for a duration |
| `SendUserFile` | KAIROS | Deliver validated local files to the user, including bridge upload metadata when available |
| `PushNotification` | KAIROS/KAIROS_PUSH_NOTIFICATION | Send an opt-in OS/terminal notification when a notification transport is available |

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
| `Tungsten` | USER_TYPE=ant + tmux | Create, drive, capture, list, and stop persistent terminal sessions on UR's isolated tmux socket; literal text and special keys use separate argument-safe operations, and the active pane has a live panel |
| `REPL` | REPL mode | Wraps Bash/Read/Edit inside a persistent VM; hides the primitives |
| `StructuredOutput` | synthetic | Enforces structured output schemas in headless runs |

`ListPeers`, `Workflow`, `Monitor`, `SubscribePR`, `SuggestBackgroundPR`, `CtxInspect`,
`TerminalCapture`, `WebBrowser`, `Snip`, `overflow_test`, and
`VerifyPlanExecution` are internal overlay names only. Their public-source
modules are inert placeholders and they are intentionally excluded from the
supported tool reference rather than presented as partial implementations.

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

File Edit/Write/NotebookEdit require the exact content snapshot the model read,
not only a modification timestamp. Full and ranged reads are compared at the
final write boundary, preventing same-timestamp external replacements from
being overwritten.

## Execution-bound verification

The shared tool executor records actual foreground `Bash`/`PowerShell`
executions for a verification run: tool-use ID, exact command and cwd, run
nonce, exit code, interruption, and source fingerprints before and after.
PowerShell reports its real exit code; background/unknown completion cannot
establish a successful proof. Shell command text alone does not count as an
edit: the turn ledger compares workspace contents, including partial writes
from failed commands, so `ls` is not a mutation and a Python/shell write is.

`ur spec verify` and the kernel spec verifier use the same proof evaluator and
persistence path. Compile/test/lint/diff/runtime citations must name an exact
executed command in backticks or `execution:<tool-use-id>`, succeed in this run
and cwd, and match the final source state. A runner error, fabricated prose,
foreign run, failed command or source mutation cannot produce PASS. The model
continues to choose the verification commands and engineering strategy; these
checks qualify the result rather than imposing an execution approval gate.

Schema-2 records store source and command digests plus execution references.
Loading an old prose-only PASS migrates it to unverifiable PARTIAL; changed
source makes a saved PASS stale/PARTIAL. Readiness inspection performs the same
assessment without rewriting legacy records. The state covers Git-visible
source contents/modes/index/HEAD and explicit spec/verify inputs, not arbitrary
outside files or external services. Concurrent writers and the semantic
appropriateness of commands still require review; this is runtime evidence,
not cryptographic attestation of a trusted custom runner.

Regression coverage: `test/executionVerification.test.ts`,
`test/specVerify.test.ts`, `test/kernel.test.ts`, `test/verifier.test.ts`.

## Provider-neutral tool discovery

Large tool catalogs can now use the existing `ToolSearch` on every native UR
provider. Portable results are ordinary text JSON with a versioned
`ur.tool-discovery/1` envelope and complete selected schemas. The next model
request includes those schemas in its normal tool array; no unsupported
`tool_reference`, `defer_loading`, or beta headers are sent to native providers.
The model chooses which tools to discover and invoke. Discovery changes prompt
visibility only; tool calls still pass through the existing registry and its
permission checks, including explicitly denied tools.

Native default is automatic sizing: defer eligible tool schemas once their
estimated size exceeds 10% of model context. `ENABLE_TOOL_SEARCH=true` enables
portable discovery explicitly, `false` sends all schemas, and `auto:N` selects a
percentage. `alwaysLoad` tools stay available. Selected names persist through
conversation history and compaction; removed tools are not reintroduced.
Malformed/failed discovery output does not add names. Small catalogs can remain
inline to avoid an unnecessary discovery turn.

`test/portableToolDiscovery.test.ts` measures a 100-tool fixture: selected schema
characters versus all schema characters, preserved schemas and permissions,
compaction carryover and ordinary text wire format. This is a prompt-payload
regression measurement, not a measured LLM task-success improvement.
