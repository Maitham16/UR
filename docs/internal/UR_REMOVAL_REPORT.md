# UR 1.5.0 — Vendor Removal Report

Date: 2026-06-19
Scope: remove vendor (Anthropic/Claude/OpenAI/Copilot) endpoints, auth, telemetry, and network calls from live code; keep the agent buildable and functional (plugin marketplace, internet/search/browser tools, local plugins, commands, docs, examples, tests preserved).

`tsc --noEmit` after all changes below: **0 errors** over 2,116 files.

---

## 1. Fully eliminated (0 matches in code)

### `api.anthropic.com` / `anthropic.com` host — 0 occurrences in live code
Every endpoint was removed or repointed. Files changed:

- `src/components/Feedback.tsx` — removed the POST to `api.anthropic.com/api/claude_cli_feedback`; `submitFeedback` no longer uploads to any vendor service (feedback upload removed).
- `src/components/FeedbackSurvey/submitTranscriptShare.ts` — removed the POST to `api.anthropic.com/api/ur_shared_session_transcripts` (transcript share to vendor removed).
- `src/services/mcp/officialRegistry.ts` — removed the GET to `api.anthropic.com/mcp-registry/...`; `prefetchOfficialMcpUrls` is now a no-op. The local plugin marketplace (`.ur-plugin/`, `marketplace-plugins/`) is unaffected.
- `src/services/api/metricsOptOut.ts` — removed the GET to `api.anthropic.com/api/ur/organizations/metrics_enabled`; returns disabled with no network (telemetry).
- `src/services/analytics/growthbook.ts` — removed `api.anthropic.com` GrowthBook base URL and the `ANTHROPIC_BASE_URL`-host attribute helper.
- `src/services/analytics/firstPartyEventLoggingExporter.ts` — removed the `api.anthropic.com` / `api-staging.anthropic.com` event-logging endpoint.
- `src/services/api/filesApi.ts` — removed the `api.anthropic.com` default base URL and the `ANTHROPIC_BASE_URL` read.
- `src/tools/WebFetchTool/utils.ts` — removed the `api.anthropic.com/api/web/domain_info` preflight call; the web tool no longer phones a vendor to vet domains (web/browser tool preserved).
- `src/constants/oauth.ts` — emptied all OAuth endpoint URLs (`api.anthropic.com`, `platform.claude.com`, `claude.ai`, `mcp-proxy.anthropic.com`), the staging config, the FedStart allowlist, and `MCP_CLIENT_METADATA_URL` (Claude/Anthropic auth removed).
- `src/upstreamproxy/upstreamproxy.ts` — removed the `*.anthropic.com` NO_PROXY entries and the `api.anthropic.com` proxy base URL.
- `src/remote/SessionsWebSocket.ts`, `src/services/voiceStreamSTT.ts` — their live URLs derive from the now-empty OAuth `BASE_API_URL`, so they no longer target a vendor host; comments updated.
- `src/services/api/errors.ts`, `src/services/api/errorUtils.ts`, `src/utils/http.ts`, `src/utils/preflightChecks.tsx`, `src/components/grove/Grove.tsx`, `src/utils/attribution.ts`, `src/utils/user.ts`, `src/utils/proxy.ts`, `src/utils/api.ts`, `src/types/command.ts`, `src/tools/BriefTool/upload.ts` — replaced `anthropic.com` URLs/User-Agent/legal-links/SSL-hint/commit-author/error text with UR-neutral or local-Ollama wording.

### Old loading/symbol components — 0
`AnimatedAsterisk`, `AnimatedClawd`, `Clawd` components: removed (prior pass). `clawd_body`/`clawd_background` theme tokens renamed to `ur_logo_body`/`ur_logo_background`. **`clawd` now has 0 matches in `src/`.**

