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
| `Bash` | Run shell commands; supports background tasks, sandboxing, safety checks (`src/tools/BashTool/bashSecurity.ts`); commands with unterminated quotes are rejected pre-execution with an actionable diagnostic (errorCode 11, heredoc guidance) | `command`, `timeout`, `run_in_background`, sandbox overrides | "Run the test suite" |
| `PowerShell` | Windows PowerShell variant (Windows plus `UR_CODE_USE_POWERSHELL_TOOL=1` in the external build) | same shape as Bash | — |

## Web & network tools

| Tool | Purpose | Key inputs | Example request |
|---|---|---|---|
| `WebFetch` | Fetch a public HTTP(S) URL → markdown → analyze with a small model; DNS and every redirect are checked against private/reserved addresses | `url`, `prompt` | "Summarize this blog post: https://…" |
| `Computer` | Desktop control: screenshot (read-only), click, type. Clicks are bounds-checked against real screen geometry and state-changing actions always ask. macOS/Linux only | action-specific coordinates, text, or output path | "Take a screenshot of the desktop" |
| `WebSearch` | Provider-side web search. The current runtime gate exposes it for every non-Ollama provider (`getAPIProvider() === 'foundry'`) and hides it on the default Ollama backend; actual server-tool support still depends on the selected provider/model | `query`, optional `allowed_domains` or `blocked_domains` (mutually exclusive) | "Search for the fastify v5 migration guide" |
| `Api` | Direct public HTTP(S) calls with JSON extraction; private targets, unsafe redirects, oversized responses, GET bodies, and silent sensitive-header sends are rejected/confirmed | `url`, `method`, `headers`, `body`, `timeout` (≤300s), `extract` (dotted path) | "Call GET https://api.github.com/repos/x/y and give me .stargazers_count" |
| `Browser` | Guarded public-URL fetch plus a persistent Playwright session for goto/click/type/screenshot/evaluate. Requires `UR_BROWSER_TOOL=1` or `WEB_BROWSER_TOOL=1`; `fetch` needs no browser process, while interactive actions require the externalized `playwright-core` dependency and an installed Chromium/Chrome executable | `url`, `action`, `selector`, `text`, `expression` | "Open the public staging UI, click Login, screenshot the result" |

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
| `TaskCreate` / `TaskGet` / `TaskUpdate` / `TaskList` | Structured task list v2 (dependencies, atomic claims/statuses/numeric ordering) — replaces TodoWrite when the todo-v2 runtime gate is enabled | "Track these five subtasks" |
| `EnterPlanMode` / `ExitPlanMode` | Enter/leave plan mode; plan approval flow | "Plan first, then implement" |
| `AskUserQuestion` | Multiple-choice questions to the user | (agent asks when blocked on a decision) |
| `TaskOutput` / `TaskStop` | Read output of / stop a background task | "Kill the dev server you started" |
| `EnterWorktree` / `ExitWorktree` | Move the session into/out of an isolated git worktree (worktree mode) | "Do this in a scratch worktree" |
| `SendUserMessage` | KAIROS/KAIROS_BRIEF build-only mid-turn brief; not present in the standard npm build | — |

Task tracking and plan mode are separate state machines. Creating an ordered
`TaskCreate`/`TodoWrite` list does not enter plan mode; `ExitPlanMode` is valid
only after `EnterPlanMode` (or `/plan`) has successfully made the active mode
`plan`. Plan approval may change that mode before permission-edited input is
revalidated; the executor labels that second validation as post-permission so
the already-validated exit can finish, while new out-of-mode calls still fail.
`ExitPlanMode` is exempt from the implementation task-list gate because it is
the approval/control transition that precedes implementation. Its own plan-mode
validation remains authoritative, so the exemption does not make a stale
second exit valid.

For non-trivial work, the task list uses one record per cohesive outcome with
an observable done check rather than one omnibus record. Genuine single-outcome
work remains one task; files, commands, and tiny mechanical steps are not
artificial task boundaries. Dependency edges represent only real ordering
constraints. Mutually independent tasks with no conflicting shared mutations
can be delegated together, while dependent or conflicting work stays
sequential.

Task IDs remain strings in storage and tool output. Model inputs for
`TaskCreate` dependencies and `TaskGet`/`TaskUpdate` identifiers may also use a
positive safe-integer JSON number; the tool boundary normalizes it to the
canonical decimal string. Zero, negative, fractional, non-finite, Boolean, and
precision-losing numeric IDs are rejected.

Task-gate recovery names the tracking surface that is actually present:
interactive Task V2 sessions use `TaskCreate`, while default headless sessions
use `TodoWrite`. It never instructs a model to recover by calling a tool absent
from that runtime. Runtime inspection tracks actionable and total user tasks
separately: an all-terminal list is reported truthfully and the model is told
to reopen or create the cohesive remaining task. Real Edit/Bash mutations stay
gated. One simple `open <loopback-http(s)-URL>` Bash preview is exempt only
from the task-list gate; remote/file URLs, flags, shell composition, expansion,
redirection, backgrounding, sandbox overrides, and permission-time rewrites to
mutating commands fail closed. The preview command remains a Bash side effect
and still follows normal permission, sandbox, and plan-worker rules.

Syntax verification has the same task-gate-only separation. A strictly parsed
`node --check <single-file>` or the bounded HTML checker that reads one file,
constructs but never invokes its first `<script>` body, and prints only a fixed
syntax result may run after a task-free one-shot Write. Generic `node -e`,
additional statements or invocation, mismatched files, flags, redirects,
expansion, backgrounding, sandbox overrides, and permission-time rewrites do
not qualify. Node remains non-read-only for Bash permission and sandbox
purposes, so this compatibility path cannot become a general execution bypass.

