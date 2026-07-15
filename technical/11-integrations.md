# 11 — Integrations

Source of truth: `src/services/mcp/`, `src/services/agents/{acpStdio,acpServer,a2aProtocol,a2aServer,agUi}.ts`,
`extensions/{vscode-ur-inline-diffs,jetbrains-ur}/`, `src/utils/urInChrome/`, `src/bridge/`,
`src/commands/{mcp,ide,acp,a2a-card,chrome,browser,install-github-app,install-slack-app,bridge,desktop,voice}`.

## MCP (Model Context Protocol) — UR as a client

Transports: `stdio`, `sse`, `http` (streamable), `ws` (`src/services/mcp/{client,config}.ts`).
Config sources: settings `mcpServers`, project `.mcp.json`, `--mcp-config` files/strings
(`--strict-mcp-config` to use only those), UR Desktop import.

```
ur mcp add fs -- npx -y @modelcontextprotocol/server-filesystem /tmp   # stdio
ur mcp add --transport http sentry https://mcp.sentry.dev/mcp
ur mcp add --transport http corridor https://app.corridor.dev/api/mcp --header "Authorization: Bearer …"
ur mcp add-json db '{"command":"pg-mcp","args":["--dsn","…"]}'
ur mcp list · ur mcp get fs · ur mcp remove fs
ur mcp add-from-ur-desktop
ur mcp reset-project-choices        # re-prompt for .mcp.json approvals
/mcp                                 # in-session UI: status, enable/disable, auth
```
- OAuth-protected servers: `src/services/mcp/auth.ts` + `McpAuthTool`; `--client-secret`
  or `MCP_CLIENT_SECRET` for the client secret; XAA IdP settings (`xaaIdp`).
  For non-interactive XAA login, pipe the token to
  `ur mcp xaa login --id-token-stdin`; the bounded stdin path avoids exposing
  the token through shell history or process arguments.
- Tools appear as `mcp__<server>__<tool>`; resources via `ListMcpResourcesTool` /
  `ReadMcpResourceTool`; prompts become slash commands; MCP skills gate `MCP_SKILLS`.
- Permission control: `allowedMcpServers` / `deniedMcpServers` settings,
  `mcp__server` deny rules strip a whole server, `enableAllProjectMcpServers`.
- Env expansion in server configs (`envExpansion.ts`); header helpers for auth
  (`headersHelper.ts`); official registry lookup (`officialRegistry.ts`).

## UR as a server

| Surface | Start | Protocol |
|---|---|---|
| MCP server | `ur mcp serve` | exposes UR tools over MCP (stdio) |
| MCP 2026 HTTP | `UR_MCP_HTTP_TOKEN=… ur mcp serve-http` | opt-in stateless `/mcp` adapter with negotiated Tasks and Apps |
| ACP stdio agent | `ur acp stdio` | Stable ACP v1 via the official SDK: durable list/load/delete/resume/close, exact replay, modes, config, commands, permissions, MCP, streaming |
| UR HTTP agent API | `UR_ACP_TOKEN=… ur acp serve`; `/acp` | UR-specific HTTP JSON-RPC for scripts, tools/tasks, and the experimental JetBrains plugin; not an ACP binding |
| A2A server | `UR_A2A_TOKEN=… ur a2a serve --port 8765` | negotiated strict v1 JSON-RPC/HTTP+JSON, stable-SDK v0.3 at `/a2a/jsonrpc`, and separate UR compatibility routes under `/a2a/tasks` |
| AG-UI adapter | `UR_AG_UI_TOKEN=… ur ag-ui serve --host 0.0.0.0` | official-schema HTTP/SSE at `/ag-ui` with truthful discovery at `/ag-ui/capabilities` |
| HTTP session server | `ur server --port … --auth-token …` | direct-connect sessions (`src/server/`), unix-socket option, idle timeouts, max sessions |
| Remote control bridge | `ur remote-control` (`rc`) or `/remote-control` | pairs this machine with mobile/web clients (`src/bridge/`); org policy `allow_remote_control` gates it |