### Welcome-screen mascot → UR house
`src/components/LogoV2/WelcomeV2.tsx` previously drew the purple Claude mascot (block-art creature) plus floating `*` decorations across several compiled theme-variant fragments. The entire `WelcomeV2` component (and the now-dead `AppleTerminalWelcomeV2`) was replaced with a clean **UR house** render (square body + triangle roof) in the `ur` theme color, titled "Welcome to UR" with the version and the "the autonomous agent" tagline. No mascot block-art or stray asterisks remain in the file. (The `kimi-k2.7-code:cloud · UR Agent` model line seen in a screenshot comes from a previously-installed global `ur` / saved user config — UR-1.5.0 has no `:cloud` default; reinstall from this folder to pick up the change.)

### Telemetry / hidden network — disabled at the source
- `src/services/analytics/firstPartyEventLogger.ts` — `is1PEventLoggingEnabled()` returns `false` (disables 1P event logging + GrowthBook).
- `src/utils/telemetry/bigqueryExporter.ts` — endpoint emptied; `doExport` no-ops.
- OTLP/beta-tracing remain env-gated off by default.

### Vendor auth env reads — removed
- `src/utils/auth.ts` — `getAnthropicApiKeyWithSource` no longer reads `process.env.ANTHROPIC_API_KEY` (the env-key branches were removed; `apiKeyEnv` is always undefined). No Anthropic API key is ever read or used for model calls.
- `src/components/Onboarding.tsx`, `src/components/Settings/Config.tsx`, `src/interactiveHelpers.tsx`, `src/cli/handlers/auth.ts`, `src/services/api/errors.ts` — direct `process.env.ANTHROPIC_API_KEY` reads removed.

### User-facing "Claude" branding strings → "UR"
Including the reported `/hooks` screens (`SelectHookMode`, `SelectMatcherMode`, `SelectEventMode`, `HooksConfigMenu`, `ViewHookMode`: "ask Claude" → "ask UR"), plus `errors.ts`, `thinkback`, `voice`/`useVoice`/`ConfigTool` ("Claude.ai account" → "UR account"), `install`, `remote-setup`, `TeleportError`, `teleport*`, `RemoteAgentTask`, `validatePlugin`, `FallbackToolUseErrorMessage`, `urCodeGuideAgent`, `statuslineSetup`, `statusNoticeDefinitions` ("claude /logout" → "ur /logout"), `desktopDeepLink` (`/Applications/Claude.app` → `/Applications/UR.app`), and the `--bare` help in `main.tsx`. **Standalone user-facing "Claude" word: 0** (excluding the `CLAUDE.md` memory-file feature and `@anthropic-ai/*` import paths).

### Other zeros
`AnimatedAsterisk`, `AnimatedClawd`, `CLAUDE_API_KEY`, `OPENAI_API_KEY`, `--ollama-url`, `kimi…:cloud`, `:cloud` — all **0** in code.

`OLLAMA_HOST` / `OLLAMA_BASE_URL` — **no live `process.env` reads remain**. The only matches are (a) the locked local constant name `OLLAMA_BASE_URL = 'http://localhost:11434'`, and (b) `test/ollamaModels.test.ts`, which deliberately sets those env vars to assert they are ignored.

---

## 2. Model backend — confirmed local Ollama only

- Execution: `src/services/api/ollama.ts` → `POST ${getOllamaBaseUrl()}/api/chat`.
- Model list: `src/utils/model/ollamaModels.ts` → `GET ${getOllamaBaseUrl()}/api/tags`.
- `getOllamaBaseUrl()` returns the fixed constant `http://localhost:11434` in both modules (no env override).
- `getAPIProvider()` is hardcoded to `'ollama'`, so the Bedrock/Vertex/Foundry/firstParty execution paths are unreachable.
- Endpoint base: **`http://localhost:11434/api`**. No API key is sent. No `:cloud` / Ollama Cloud.

---

## 3. Remaining matches — irreducible without a from-scratch rewrite (which the task forbids)

The following terms still appear in code. Each is here because removing it would either break the build, delete preserved functionality, or require rewriting the agent from scratch — all explicitly prohibited ("Do not rebuild the project from scratch", "Do not create a smaller replacement agent", "Do not remove working features", "Do not create placeholders/dummy exports"). Counts are post-cleanup.