Task completion also protects that lifecycle boundary. When the final
actionable `in_progress` task has a successful `Write`/`Edit`/`MultiEdit`/
`NotebookEdit` after its recorded start but no later successful inspection,
runtime, test, shell, or delegated-check result, `TaskUpdate(completed)` is
soft-deferred: it returns a non-error explanation and leaves the same task
`in_progress`. The model verifies and retries completion instead of creating a
duplicate task or discovering an all-terminal dead end on the next corrective
Edit. The guard is evidence-based and conservative: missing/compacted history,
non-file work, and intermediate tasks are not guessed into a deferred state.

Live plan mode also treats setup of the exact current session plan artifact as
planning infrastructure rather than implementation. `Write` creates the plan
file's parent automatically, but weak models may first emit `mkdir -p` for that
exact parent or the bounded `ls ... || mkdir -p ... && ls ...` check. Only those
exact-path shapes bypass the task-list requirement; Bash permission and sandbox
checks still apply, and a hook rewrite, sibling path, extra command, expansion,
background launch, or sandbox override fails closed at the final boundary.

`AskUserQuestion` exposes a request-only model schema: one top-level
`questions` array with 1–4 complete question objects, each containing
`question`, a header of at most 12 characters, and 2–8 labeled choices.
Descriptions are optional and are never fabricated from labels. The runtime
accepts only lossless compatibility forms such as string choices and recognized
question-text aliases; it does not turn arbitrary prose or flat option rows into
invented questions. More than four blocking decisions are asked in later
rounds. The sole presentation-only repair compacts a safe explicit header of at
most 500 characters to one bounded first-word chip when it exceeds 12
characters. The question, options, labels, descriptions, previews, metadata,
and selection mode remain byte-for-byte unchanged. Control/ANSI-bearing or
grossly oversized headers still fail validation.

One narrow end-turn recovery exists for weak models that clearly attempted this
tool but failed to emit a native call. On an interactive main-agent turn with
no existing tool use, the runtime may recover either one canonical
`questions` object at the very end of a reasoning block that explicitly says
to invoke `AskUserQuestion`, or one standalone Markdown decision menu with
exactly one bold question, 2–8 bold labeled options with descriptions, and a
terminal instruction to select an option. The recovered object must pass the
live `AskUserQuestion` schema unchanged except for that same deterministic
UI-header compaction before the normal tool executor opens the UI. JSON repair,
question/choice truncation, duplicate/ambiguous candidates, casual “A or B?”
prose, examples, incomplete menus, background workers, headless sessions, and
unavailable/disabled tools all fail closed.

Answers and annotations are not model input fields. They are accepted only
during post-permission validation after the interactive UI has returned one
non-empty answer for every question; an unchanged generic approval cannot
produce a successful “user answered” result. The UI uses prototype-safe records,
provides a real custom `Other` path for both ordinary and preview questions,
and does not count selecting `Other` itself as an answer. HTML-configured
previews are escaped into an inert preformatted-text wrapper rather than
executed as model-provided markup.

## Multi-agent tools

The table below separates the ordinary Agent/Skill tools from coordination
tools that require an explicit runtime/build gate. Internal overlay modules
that export `null` are compile-time placeholders, are never added to the tool
pool, and are not supported user-facing tools.

| Tool | Purpose | Example request |
|---|---|---|
| `Agent` | Spawn a subagent (built-in types: `general-purpose`, `Explore`, `Plan`, `verification`, `statusline-setup`, `ur-code-guide`, plus user agents from `/agents` and `.ur/agents/`) | "Use a subagent to survey how errors are handled repo-wide" |
| `SendMessage` | Message another running agent/teammate; useful only while swarm mode is enabled | (agent coordination) |
| `TeamCreate` / `TeamDelete` | Create/remove agent teams (swarm mode, `isAgentSwarmsEnabled`) | "Spin up a team for this migration" |
| `Skill` | Invoke a skill programmatically (model-triggered skills) | "Use the dockerize skill" |

## Scheduling (nonstandard builds)

| Tool | Gate | Purpose |
|---|---|---|
| `CronCreate` / `CronDelete` / `CronList` | AGENT_TRIGGERS | Local scheduled jobs (used by `/loop`, `/automation`) |
| `RemoteTrigger` | AGENT_TRIGGERS_REMOTE | Manage scheduled remote agents via API |
| `Sleep` | PROACTIVE/KAIROS overlay | The public-source overlay currently exports `null`; do not treat the environment name as a usable tool |

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
| `REPL` | internal overlay | The public-source overlay currently exports `null`; `UR_CODE_REPL` alone cannot enable it |
| `StructuredOutput` | synthetic | Enforces structured output schemas in headless runs |

`ListPeers`, `Workflow`, `Monitor`, `PushNotification`, `SendUserFile`,
`SubscribePR`, `Tungsten`, `SuggestBackgroundPR`, `CtxInspect`,
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

`Write` requires `file_path` and the complete literal `content` in the same
structured call. Prose outside the call is never treated as file content, and a
missing-content failure states that no file was written instead of fabricating
the intended file.

`Edit` remains fail-closed rather than applying a fuzzy replacement to similar
code. When an exact contiguous `old_string` is absent, its bounded error points
to the most distinctive verified matching line when one exists, rather than an
unrelated generic delimiter, and tells the model to re-read that region, use a
smaller current 2–4-line anchor, split distant HTML/CSS/JavaScript sections, and
never retry the unchanged call. One narrow idempotent case returns success
without writing: a non-`replace_all` deletion-only edit whose `new_string` is
already present uniquely and whose larger `old_string` is absent. General
stale, fuzzy, empty-replacement, and ambiguous matches still fail.
