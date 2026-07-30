# 11 — Integrations

Source of truth: `src/services/mcp/`, `src/entrypoints/{mcp,mcp2026,agUi}.ts`,
`src/services/agents/{acpStdio,acpServer,a2aProtocol,a2aServer,agUi}.ts`,
`src/services/agents/ideConfig.ts`, `extensions/{vscode-ur-inline-diffs,jetbrains-ur}/`,
`src/tools/BrowserTool/BrowserTool.ts`, `src/commands/{browser,browser-qa,chrome,desktop,voice}/`,
and `scripts/bundle.mjs`.

Availability terms used here:

- **Shipped** — present in the normal external npm build.
- **Conditional** — shipped, but hidden or inactive until its documented platform,
  authentication, setting, dependency, or environment condition is satisfied.
- **Source-only** — implemented behind a Bun build feature that
  `scripts/bundle.mjs` does not enable for the normal external build. Source
  presence alone does not make that command available to npm users.

## MCP client

UR can consume MCP servers over `stdio`, SSE, streamable HTTP, and WebSocket.
The `mcp add` CLI supports `stdio`, `sse`, and `http`; WebSocket entries can be
loaded from a validated settings/config object.

Configuration can come from the `mcpServers` setting, project `.mcp.json`, or
one or more `--mcp-config` JSON files/strings. `--strict-mcp-config` ignores the
ordinary user/project MCP sources, but managed enterprise policy still applies.

```text
ur mcp add fs -- npx -y @modelcontextprotocol/server-filesystem /tmp
ur mcp add --transport http sentry https://mcp.sentry.dev/mcp
ur mcp add --transport http corridor https://app.corridor.dev/api/mcp \
  --header "Authorization: Bearer …"
ur mcp add-json db '{"command":"pg-mcp","args":["--dsn","…"]}'
ur mcp list
ur mcp get fs
ur mcp remove fs
ur mcp add-from-ur-desktop
ur mcp reset-project-choices
/mcp
```

Runtime behavior:

- Tool names use `mcp__<server>__<tool>`. Resources use
  `ListMcpResources`/`ReadMcpResource`; server prompts may be registered as
  slash commands.
- `allowedMcpServers`, `deniedMcpServers`, managed MCP policy, per-project
  approval, and session enable/disable state filter which servers can connect.
- HTTP/SSE OAuth state is handled by `src/services/mcp/auth.ts`. `--client-secret`
  prompts for a secret, while `MCP_CLIENT_SECRET` supplies it non-interactively.
  XAA commands are registered only when the XAA runtime gate is enabled.
- Environment expansion and header-helper execution are supported by
  `envExpansion.ts` and `headersHelper.ts`; those helpers do not bypass normal
  MCP policy.

## UR server surfaces

| Surface | Availability and start command | Actual contract |
|---|---|---|
| MCP stdio | Shipped: `ur mcp serve` | Lists enabled built-in UR tools only. Input is schema-validated, normal permissions are rechecked, calls are bounded, and any operation needing an unavailable interactive approval fails closed. |
| MCP 2026 HTTP | Shipped: `ur mcp serve-http` | Bun HTTP `/mcp` adapter with negotiated Tasks/Apps metadata. Loopback may run without a token; an off-loopback bind requires `UR_MCP_HTTP_TOKEN`. `--allow-origin` entries are exact HTTP(S) origins. |
| ACP stdio | Shipped: `ur acp stdio` | Official-SDK-backed ACP v1 agent with persisted ACP sessions, new/load/list/delete/resume/close, prompt streaming, modes/config updates, MCP input, cancellation, and native `session/request_permission` requests. |
| UR HTTP JSON-RPC | Shipped: `ur acp serve` | UR-specific JSON-RPC at `/acp`; it is not the ACP wire protocol. Supports UR sessions, direct tool calls, and task methods. Off-loopback requires `--token` or `UR_ACP_TOKEN`. |
| A2A | Shipped: `ur a2a serve` | Negotiated A2A v1 routes, stable v0.3 JSON-RPC at `/a2a/jsonrpc`, and separate UR compatibility task routes. Off-loopback requires a static token or delegation secret. |
| AG-UI | Shipped: `ur ag-ui serve` | HTTP/SSE `/ag-ui` adapter with `/ag-ui/capabilities`. Loopback is the default; off-loopback requires `UR_AG_UI_TOKEN`. Browser origins are exact allow-list entries. |
| Direct-connect session server | Source-only (`DIRECT_CONNECT`) | `ur server` and `ur open` are not in the normal external bundle. |
| Remote-control bridge | Source-only (`BRIDGE_MODE`) | `ur remote-control`/`rc` and the bridge fast paths are not in the normal external bundle. |
| SSH remote runner | Source-only (`SSH_REMOTE`) | `ur ssh` is not in the normal external bundle. |

