# UR Professional IDE Integration — Architecture & Implementation Plan

Status: **planning only** — no code in this document has been implemented. No runtime
provider code, package version, or `dist/cli.js` was touched while producing it.

Goal: make UR's VS Code experience match the bar set by Codex, Claude Code, Copilot, and
Cursor, by **extending what already exists** rather than inventing a parallel system.
The single biggest finding of this pass: UR already has most of the hard protocol work
done (headless NDJSON streaming, a permission control-protocol, an IDE-as-MCP client, a
diff-bundle store, a curated capability/trend dataset). The bundled VS Code extension
just doesn't use any of it yet — it only does file-polling and one CLI status call.

---

## 1. Current repo surfaces found

### 1.1 `extensions/vscode-ur-inline-diffs/` — the shipped extension today

Four files: `package.json`, `extension.js`, `README.md`, `media/ur.svg`. What it actually
does, read from source:

- Activity Bar container `ur` → one TreeView, `urInlineDiffs`. No webview chat, no
  session list, no status card, no command palette search.
- Reads `.ur/ide/diffs/manifest.json` (+ per-bundle patch/metadata JSON) from the
  workspace root. **No `FileSystemWatcher`** — the tree only updates on manual refresh.
- "Apply" runs `git apply --whitespace=nowarn <patch>` **directly**, bypassing the CLI's
  own `ur ide diff approve` command, then hand-writes `status: 'applied'` — a value that
  does not exist in the CLI's `IdeDiffStatus` type (see 1.4). This is a real, present bug
  (vocabulary drift between extension and CLI), not hypothetical.
- "Comment" writes directly to the bundle JSON files itself, again bypassing the CLI's
  `ur ide diff comment` command.
- "Status" shells out once to `execFile('ur', ['ide', 'status'])` and dumps stdout into
  an Output Channel. One-shot, not polled, not structured.
- The one read-only webview (`enableScripts: false`) only renders a single diff's patch
  text as static HTML.

Packaging: the extension is not committed as a `.vsix`; `createBundledVSCodeExtensionVsix()`
(`src/utils/ide.ts`) zips it at install/build time, and its `package.json` version is
**asserted equal to the root package version** by `test/agentFeatureCommands.test.ts`.
There is no independent extension release cadence today.

### 1.2 `src/commands/ide/` — the CLI side of "ide"

