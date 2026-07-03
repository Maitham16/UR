# IDE Integration

UR's professional IDE integration is the **UR Inline Diffs** VS Code extension,
bundled in this repository (`extensions/vscode-ur-inline-diffs`). It gives VS
Code, Cursor, and Windsurf a chat panel, inline diff review, an actions panel,
an agent status card, a searchable command palette, and an agent options
panel — all driven by the same `ur` CLI you already use from a terminal, with
no separate server process and no new network surface.

Other editors connect through different mechanisms, chosen per editor and
stated honestly — nothing here claims support that does not exist:

- **VS Code extension** — the professional integration described in full
  below. Ships to VS Code, Cursor, and Windsurf (one extension; Cursor and
  Windsurf are VS Code forks). This is the integration everything else on
  this page is compared against.
- **Stdio ACP** (`ur acp stdio`) — the real, spec-compliant
  [Agent Client Protocol](ACP.md) over stdio, used by Zed and ACP-capable
  Neovim clients. This remains a separate transport from the VS Code
  extension's chat bridge below; the two are independent and neither depends
  on the other.
- **Manual** — no auto-config; install a plugin and connect via `/ide`.
  **JetBrains is not implemented in this repository.** UR can detect whether
  a plugin named `ur-jetbrains-plugin` is installed
  (`src/utils/jetbrains.ts`), but this repo does not build, ship, or publish
  that plugin. Nothing in this document should be read as "install our
  JetBrains plugin today" — there isn't one yet.

## Supported targets

| Editor | Mechanism | Auto config | Notes |
| --- | --- | --- | --- |
| VS Code | UR Inline Diffs extension | `.vscode/settings.json` | Full chat, diff, actions, status, and search integration — see below. |
| Cursor | UR Inline Diffs extension (VS Code fork) | `.vscode/settings.json` | Same extension as VS Code. |
| Windsurf | UR Inline Diffs extension (VS Code fork) | `.vscode/settings.json` | Same extension as VS Code. |
| Zed | stdio ACP | `.zed/settings.json` | Real Agent Client Protocol over stdio. |
| JetBrains | not implemented | none | Detection code exists; no plugin ships from this repo. Use the CLI directly in the meantime. |
| Neovim | stdio ACP | snippet | Requires a third-party ACP client plugin. |
| Generic ACP | stdio ACP / HTTP | snippet | `ur acp stdio` (native ACP) or `ur acp serve` (HTTP JSON-RPC; not a streaming transport — see Known limitations). |

## Commands

```sh
ur ide status               # workspace, ACP server, provider/model, sandbox/verifier mode, plugin count, warnings
ur ide doctor                # pass/warn/fail checks; reports missing config clearly
ur ide config <editor>       # print setup + config snippet for the chosen editor
ur ide open                  # open the current project/worktree in a detected IDE
ur ide diff capture          # capture the current diff as a review bundle
ur ide diff list|show <id>   # inspect captured bundles
ur ide diff approve|reject <id>
```

`ur ide config` targets: `vscode`, `cursor`, `windsurf`, `zed`, `jetbrains`,
`neovim`, `generic-acp` (aliases like `nvim`, `intellij`, `code` also resolve).

`ur ide status` reports the active workspace, whether the ACP server is
running and on which port, the active provider/model and runtime backend,
sandbox mode, verifier mode, the number of loaded plugins, and any warnings.
Add `--json` for machine-readable output — this is the same JSON surface the
VS Code extension's status card and actions panel read from.

## Patch / diff workflow

UR never writes to your files silently. Proposed changes are captured as bundles
under `.ur/ide/diffs/` (`ur ide diff capture`), then previewed and explicitly
applied or rejected:

- **CLI:** `ur ide diff show <id>`, `ur ide diff approve <id>`, `ur ide diff reject <id>`.
- **VS Code:** the **Inline Diffs** view (and the **Actions** view — they show
  the same bundles) lists bundles; right-click one to Open (preview), Apply,
  Reject, or Comment. Apply asks for confirmation, runs `git apply`, then
  records the approval through `ur ide diff approve` — the same command the
  terminal workflow uses, so the status VS Code shows always matches what
  `ur ide diff list` reports. The extension never writes a diff status value
  the CLI does not recognize.

## VS Code extension

The bundled **UR Inline Diffs** extension is the professional IDE integration
for VS Code, Cursor, and Windsurf. It adds a UR container to the Activity Bar
with three views, **Chat**, **Inline Diffs**, and **Actions**, plus a chat
panel, a status card, an agent options panel, a provider/model picker, and a
searchable command palette.

Install it with `ur ide install` (offers the bundled VSIX) or from the
packaged `.vsix`. The extension is bundled inside this repository and
packaged as a local VSIX when installed from UR-AGENT; the public install
path does not depend on an unpublished marketplace extension ID. Every
feature below requires the UR CLI on your `PATH` — the extension calls `ur`
as a local subprocess and never talks to a model provider or network service
directly.

### Chat panel

**UR: New Chat** and **UR: Open Chat** open a chat panel that streams
responses over the same headless contract the CLI itself uses for scripted
runs:

```
ur -p --output-format stream-json --verbose --permission-prompt-tool stdio [--resume <id>] "<prompt>"
```

Output is NDJSON — one JSON object per line. Assistant text and tool-use/
tool-result blocks render as they arrive; nothing is buffered and dumped only
at the end. If the underlying `ur` process exits with an error, the panel
shows an error banner — it never fabricates a success message when the run
failed.

The **Chat** view in the UR sidebar exposes **New Chat**, **Open Chat**,
**Search Actions**, **Pick Model**, and editor-context actions when an editor
or selection is available. **UR: Pick Model** uses the provider-first model
catalog from the CLI and saves the selected provider/model pair through the
same validation path as `/model`.