`ur mcp serve` exposes built-in tools only. Every call is schema-validated,
rechecked by the normal permission engine, and executed without an interactive
approval channel; operations that need approval therefore fail closed. The
stdio adapter bounds calls, concurrency, runtime, and protocol payload sizes.
Operators can tune those bounds with `UR_MCP_MAX_CALLS_PER_MINUTE`,
`UR_MCP_MAX_CONCURRENT_CALLS`, `UR_MCP_TOOL_TIMEOUT_MS`,
`UR_MCP_MAX_INPUT_CHARS`, and `UR_MCP_MAX_OUTPUT_CHARS`.

`ur mcp serve-http` requires matching protocol/method/name request metadata,
uses the real UR MCP registry, and applies bearer auth, exact CORS origins,
owner-isolated durable tasks, rate/concurrency/runtime limits, private atomic
persistence, and corrupt-state quarantine. Its limits use `UR_MCP_HTTP_*`.

`ur ag-ui serve` binds to loopback by default and requires `UR_AG_UI_TOKEN`
off-loopback. Browser origins are exact allow-list entries. Adapter runs are
isolated and non-persistent, disconnects cancel execution, approval-requiring
operations fail closed, and request/rate/concurrency/runtime/output limits use
`UR_AG_UI_*`. See `docs/AG_UI.md` for the complete supported contract.

The UR HTTP API and A2A surfaces apply request, prompt, task, output, and tool
limits through the `UR_ACP_*` and `UR_A2A_*` environment variables. Delegated
A2A protocol and compatibility tasks are isolated by token subject, tenant,
and skill;
bypassing permissions on the compatibility route also requires the static
operator token or the explicit `permissions:bypass` scope. The official A2A
runner uses fail-closed `dontAsk` permissions because the network binding has
no interactive approval channel. The stdio ACP runner instead bridges UR tool
decisions to the client's native `session/request_permission` UI and fails
closed on cancellation or client errors.

## IDE integration

- `/ide` — connect/status/doctor, per-editor config, inline diff bundles
  (`/ide diff capture`, `diff list`, `diff show <id>`; `src/services/agents/ideDiffs.ts`).
- `--ide` flag auto-connects at startup when exactly one IDE is detected.
- VS Code extension shipped in `extensions/vscode-ur-inline-diffs/` (inline diffs, actions
  tree, background actions bridge over the ur CLI).
- Experimental JetBrains plugin shipped in `extensions/jetbrains-ur/`. It uses
  the loopback UR HTTP `/acp` JSON-RPC methods (`initialize`, `session/new`,
  `session/prompt`) and keeps HTTP work off the IDE event thread.
- ACP stdio mode (`ur acp stdio`) is the transport used by editor plugins;
  LSP-powered diagnostics come from `src/services/lsp/`.

## Browser control

Three tiers:
1. **`Browser` tool / `/browser`** — Playwright when installed (goto/click/type/
   screenshot/evaluate/fetch): `/browser https://localhost:3000 "log in and screenshot"`.
2. **UR in Chrome** — `/chrome` settings UI, `--chrome`/`--no-chrome`, extension talks over
   a native host (`ur --chrome-native-host`) and MCP server (`ur --ur-in-chrome-mcp`);
   auto-registers the `ur-in-chrome` bundled skill when configured.
3. **`/browser-qa`** — validate and replay browser QA fixtures: `/browser-qa run login-flow`.

## GitHub & Slack

- `/install-github-app` — set up UR GitHub Actions for the repo.
- `GitHub` tool (PRs/issues/search, doc 04); `/pr-comments`, `/review`; `--from-pr` resume.
- `/install-slack-app` — Slack app install.
- `/trigger` — consume GitHub/Slack webhook payloads headlessly (doc 10).

## Remote & desktop

- `/desktop` (alias `/app`) — continue session in UR Desktop.
- `/session` (alias `/remote`) — QR/URL for the current remote session.
- `/remote-env` — default environment for teleport sessions; `/web-setup` (gated) for web.
- `ur ssh <host> [dir]` — run against a remote machine over SSH (`src/ssh/`);
  `sshConfigs` setting stores named targets.
- `ur open <cc-url>` — deep-link handler (`disableDeepLinkRegistration` to opt out).

## Voice & niceties

- `/voice` toggles voice input (feature `VOICE_MODE`, `voiceEnabled` setting, `src/voice/`).
- `/buddy` companion sprite (BUDDY gate); `/think-back` year in review.