- `index.ts` — command registry: `open | status | doctor | config <editor> | diff *`.
- `ide.tsx` (~1,600 lines after JSX compilation) — `ur ide` / `ur ide open`: detects
  running IDEs, offers to install the bundled extension, and (for the default/no-args
  path) drives a connect flow through the **existing IDE-as-MCP-client machinery**
  (`dynamicMcpConfig`, 35s connection timeout "slightly longer than the 30s MCP
  connection timeout") — this is the `/ide` terminal-connect flow, see 1.5.
- `ideInfoCommand.ts` — `status | doctor | config`, thin wrapper around `ideConfig.ts`.
  `collectIdeStatus()` returns workspace root, ACP server running/port, provider/model
  runtime info, plugin count, detected-IDE list, warnings.
- `inlineDiffCommand.ts` — `diff capture|list|show|comment|approve|reject|delete|schema`,
  a thin wrapper around `src/services/agents/ideDiffs.ts`.

### 1.3 ACP (`src/services/agents/acp*.ts`, `src/commands/acp/acp.tsx`)

Two distinct transports share the name "ACP":

- **Stdio ACP** (`ur acp stdio`) — the real, spec-compliant [Agent Client Protocol](https://agentclientprotocol.com)
  used by Zed and ACP-capable Neovim clients. Untouched by this plan.
- **HTTP JSON-RPC "ACP server"** (`ur acp serve`, `src/services/agents/acpServer.ts`,
  580 lines) — a UR-specific `Bun.serve()` endpoint at `POST /acp`, loopback-only unless
  `--token` is set. Methods: `initialize`, `session/new`, `session/prompt`,
  `session/cancel`, `tools/list`, `tools/call`, `tasks/send`, `tasks/get`,
  `tasks/cancel`, `ide/diffCapture`, `ide/select`, `shutdown`.

Read closely, `handleInitialize()` returns **`capabilities.streaming: false`**, and
`session/prompt` is a thin wrapper over `tasks/send`, which either:
  - runs `ur -p --output-format json <prompt>` as a **blocking subprocess** (up to a
    30-minute timeout) for `mode: 'sync'`, or
  - hands off to `backgroundRunner.ts` for `mode: 'async'`, polled via `tasks/get`.

There is no SSE/WebSocket transport anywhere in `acpServer.ts`. This server is not a
streaming chat transport today, and is not the right foundation for a live chat panel
without first adding a push/streaming layer to it — work this plan explicitly defers
(§6, §7).

### 1.4 Diff bundles (`src/services/agents/ideDiffs.ts`, 319 lines)

File-backed store at `.ur/ide/diffs/{manifest.json, patches/*.patch, metadata/*.json}`.
`IdeDiffStatus = 'pending' | 'commented' | 'approved' | 'rejected'`. `createIdeDiffBundle`
shells to `git diff` (or accepts a supplied diff), parses hunks/file stats, and persists.
This is the CLI-side source of truth the extension's TreeView reads — and the extension's
`'applied'` status (1.1) is not a value this type allows.

### 1.5 The IDE-as-MCP-client bridge (`src/utils/ide.ts`, 1,651 lines) — the important find

This file implements the **client** half of a lockfile-discovered MCP connection to a
running IDE: `getSortedIdeLockfiles`/`getIdeLockfilesPaths` (discovery), a lockfile shape
carrying `{ workspaceFolders, pid, ideName, transport: 'ws'|'sse', authToken }`,
`callIdeRpc()` (`src/services/mcp/client.ts`) for making RPC calls to a connected IDE, and
VSIX packaging/JetBrains-plugin detection helpers.

Grepping actual call sites shows the **verb set already wired on the CLI side**:
`openFile`, `getDiagnostics` (exposed to the model itself as the tool
`mcp__ide__getDiagnostics`), `openDiff` (`src/hooks/useDiffInIDE.ts` — opens a **native**
diff tab and resolves based on whether the user saved/closed/rejected it), `close_tab`,
`closeAllDiffTabs`, `set_permission_mode`. This is the same lockfile/MCP pattern used by
Claude Code's IDE integrations. **None of this is implemented on the extension side** —
`extensions/vscode-ur-inline-diffs/extension.js` never opens a socket and never writes a
lockfile. The CLI is ready for a much richer bridge than the shipped extension provides.

### 1.6 Supporting subsystems relevant to the new panels

| Surface | File(s) | What it gives the IDE work |
|---|---|---|
| Provider capability/status | `src/services/providers/providerRegistry.ts` | `ProviderCapabilities`, `ProviderRuntimeInfo`, `ProviderStatusSummary`, `ProviderDoctorResult` already model kind (`ur-native`/`subscription-cli`/`subscription-placeholder`), native tool-call/streaming support, safety boundary, auth mode/label, connection status — everything a provider/model switcher needs, pre-built. |
| Agent trends (curated, local) | `src/services/agents/trends.ts`, `src/commands/agent-trends/agent-trends.ts` | `ur agent-trends --json` returns a fully-built, versioned `AgentTrendReport`: per-topic `status: covered\|partial\|adapter-ready`, summary, evidence, references, `professionalNextStep`, an A2A Agent Card, and a priority roadmap. This **is** requirement #11 — already curated, already local, no scraping. It just has no UI surface. |
| Background/async agent tasks | `src/services/agents/backgroundRunner.ts` | `BackgroundTask`: id, status (`queued\|running\|completed\|failed\|canceled`), worktree, PR metadata, log/output/inbox files, mid-flight steering via `appendBackgroundFeedback`. This is the real "unified task visibility" data source. |
| General evidence store | `src/services/agents/artifacts.ts` | `Artifact`: kind (`plan\|diff\|test-run\|screenshot\|browser-recording\|note`), status (`pending\|approved\|rejected`), feedback. **Overlaps with `ideDiffs.ts` for the `diff` kind** — two parallel stores exist today (§6). |
| Verifier | `src/services/verifier/*` | Modes `off\|loose\|strict`, project gates, quality verdicts `HIGH\|MEDIUM\|LOW\|UNKNOWN` — status-card material. |
| Headless streaming contract | `src/cli/print.ts`, `src/sdk/index.ts` | `ur -p --output-format stream-json --verbose` emits NDJSON `SDKMessage`s; `--output-format stream-json` **requires** `--verbose` (enforced, errors otherwise). A `control_request`/`control_response` protocol (`can_use_tool`) already flows through this same stream for permission prompts (`--permission-prompt-tool stdio`). This is a fully-built, already-streaming primitive that the SDK (`ur-nexus/sdk`, `query`/`queryJSON`/`UrClient`) already builds on. |

### 1.7 `docs/IDE.md`

Honest, accurate as of today: three mechanisms (native extension / stdio ACP / manual),
a target support matrix, the `ur ide *` command list, and troubleshooting. Says the
bundled extension provides tree view + read-only preview + apply/reject/status — matches
source exactly. This plan will make that document under-sell what ships once implemented;
updating it is listed as a follow-up, not part of this pass (docs are out of scope here).

### 1.8 Tests

- `test/ideCommands.test.ts` — pure-function coverage of `ideConfig.ts` (config
  generation per target, status/doctor formatting, `runIdeInfoCommand` routing).
- `test/agentFeatureCommands.test.ts` — broader "agent feature" file; the IDE-relevant
  cases are diff-bundle capture/comment round-trip, the extension manifest exposing the
  expected commands, and VSIX packaging (zip contents, version lockstep with root
  `package.json`).
- `test/acpServer.test.ts` and `test/acpSessions.test.ts` — already cover the ACP HTTP
  surface directly: `/healthz`, `initialize` capabilities, `tools/list`, token
  authorization, `session/new` → `session/prompt` → task id, unknown-session error,
  `shutdown`, and `ide/diffCapture` + `ide/select`. This is real, existing coverage —
  the gap is not "ACP is untested," it's that **nothing on the extension side consumes
  ACP at all** (§2.1 explains why this plan doesn't route chat through it either).
- No test exercises the lockfile/MCP client path in `src/utils/ide.ts` end-to-end
  (`callIdeRpc` against a live IDE-side server), or, naturally, the extension's own logic
  beyond its manifest/VSIX packaging — that logic doesn't exist yet.

---

## 2. Recommended architecture

### 2.1 Core decision: three bridges, two of which already exist

A chat panel that lives *inside* the extension does not need the same bridge a
terminal-hosted CLI session needs to reach the IDE — the extension already has direct
access to VS Code's APIs. Conflating these is what would lead to reinventing IPC that
already exists elsewhere in this codebase. Recommendation: keep them distinct.

**Bridge A — chat/turn execution (new, but the contract is not new).**
The extension spawns UR as a child process per turn:

```
ur -p --output-format stream-json --verbose --permission-prompt-tool stdio \
   [--resume <sessionId>] [--model <id>] [--provider <id>] "<prompt>"
```

This is the exact contract `ur-nexus/sdk` and `acpServer.ts`'s `runSynchronousTask`
already use, just switched to `stream-json` (NDJSON on stdout, one `SDKMessage` per line)
instead of blocking on the whole run. `control_request` messages (`can_use_tool`) appear
in-stream for permission prompts; the extension answers by writing a `control_response`
line to the child's stdin. No new CLI protocol — the extension is a new *consumer* of an
existing one. Session continuity uses the CLI's existing `--resume <uuid>` support.

**Bridge B — file/selection/diagnostics context (new, and it should stay simple).**
Because the chat panel *is* the extension, it reads `vscode.window.activeTextEditor`,
`.selections`, and `vscode.languages.getDiagnostics(uri)` directly through the VS Code
extension API and folds that into the prompt as structured `IdeContext` (§2.4) before
spawning the child process. **No IPC, no lockfile, no MCP server needed for this** — that
machinery (§1.5) exists to let a *separate* terminal `ur` process reach a running IDE, a
genuinely different scenario (§2.1, Phase 2 below).

**Bridge C — status/history (reuse, unchanged pattern).**
One-shot CLI calls exactly like the current extension already makes for `ur ide status`:
`ur ide status --json`, `ur provider status --json` / `ur provider doctor --json`,
`ur agent-trends --json`, and the existing background-task listing. Polled on a light
interval plus manual refresh — the proven pattern, just automated and JSON-typed instead
of dumped to an Output Channel as text.

**Deferred bridge — the lockfile/MCP IDE server (§1.5's missing half).** Implementing the
*server* side (a lockfile-discoverable WS/SSE endpoint exposing `getDiagnostics`,
`openDiff`, `close_tab`, `set_permission_mode`, etc.) is real, valuable work — it's what
lets a `ur` session running in *any* terminal connect to the same VS Code window via
`/ide` for live diagnostics and native diff tabs, independent of whether the chat panel is
open. It complements Bridge A/B but is not required to ship a professional chat panel, so
it is Phase 2, not the MVP (§6, §7).

**ACP HTTP server (`acpServer.ts`).** Left alone. Zed/generic-ACP users are unaffected.
A later phase could have the extension optionally attach to a running `ur acp serve` for
cross-window task visibility instead of file polling, but only after that server gains a
real streaming transport — explicitly out of scope now.

### 2.2 Extension UI surfaces

1. **Activity Bar view** — keep the existing `ur` container/icon (continuity for current
   installs); add three views under it instead of one: Chat, Sessions, Actions. The
   existing Inline Diffs tree becomes a section of Actions rather than the only view.
2. **Chat webview** (`WebviewPanel`, scripts enabled — the current extension deliberately
   disables scripts for the diff preview; the chat view needs them). Renders streamed
   assistant text, tool-call/tool-result blocks, inline diff summaries with
   Apply/Reject/Comment buttons, and a `control_request` approval prompt when one arrives.
   Composer supports `@file` / `@file:12-40` mentions (Bridge B resolves them).
3. **Session list** (`WebviewView` or `TreeView` under Sessions) — one entry per
   `ChatSession` (§2.4), newest first, supports opening/renaming/archiving/deleting,
   multiple concurrent sessions (Claude-Code-style), backed by `sessionStore.ts` (§4).
4. **Agent identity/status card** (`WebviewView` under a header area of the Chat view, or
   its own small view) — provider + model + `providerKind` badge (native vs
   subscription-cli vs placeholder, using the existing safety-boundary label so users see
   *why* a subscription CLI provider can't take images, reusing existing provider-registry
   language rather than inventing new copy), sandbox mode, verifier mode, ACP
   running/port, plugin count, warnings — a direct render of `AgentStatus` (§2.4), itself
   assembled from `ur ide status --json` + `ur provider status --json`.
5. **Actions panel** (`TreeView`) — background tasks (`AgentAction`, §2.4, sourced from
   `ur bg list --json`) *and* diff bundles (`DiffArtifact`, §2.4, from `ur ide diff list
   --json`) in one place, mirroring Copilot's "unified task visibility" ask. Diff items
   keep Apply/Reject/Comment (now routed through the CLI commands instead of bypassing
   them, fixing the status-vocabulary bug in §1.1/§1.4).
6. **Inline diff view** — for diffs proposed *during* an active chat turn, prefer a
   **native** `vscode.diff` editor tab (`vscode.commands.executeCommand('vscode.diff', ...)`)
   opened directly by the extension when a tool-call result contains a file edit, so
   review happens in a real diff editor, not a static HTML preview. After
   accept/reject/comment, call `ur ide diff capture` / `approve` / `reject` / `comment`
   so the same bundle exists for anyone reviewing from the CLI or from a fresh VS Code
   window — one store, multiple front ends.
7. **Search/command quick-pick** (`QuickPick`) — a single palette entry point
   ("UR: Search Commands, Workflows, Specs, Skills, Providers") that lists local UR
   commands, workflows (`ur workflow list`), specs (`ur spec list`), skills
   (`ur skills list`), providers, and agent actions, filtered as the user types, each item
   running the corresponding CLI call or opening the relevant view. Backed by one-shot
   `--json` CLI calls per category, cached briefly and refreshed on open (Bridge C).

### 2.3 Backend bridge summary

| Concern | Mechanism | New or existing |
|---|---|---|
| Turn execution + streaming | `ur -p --output-format stream-json --verbose --permission-prompt-tool stdio`, spawned per turn | Existing contract, new consumer |
| Permission approval | in-stream `control_request`/`control_response` | Existing |
| Session resume | `--resume <sessionId>` | Existing |
| File/selection/diagnostics context | `vscode.window.activeTextEditor`, `vscode.languages.getDiagnostics` | New (native VS Code API, no IPC) |
| Diff capture/apply/comment | `ur ide diff capture\|approve\|reject\|comment`, native `vscode.diff` for review | Existing CLI, new native-tab rendering |
| Status/doctor | `ur ide status --json`, `ur provider status\|doctor --json` | Existing |
| Agent trends panel | `ur agent-trends --json` | Existing, no UI yet |
| Background task visibility | `ur bg list\|status <id>\|logs <id>\|kill <id>` (`src/commands/bg/bg.ts`, `backgroundRunner.ts`-backed) | Existing |
| Live IDE diagnostics/native-diff for *terminal* `ur` sessions | lockfile-discovered WS/SSE server implementing `openFile\|getDiagnostics\|openDiff\|close_tab\|set_permission_mode` | **Missing today** — Phase 2 |
| Cross-window task visibility | `ur acp serve` (`session/*`, `tasks/*`) | Existing, but non-streaming — Phase 3 at earliest |

### 2.4 Data models

TypeScript, extension-side, each annotated with the UR-side type/command it maps from so
there is exactly one source of truth per field, not a re-invented shape.

```ts
// 1:1 with a chat/turn thread, persisted client-side; id matches UR's --resume session id
type ChatSession = {
  id: string
  title: string                 // derived from first user message, editable
  workspaceRoot: string
  provider: string              // ProviderId active when the session started
  model?: string
  createdAt: string
  updatedAt: string
  messageIds: string[]          // ChatMessage[] stored separately, see sessionStore.ts (§4)
  archived?: boolean
}

// one SDKMessage-derived turn; content blocks mirror what stream-json already emits
type ChatMessage = {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system'
  content: ChatContentBlock[]   // text | tool_use | tool_result | diff_ref | control_request
  createdAt: string
  turnDurationMs?: number
  costUsd?: number
}
type ChatContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; ok: boolean; summary: string }
  | { type: 'diff_ref'; diffId: string }              // points at a DiffArtifact
  | { type: 'control_request'; id: string; toolName: string; resolved?: 'allow' | 'deny' }

// direct render target for the status card — assembled from ur ide status + provider status
type AgentStatus = {
  workspaceRoot: string
  acp: { running: boolean; port: number | null; host: string }   // IdeStatus.acp, unchanged
  provider: ProviderCapability
  sandboxMode: 'disabled' | 'recommended' | 'required'           // new field on IdeStatus, small addition
  verifierMode: 'off' | 'loose' | 'strict'                       // new field on IdeStatus, small addition
  pluginCount: number
  warnings: string[]
}

// 1:1 with ProviderRuntimeInfo / ProviderStatusSummary (providerRegistry.ts) — no new vocabulary
type ProviderCapability = {
  id: string
  displayName: string
  providerKind: 'ur-native' | 'subscription-cli' | 'subscription-placeholder'
  usesExternalCli: boolean
  supportsNativeToolCalls: boolean
  supportsNativeStreaming: boolean
  safetyBoundaryLabel: string
  connectionStatus: 'connected' | 'missing' | 'unavailable' | 'unknown'
  model?: string
}

// 1:1 with BackgroundTask (backgroundRunner.ts) — the Actions panel's task rows
type AgentAction = {
  id: string
  kind: 'chat-turn' | 'background-task' | 'workflow-step'
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled'
  summary: string
  logFile?: string
  worktree?: { enabled: boolean; path?: string; branch?: string }
  pr?: { enabled: boolean; created?: boolean }
  createdAt: string
  updatedAt: string
}

// assembled client-side from VS Code APIs (Bridge B) — not persisted, built per turn
type IdeContext = {
  activeFile?: { path: string; languageId: string }
  selection?: { path: string; startLine: number; endLine: number; text: string }
  mentions: Array<{ path: string; startLine?: number; endLine?: number }>  // @file:12-40
  diagnostics?: Array<{ path: string; line: number; severity: 'error' | 'warning' | 'info'; message: string }>
  openEditors?: string[]
}

// 1:1 with IdeDiffBundle (ideDiffs.ts) — reused verbatim, not reinvented
type DiffArtifact = {
  id: string
  title: string
  status: 'pending' | 'commented' | 'approved' | 'rejected'
  files: Array<{ path: string; additions: number; deletions: number }>
  patchFile: string
  comments: Array<{ at: string; file?: string; line?: number; text: string }>
  createdAt: string
  updatedAt: string
}
```

---

## 3. MVP feature list (first PR)

Deliberately narrow — everything here is achievable by consuming existing CLI contracts
plus native VS Code APIs, with no new server process for the extension to manage:

1. Chat webview: send a prompt, stream the response (Bridge A), render text and
   tool-call/tool-result blocks as they arrive.
2. `control_request` approval prompt in the chat webview with a per-session default
   (ask / allow reads / allow all — explicit, not silently permissive).
3. `@file` / `@file:12-40` mentions resolved from the workspace; current selection
   auto-attached as context when present (Bridge B).
4. Native diff tabs for proposed edits, with Apply/Reject/Comment routed through
   `ur ide diff capture|approve|reject|comment` (fixes the §1.1/§1.4 vocabulary bug as a
   side effect of doing this correctly).
5. Session list: multiple sessions, resume via `--resume`, simple JSON persistence
   (`sessionStore.ts`).
6. Agent identity/status card: provider, model, providerKind/safety-boundary label,
   sandbox mode, verifier mode, ACP running/port, plugin count, warnings.
7. Actions panel: existing diff-bundle tree (relabeled, bug-fixed) plus a background-task
   list rendered read-only (start/cancel actions can follow in a fast-follow, not MVP).
8. Command quick-pick: commands, workflows, specs, skills, providers — read-only search
   and invoke, backed by one-shot `--json` CLI calls.
9. Agent trends panel: a simple webview rendering `ur agent-trends --json` — coverage
   list, A2A card summary, priority roadmap. No scraping, no network calls beyond the
   local CLI invocation.
10. Editor actions via command palette: "UR: Explain Selection", "UR: Fix Selection",
    "UR: Generate Tests for Selection" — each just opens/reuses the chat panel with a
    pre-filled prompt and the current selection attached as context. No separate code
    path from the chat panel itself.

---

## 4. File-by-file implementation plan

Extension is recommended to move from a single untyped `extension.js` to a small
TypeScript source tree bundled by esbuild into one `out/extension.js` — matching the
quality bar of the competitors named in the brief, while keeping the shipped VSIX
single-bundle and dependency-free like today's.

```
extensions/vscode-ur-inline-diffs/
├── package.json                     MODIFY — add chat/session/status/actions views under
│                                     the existing "ur" activity bar container, new
│                                     commands (chat.open, chat.send, session.new,
│                                     session.switch, actions.refresh, quickpick.open,
│                                     editor.explain/fix/tests), esbuild devDependency.
│                                     Keep extension id/name unchanged (no migration break
│                                     for existing installs).
├── esbuild.js                       NEW — bundles src/**/*.ts to out/extension.js.
├── src/
│   ├── extension.ts                 NEW — activate()/deactivate(), wires all providers,
│                                     replaces today's extension.js top-level activate().
│   ├── bridge/
│   │   ├── urProcess.ts             NEW — spawns `ur -p --output-format stream-json
│   │                                 --verbose --permission-prompt-tool stdio`, NDJSON
│   │                                 line parser, control_request/response handling,
│   │                                 cancellation (child.kill on session/tab close).
│   │   ├── urCli.ts                 NEW — one-shot execFile wrapper for status/doctor/
│   │                                 trends/diff/workflow/spec/skill/provider --json
│   │                                 calls; supersedes the ad hoc execFileAsync calls in
│   │                                 today's extension.js.
│   │   └── types.ts                 NEW — ChatSession/ChatMessage/AgentStatus/
│   │                                 ProviderCapability/AgentAction/IdeContext/
│   │                                 DiffArtifact (§2.4).
│   ├── context/
│   │   └── ideContext.ts            NEW — builds IdeContext from
│   │                                 vscode.window.activeTextEditor + selections +
│   │                                 vscode.languages.getDiagnostics; resolves @mentions.
│   ├── sessions/
│   │   └── sessionStore.ts          NEW — persists ChatSession/ChatMessage to
│   │                                 .ur/ide/chat/sessions/*.json, mirroring the existing
│   │                                 file-store pattern in ideDiffs.ts (manifest +
│   │                                 per-item files) for consistency with the rest of the
│   │                                 codebase.
│   ├── views/
│   │   ├── chatPanel.ts             NEW — WebviewPanel, streaming render, tool-call/diff
│   │                                 blocks, control_request approval UI.
│   │   ├── sessionListProvider.ts   NEW — TreeDataProvider for the Sessions view.
│   │   ├── statusViewProvider.ts    NEW — WebviewView for the AgentStatus card.
│   │   ├── actionsViewProvider.ts   NEW — TreeDataProvider merging AgentAction +
│   │                                 DiffArtifact rows.
│   │   ├── diffTreeProvider.ts      MODIFY (ported from extension.js's DiffProvider) —
│   │                                 same TreeView, Apply/Reject now call `ur ide diff
│   │                                 approve|reject` instead of hand-writing status;
│   │                                 Apply still confirms before `git apply`.
│   │   └── trendsPanel.ts           NEW — WebviewPanel rendering `ur agent-trends --json`.
│   ├── quickpick/
│   │   └── commandPalette.ts        NEW — QuickPick aggregating commands/workflows/
│   │                                 specs/skills/providers/actions (§2.2 item 7).
│   └── media/                       chat.html/css/js, status.html/css/js — VS Code theme
│                                     CSS variables, same approach as today's
│                                     renderDiffHtml (§1.1).
├── media/ur.svg                     UNCHANGED
└── README.md                        MODIFY — document the new views/commands.
```

CLI-side changes (small, additive, backward compatible — no provider/runtime/sandbox
logic touched):

```
src/services/agents/ideConfig.ts        MODIFY — extend IdeStatus with sandboxMode and
                                         verifierMode fields (read from the existing
                                         sandbox-adapter and verifier settings; no new
                                         subsystem, just two more fields on an existing
                                         status object).
src/commands/ide/ideInfoCommand.ts      MODIFY — populate the two new fields in
                                         collectIdeStatus().
docs/IDE.md                             Not touched in this PR — flagged as required
                                         before announcing the new panels, tracked
                                         separately (docs are out of scope for this pass).
```

No changes anywhere under `src/services/api/**` (provider dispatch/streaming/multimodal),
no `dist/cli.js` edits, no package version bump — the extension only calls the CLI as a
black box through its existing, already-public contracts.

---

## 5. New tests required

Extension-side (new testing surface for this repo — today the extension has zero tests
of its own; only its manifest/VSIX packaging is checked from the CLI side):

- `src/bridge/urProcess.test.ts` — NDJSON line parser against canned stream-json
  fixtures; `control_request` → `control_response` round-trip against a fake child
  process (no real `ur` binary needed); partial-line/buffering edge cases.
- `src/context/ideContext.test.ts` — `IdeContext` assembly given a mocked editor/
  selection/diagnostics state; `@file:12-40` mention parsing and resolution.
- `src/sessions/sessionStore.test.ts` — create/list/append/archive round-trip against a
  temp directory, mirroring the existing `ideDiffs.ts` file-store test conventions.
- `src/bridge/urCli.test.ts` — command construction for each `--json` call (status,
  doctor, trends, diff, workflow, spec, skill, provider) given a stubbed `execFile`.

Keep these as pure-logic unit tests runnable without a VS Code host (vitest or a
lightweight runner). Full `@vscode/test-electron` integration tests (real webview
rendering, real tree views) are explicitly Phase 2 (§7) — they're valuable but slow and
should not gate the first PR.

CLI-side (bun test, existing suite):

- `test/ideCommands.test.ts` — extend for the new `sandboxMode`/`verifierMode` fields on
  `IdeStatus` (pure function, same pattern as existing cases).
- `test/agentFeatureCommands.test.ts` — extend the manifest assertions to cover the new
  commands/views (`chat.open`, `session.new`, etc.) and keep the VSIX packaging/version-
  lockstep assertions passing against the larger `package.json`.
- New regression test asserting the diff-apply path calls `ur ide diff approve <id>`
  (spy on the CLI invocation) rather than writing an out-of-vocabulary status — this is
  the test that would have caught the §1.1/§1.4 bug, and should exist before the fix
  ships, not after.
- A test that a spawned chat-turn subprocess inherits sandbox/safety enforcement — i.e.
  that the IDE bridge does not add a second, less-restricted entry point into the agent.
  This is a security property and belongs in the suite, not just in review notes.

---

## 6. Risks and constraints

1. **ACP HTTP server has no streaming today** (`capabilities.streaming: false`,
   confirmed in `acpServer.ts`). The MVP sidesteps this by using direct `stream-json`
   subprocess spawning instead of routing chat through `ur acp serve`. If a later phase
   unifies onto ACP for cross-window sessions, streaming must be added there first —
   that is new backend work, not a rename.
2. **Two parallel evidence stores exist** — `ideDiffs.ts` (diff-only, `pending|
   commented|approved|rejected`) and `artifacts.ts` (general, `pending|approved|
   rejected` + feedback, includes a `diff` kind). This plan standardizes the new
   Inline Diff view on `ideDiffs.ts` (already wired to the extension) and uses
   `artifacts.ts` only for the broader Actions/evidence timeline, not diffs. Unifying
   the two stores is real cleanup work, deliberately not attempted here (§7).
3. **Known status-vocabulary bug**: today's extension writes `status: 'applied'`, not a
   value `IdeDiffStatus` allows. Any touch to the apply path must route through
   `ur ide diff approve` instead of hand-writing status — called out explicitly so it
   isn't silently carried forward into the rewrite.
4. **No JetBrains plugin exists in this repository.** `docs/IDE.md` and `ideConfig.ts`
   describe one ("manual install"), but nothing under `src/` or elsewhere in this repo
   implements it. This plan is VS Code-only; JetBrains parity is a separate, larger,
   unscoped effort and must not be implied by this work.
5. **`--output-format stream-json` requires `--verbose`**, enforced by the CLI (it
   errors otherwise). The bridge must always pass both together.
6. **Permission handling is safety-critical, not just UX.** The extension becomes
   responsible for correctly rendering and answering `control_request` prompts. A
   default-to-ask posture is required; anything that could silently auto-approve or
   silently hang needs explicit tests (§5), not just manual QA.
7. **Version lockstep**: the extension's `package.json` version already must equal the
   root `package.json` version (enforced by `test/agentFeatureCommands.test.ts`). The
   new work doesn't change this constraint, but touches a much larger manifest, so this
   assertion needs to keep passing, not be loosened.
8. **The `/ide` terminal-connect flow is a separate, currently half-built feature**
   (CLI client exists, extension server does not, §1.5). It must not be confused with, or
   accidentally broken by, the new chat-panel-owns-subprocess architecture — they are
   different entry points that happen to share the same CLI.
9. **No runtime provider code is touched.** The bridge treats `ur` as a black box and
   only consumes its already-public NDJSON/CLI contracts — this plan does not, and should
   not, need to modify `src/services/api/**`, streaming, multimodal mapping, or the
   subscription-CLI provider boundary.

---

## 7. Out-of-scope list (explicitly not building yet)

- JetBrains plugin (no existing code to build on; separate ecosystem/tooling).
- The lockfile/MCP IDE-server side of `src/utils/ide.ts` (live diagnostics/native-diff
  for *terminal* `ur` sessions) — real Phase 2 work, not required for the chat panel MVP.
- Adding a streaming transport to `ur acp serve` / routing chat through it.
- Unifying `ideDiffs.ts` and `artifacts.ts` into one evidence store.
- Multi-user/real-time-collaborative chat sessions.
- Voice or image/video input inside the chat webview (multimodal UX is provider-
  dependent and already flagged `partial` in `ur agent-trends`; don't build UI for it
  until that's more solid).
- Remote/SSH/Codespaces-specific transport work beyond what the VS Code extension host
  already provides for free.
- New telemetry/analytics beyond the existing `logEvent` calls.
- Custom keybinding schemes beyond standard command palette registration.
- Any change to provider dispatch, streaming, multimodal mapping, sandbox enforcement,
  or package version — excluded by this task's own instructions, and not needed for any
  item in this plan.

---

## 8. Exact next implementation prompt

Paste this to start the first implementation PR once this plan is approved:

> You are working on my full production TypeScript/Bun agent repository. Task:
> implement the MVP professional VS Code chat panel per
> `IDE_INTEGRATION_ARCHITECTURE.md` §3 (MVP feature list), §4 (file-by-file plan), §5
> (tests). Context: `extensions/vscode-ur-inline-diffs` currently only has a file-polling
> diff tree (`extension.js`); this PR adds a chat webview, session list, status card,
> actions panel, and command quick-pick, bridged through `ur -p --output-format
> stream-json --verbose --permission-prompt-tool stdio` (spawned per turn) plus native VS
> Code APIs for file/selection/diagnostics context — no new server process, no ACP
> streaming work, no lockfile/MCP server (that's Phase 2, out of scope here).
> Scope: `extensions/vscode-ur-inline-diffs/**` (convert to a small TypeScript source
> tree bundled by esbuild into `out/extension.js`, keep the extension id/name and
> Activity Bar container id unchanged), `src/services/agents/ideConfig.ts` and
> `src/commands/ide/ideInfoCommand.ts` (add `sandboxMode`/`verifierMode` fields to
> `IdeStatus` only), `test/ideCommands.test.ts`, `test/agentFeatureCommands.test.ts`, and
> new extension-side unit tests under `extensions/vscode-ur-inline-diffs/src/**/*.test.ts`.
> Do not touch `src/services/api/**`, `src/services/agents/acpServer.ts`,
> `src/utils/ide.ts`'s lockfile/MCP machinery, `src/services/agents/artifacts.ts`,
> `docs/IDE.md`, package version, or `dist/cli.js`. Fix the existing status-vocabulary
> bug (extension writes `'applied'`, not a value `IdeDiffStatus` allows) by routing
> Apply/Reject through `ur ide diff approve|reject` instead of hand-writing status —
> add the regression test from §5 that proves this. Acceptance criteria: `bun run
> typecheck` passes; `bun test test/ideCommands.test.ts test/agentFeatureCommands.test.ts`
> passes; the new extension unit tests pass under `npm run test` inside the extension
> directory; `npm pack --dry-run --ignore-scripts` at the repo root still succeeds and the
> VSIX still builds via `createBundledVSCodeExtensionVsix()`; manual smoke test: open a
> workspace, send a chat message, see streamed output, propose an edit, see a native diff
> tab, approve it, see the bundle show up via `ur ide diff list`. Report: files
> changed, exact behavior added, tests added, tests run, and anything from §3 you could
> not complete plus why.