The stdio MCP limits are
`UR_MCP_MAX_CALLS_PER_MINUTE`, `UR_MCP_MAX_CONCURRENT_CALLS`,
`UR_MCP_TOOL_TIMEOUT_MS`, `UR_MCP_MAX_INPUT_CHARS`, and
`UR_MCP_MAX_OUTPUT_CHARS`. The HTTP adapter has request/rate/concurrency limits
under `UR_MCP_HTTP_*` and uses `UR_MCP_TOOL_TIMEOUT_MS` for underlying tool
calls.

The network agent adapters also enforce bounded requests and work:

- UR HTTP JSON-RPC uses `UR_ACP_*`.
- A2A uses `UR_A2A_*`; compatibility-route `skipPermissions` additionally
  requires the static server token or a delegation token scoped to
  `permissions:bypass`. The standard A2A protocol runner uses `dontAsk`, so an
  unavailable interactive approval is denied.
- AG-UI uses `UR_AG_UI_*`, disables session persistence for adapter runs,
  denies permission requests because it advertises no approval UI, and aborts
  the child run when the stream is cancelled.
- ACP stdio is the exception: it relays UR permission decisions to the ACP
  client's native request-permission channel and denies on cancellation/client
  failure.

## IDE integration

`ur ide status|doctor|config` reports integration state. `/ide` provides the
interactive connection UI and inline-diff commands:

```text
/ide diff capture
/ide diff list
/ide diff show <id>
```

The shipped editor paths are deliberately different:

- The VS Code extension in `extensions/vscode-ur-inline-diffs/` spawns
  `ur -p --output-format stream-json --verbose --permission-prompt-tool stdio`
  for chat turns. It does **not** use ACP stdio.
- The experimental JetBrains plugin uses the loopback, UR-specific HTTP
  `/acp` JSON-RPC service (`ur acp serve`), not ACP stdio.
- Editors with their own ACP client can launch `ur acp stdio`; this is a
  supported generic ACP surface, but it is not the transport used by the two
  bundled plugins above.
- `--ide` auto-connects to the legacy detected-IDE channel when exactly one
  valid IDE is detected. LSP diagnostics are a separate integration under
  `src/services/lsp/`.

## Browser surfaces

These three surfaces are not interchangeable:

1. `/browser <url|task>` is a **shipped advisory command**. It detects a
   workspace Playwright installation and tells the user/model which path is
   available; it does not navigate, click, type, or take a screenshot itself.
2. The `Browser` model tool is **conditional** on `UR_BROWSER_TOOL=1` or
   `WEB_BROWSER_TOOL=1`. Its `fetch` action uses bounded plain HTTP. Interactive
   `goto`, `click`, `type`, `evaluate`, and `screenshot` actions dynamically
   require `playwright-core` plus an installed Chromium-compatible browser.
   Every action asks through the normal permission engine.
3. `/chrome` is an interactive settings/onboarding UI for the Chrome extension
   and its MCP/native-host bridge. It is unavailable in print/offline mode and
   the current UI requires a UR subscription. `--chrome` and `--no-chrome`
   select the integration for a session.

`/browser-qa` validates `.ur/browser-qa/*.json` fixtures. Its `run` action is a
five-second HTTP fetch smoke test that reports status/body size; it does not
launch Playwright, evaluate fixture assertions, or replay browser interactions.

## GitHub, Slack, desktop, and voice

- The `GitHub` tool, `/pr-comments`, `/review`, and `--from-pr` cover GitHub
  workflows. `/trigger` parses GitHub/Slack webhook JSON and can explicitly
  launch a headless `ur -p` run; it is not a resident webhook listener.
- `/install-slack-app` only opens the Slack Marketplace installation page and
  records the click locally.
- `/desktop` (alias `/app`) is registered only on macOS or x64 Windows. On
  those supported platforms it flushes the current transcript and hands the
  session to an installed compatible UR Desktop app; if the app is missing or
  outdated, it offers the matching platform download.
- `/session` (alias `/remote`) is visible only when the current runtime is
  already in remote mode. It displays the existing remote-session URL; it does
  not create a remote session. `/remote-env` additionally requires a
  subscription, the `allow_remote_sessions` policy, and network access.
- `/voice` is shipped because the external bundle enables `VOICE_MODE`, but is
  conditional on the GrowthBook kill switch, a valid UR OAuth login, microphone
  access, a recording utility, and interactive mode. It toggles streaming voice
  input. `/speak` is a separate local OS text-to-speech command and does not
  require voice input.
- `/buddy` is source-only because the normal bundle does not enable `BUDDY`.