**Permission prompts.** When a turn wants to use a tool that needs approval,
UR emits a `control_request` message in the same stream. The chat panel shows
an inline Allow/Deny prompt and writes the decision back as a
`control_response` on the child process's stdin. The default posture is to
ask, not to silently auto-approve; canceling a request denies it safely
rather than leaving it hanging.

**Session persistence.** Each chat is a session persisted under
`.ur/ide/chat/` in the workspace (a manifest plus one file per session).
**UR: Open Chat** can resume a previous session — using the CLI's own
`--resume` — or start a new one; sessions survive closing and reopening VS
Code.

**File and selection context.** **UR: Add Current File to Chat** and
**UR: Add Selection to Chat** attach the active file or selection as explicit
context. Nothing is sent to UR until one of these actions is taken or a
message is sent — the extension never silently uploads file content in the
background.

**Editor actions.** **UR: Explain Selection**, **UR: Fix Selection**, and
**UR: Generate Tests for Selection** (also on the editor right-click menu)
open the same chat panel with a structured prompt built from the current
selection. There is no separate backend path for these — they reuse the chat
pathway above.

### Actions panel

The **Actions** view lists diff bundles from `.ur/ide/diffs/` and background
tasks (`ur bg list --json`) together in one place, with its own refresh
button and a clear empty state when there is nothing captured yet. Diff rows
support the same Open/Apply/Reject/Comment actions as the Inline Diffs view
(routed through the CLI, as described above). Background task rows are
read-only in this release — click one to open its log file; starting or
canceling a task from the panel is not implemented yet, use
`ur bg run|kill` from a terminal.

### Agent status card

**UR: Agent Status** opens a panel assembled from `ur ide status --json` and
`ur provider status --json`: UR version, workspace root, provider, model,
provider kind (UR-native, subscription CLI, or subscription placeholder),
native tool-call support, native streaming support, multimodal support, the
active provider's safety-boundary description, sandbox mode, verifier mode,
ACP status, plugin count, and warnings, with a refresh button. Any field the
CLI does not report renders as the literal word **unknown** — never a guess.

### Search actions

**UR: Search Actions** is a single searchable palette covering every stable
action the extension exposes: New Chat, Open Chat, Explain Selection, Fix
Selection, Generate Tests, Review Current Diff, Run Verifier, Provider
Status, Agent Status, Agent Options, Open Settings, Open Docs, Open
Artifacts, Run Spec, Run Workflow, and Refresh IDE Actions.

### Agent options panel

**UR: Agent Options** shows recommendations for privacy, speed, multimodal
support, tool calling, native streaming, subscription CLI access, local/
offline use, complex refactors, and docs/review work. **This panel is built
from local, curated data and the UR CLI's own provider registry
(`ur provider list --json`) only — it is not live market research and does
not rank model quality.** Every provider is labeled by kind (UR-native,
subscription CLI, local, or API), and a capability renders as **unknown**
rather than a guess whenever the CLI does not expose it — for example,
multimodal support for local/self-hosted models, which depends on whichever
model happens to be loaded rather than being a fixed provider fact.

### Review Current Diff and Run Verifier

**UR: Review Current Diff** reads the current `git diff` directly through a
safe subprocess call (no shell interpolation), asks for confirmation before
sending a large diff, then opens chat with a structured review prompt — the
diff is never sent without that explicit action.

**UR: Run Verifier** opens chat and asks UR to run its real verification
subagent (the same mechanism behind the `/verify` prompt command) and report
a verdict. There is no standalone `ur verify` CLI command today, so this
always goes through chat rather than a direct CLI call; if the underlying
`ur` process fails, the panel shows the failure clearly and never reports a
success it did not observe.

## Known limitations

- **JetBrains is not implemented.** No JetBrains plugin ships from this
  repository; see "Supported targets" above.
- **The lockfile/MCP IDE bridge is Phase 2 and not part of this MVP.** The
  CLI already implements the *client* half of a lockfile-discovered MCP
  connection to a running IDE (`src/utils/ide.ts`), used by the terminal
  `/ide` connect flow for live diagnostics and native diff tabs from a
  terminal-hosted `ur` session. The VS Code extension's chat panel does not
  use this bridge — it talks to UR entirely through the `stream-json`
  subprocess contract described above.
- **The ACP HTTP server (`ur acp serve`) is not the VS Code chat streaming
  transport.** It is a separate, non-streaming JSON-RPC endpoint intended for
  scripts and other clients; the VS Code extension does not route chat
  through it, and `ur acp stdio` (used by Zed and ACP Neovim clients) is
  unaffected by any of the VS Code work described here.
- **Background task actions are read-only** in the Actions panel — no start
  or cancel from the panel yet.
- **Run Spec / Run Workflow** open chat with a prompt asking UR to list and
  run the relevant items, rather than shelling out directly — `ur spec` and
  `ur workflow` are full agentic commands, not one-shot JSON lookups.

## Troubleshooting

- **`ur ide status` shows "ACP server: not running":** start it with
  `ur acp serve` (HTTP) or `ur acp stdio` (for ACP editors).
- **No IDE detected:** ensure the editor is running with the UR extension/plugin
  installed, or generate config with `ur ide config <editor>`.
- **Zed doesn't see UR:** confirm `.zed/settings.json` contains the
  `agent_servers.UR` block from `ur ide config zed`, then reload Zed.
- **Apply fails in VS Code:** the patch may not match the current tree; re-capture
  with `ur ide diff capture`.
- **Chat panel shows an error banner:** the underlying `ur` process failed or
  exited non-zero; check that the UR CLI is on your `PATH` and that a
  provider/model is configured (`ur provider status`).
