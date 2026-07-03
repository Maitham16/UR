# UR Inline Diffs for VS Code

The professional UR IDE integration for VS Code, Cursor, and Windsurf: chat,
inline diff review, an actions panel, an agent status card, a searchable
command palette, a provider/model picker, and an agent options panel — all
backed by the `ur` CLI already on your machine.

UR-AGENT packages this extension from the repository as a local VSIX when the
CLI installs the public IDE integration. It does not depend on an unpublished
marketplace extension ID.

The extension never talks to a model provider or network service directly —
every AI request goes through your local `ur` CLI, the same way `ur` behaves
in a terminal. Everything below requires the UR CLI on your `PATH`.

## Chat

The UR Activity Bar contains a **Chat** view with visible buttons for **New
Chat**, **Open Chat**, **Pick Model**, and editor-context actions when a file
or selection is active. You do not need to know command palette commands to
start a conversation.

**UR: New Chat** / **UR: Open Chat** open a chat panel that streams UR's
response as it's generated, over the same NDJSON `stream-json` contract the
CLI uses for scripted runs. Tool calls, tool results, and permission prompts
(`control_request`/`control_response`) render inline as they arrive; nothing
is buffered and shown only at the end, and a failed run shows an error
banner rather than a fabricated success message.

Each chat is a session persisted under `.ur/ide/chat/` in the workspace, so
sessions survive closing and reopening VS Code and can be resumed (via the
CLI's own `--resume`) from **UR: Open Chat**.

**UR: Add Current File to Chat** and **UR: Add Selection to Chat** attach
context explicitly — nothing is sent to UR until you take one of those
actions or send a message. **UR: Explain Selection**, **UR: Fix Selection**,
and **UR: Generate Tests for Selection** (also on the editor right-click
menu) open the same chat panel with a structured prompt built from the
current selection; they are not a separate code path from chat.

**UR: Pick Model** opens a provider-first picker, then a model picker scoped to
that provider. Saving the choice goes through the same provider/model
validation as `/model`.

## Inline diffs and actions panel

Create a bundle from the UR CLI:

```sh
ur ide diff capture --title "Parser fix"
```

The **Inline Diffs** view lists bundles from `.ur/ide/diffs/manifest.json`.
A second view, **Actions**, shows the same diff bundles alongside background
tasks (`ur bg list`) in one place. Supported actions on a diff bundle:

- refresh the bundle list;
- open a patch preview with metadata and comments;
- **Apply** — asks for confirmation, runs `git apply`, then records the
  approval through `ur ide diff approve` (never a status value the CLI
  doesn't recognize);
- **Reject**, via `ur ide diff reject`;
- add a comment that writes back through `ur ide diff comment`.

Background task rows in the Actions panel are read-only for now — click one
to open its log file.

## Status and options

**UR: Agent Status** shows UR version, workspace root, provider, model,
provider kind, native tool-call/streaming support, multimodal support,
sandbox mode, verifier mode, ACP status, plugin count, and warnings, built
from `ur ide status --json` and `ur provider status --json`. Anything the
CLI doesn't report shows as **unknown**, not a guess.

**UR: Agent Options** shows recommendations for privacy, speed, multimodal,
tool calling, native streaming, subscription CLI access, local/offline use,
complex refactors, and docs/review, built from `ur provider list --json`
plus a small local, curated table. It is not live market research and does
not rank model quality; it labels each provider's kind (UR-native,
subscription CLI, local, or API) and uses **unknown** wherever a capability
isn't known rather than guessing.

## Search

**UR: Search Actions** is one searchable palette for every stable action the
extension exposes — chat, selection actions, diff review, the verifier, and
the status/options panels — instead of hunting through the command palette.

## Review and verify

**UR: Review Current Diff** reads your current `git diff`, confirms before
sending anything large, and opens chat with a structured review prompt.

**UR: Run Verifier** opens chat and asks UR to run its verification subagent
and report a verdict; there is no standalone verifier CLI command today, so
this always goes through chat, and a failed run is always shown as a
failure, never a false success.