### `anthropic` (906) and `claude` (1127) — core SDK protocol + compat
- **`@anthropic-ai/sdk` type imports in 123 files.** This codebase's entire message/streaming contract is the Anthropic Messages API shape (`BetaMessage`, `BetaMessageStreamParams`, `BetaStopReason`, `APIError`, etc.). **The Ollama transport itself (`ollama.ts`) converts to/from these types.** Removing them means replacing the message-type system across 123 files — a ground-up rewrite. The types are a local/compile-time contract; they are not a network backend.
- **`CLAUDE.md` / `CLAUDE.local.md`** — UR actively loads these as project-memory files (24 references in `agentmd.ts`). This is a working compatibility feature, intentionally kept.
- Identifier/discriminator names and dead-path strings (e.g. `claudeai.ts`, `ApiKeySource = 'ANTHROPIC_API_KEY'`, `CLAUDEAI_SUCCESS_URL`, `'claude-ai'` availability tag). Renaming cascades across the auth/command type system; the underlying endpoints/auth are already neutralized (Section 1).

### `ANTHROPIC_API_KEY` (39) — no live env reads remain
Remaining occurrences are: (a) the `ApiKeySource` type discriminator and dead `source:` return values, (b) **security redaction/allowlists** in `managedEnvConstants.ts`, `subprocessEnv.ts`, `bashPermissions.ts`, `powershellPermissions.ts` that list `ANTHROPIC_API_KEY` as a secret to redact/strip — these are protective and should stay, (c) comments, and (d) the now-unreachable `ApproveApiKey.tsx` label. None read the env var for model execution.

### `opus` (559), `sonnet` (393), `haiku` (276) — model registry data
These are entries in the model-config/allowlist/cost/capability tables (`modelOptions.ts`, `model.ts`, `configs.ts`, `modelStrings.ts`, `modelAllowlist.ts`, `modelCost.ts`, etc.), referenced by `getModelConfig`/`getModelStrings` across the app. They are **data**, not a backend — execution is Ollama regardless (Section 2). Deleting the registry breaks model selection, capability gating, and the build. Trimming it to nothing is a model-system rewrite.

### `cursor` (1563) — terminal text cursor
Cursor position/shape/blink/movement in the REPL/editor/ink renderer. Not the Cursor IDE. Irreducible; removing it would delete the terminal UI.

### `openai` (1), `copilot` (6) — reading *other tools'* config (features, not backends)
`init.ts` and a classifier note reference `.github/copilot-instructions.md`, `.cursorrules`, and "code imports `openai`" — these support importing existing project config. No OpenAI/Copilot model backend exists or is called.

### `asterisk` (5) — shell glob comments
Comments in `shellRuleMatching.ts` describing the `*` wildcard. Unrelated to the loading symbol.

---

## 4. Honest status vs. the literal scan

The instruction "only matches allowed are inside the report files" is **not** literally achievable for `anthropic`/`claude`/`cursor`/`opus`/`sonnet`/`haiku`/`ANTHROPIC_API_KEY` without rewriting the agent from scratch, because those terms are the Anthropic-SDK message protocol (123 files, used by the Ollama transport), the model registry data, the terminal text cursor, and protective secret-redaction lists — all of which the task also requires be kept working and not rebuilt.

What **is** fully achieved and verified:
- `api.anthropic.com` / `anthropic.com` in code: **0**.
- Vendor endpoints (feedback, transcript, oauth, proxy, files, MCP registry, web domain-info): **removed/neutralized**.
- Telemetry / hidden network calls: **disabled at source**.
- Vendor auth env reads: **removed**.
- Old symbol components / `clawd`: **0**.
- User-facing "Claude" branding: **0** (excluding `CLAUDE.md` feature).
- Model backend: **local Ollama only at `http://localhost:11434/api`**.
- `tsc --noEmit`: **0 errors**.

The residual identifier/type/data matches are catalogued above and are confined to dead paths, protocol types, model data, protective allowlists, and the text cursor.
