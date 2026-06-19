# UR 1.5.0 — Change Log

Implementation of `UR_CHANGE_PLAN.md`. Source: `1.4.3 (UR)`. Target: `UR-1.5.0`.
The full tree was copied with original layout preserved. Every file not listed below was **copied unchanged**, including: `marketplace-plugins/`, `plugins/`, `src/plugins/`, `.ur-plugin/` (plugin marketplace + local plugins), `src/tools/WebBrowserTool/`, `WebFetchTool/`, `WebSearchTool/`, `ToolSearchTool/` (internet/search/browser tools), `docs/` (except the two files below), `examples/`, `test/` (except the one file below), `stubs/`, `src/components/LogoV2/URLogo.tsx`, `URBanner.tsx` (UR logo kept), and `src/utils/model/providers.ts` (already forces the `ollama` provider).

---

## Backend — strict local Ollama (`http://localhost:11434/api`)

### bin/ur.js
- Action: modified
- What changed: default session model `'kimi-k2.7-code:cloud'` → `'llama3.2'`.
- References updated: none.
- Reason: `:cloud` forces Ollama Cloud. UR must use local Ollama only.

### src/utils/model/model.ts
- Action: modified
- What changed: `DEFAULT_OLLAMA_MODEL` `'kimi-k2.7-code:cloud'` → `'llama3.2'`.
- References updated: none (constant value only).
- Reason: remove Ollama Cloud default.

### src/utils/model/configs.ts
- Action: modified
- What changed: `DEFAULT_OLLAMA_MODEL` `'kimi-k2.7-code:cloud'` → `'llama3.2'`.
- References updated: none.
- Reason: remove Ollama Cloud default.

### src/utils/model/ollamaModels.ts
- Action: modified
- What changed: renamed local `DEFAULT_BASE_URL` (`http://127.0.0.1:11434`, env-overridable) to a fixed `OLLAMA_BASE_URL = 'http://localhost:11434'`; `getOllamaBaseUrl()` now returns the constant and no longer reads `OLLAMA_BASE_URL`/`OLLAMA_HOST`; removed the `OLLAMA_API_KEY` Authorization header from the `/api/tags` request.
- References updated: internal `getOllamaBaseUrl()` callers unaffected (same signature); test updated (see test/ollamaModels.test.ts).
- Reason: forbid arbitrary endpoint config and cloud auth; lock to local endpoint.

### src/services/api/ollama.ts
- Action: modified
- What changed: same base-URL lock as above (fixed `OLLAMA_BASE_URL = 'http://localhost:11434'`, `getOllamaBaseUrl()` returns the constant, no env reads); removed the `OLLAMA_API_KEY` Authorization header from the `/api/chat` execution request.
- References updated: none (internal helper, same signature).
- Reason: model execution must hit local Ollama only with no key and no endpoint override.

### src/ur/sysinfo.ts
- Action: modified
- What changed: doctor host `process.env.OLLAMA_HOST || 'http://localhost:11434'` → fixed `'http://localhost:11434'`.
- References updated: none.
- Reason: remove arbitrary endpoint config from the environment check.

### src/main.tsx
- Action: modified
- What changed: `--model` flag help text no longer advertises a `':cloud' model tag`; now reads "Local Ollama model … 'llama3.2' or 'qwen2.5-coder:latest'".
- References updated: none.
- Reason: live CLI help must not advertise Ollama Cloud. (Single-line edit; the 803 KB file was otherwise left intact.)

### test/ollamaModels.test.ts
- Action: modified
- What changed: replaced the `getOllamaBaseUrl normalizes host environment values` test with one asserting `getOllamaBaseUrl()` always returns `http://localhost:11434` and ignores `OLLAMA_HOST`/`OLLAMA_BASE_URL`.
- References updated: this test is the usage site of the changed function.
- Reason: the test asserted the removed override behavior; updated to the locked behavior. Test retained, not deleted.

---

## Network — no telemetry / no hidden network calls

### src/utils/telemetry/bigqueryExporter.ts
- Action: modified
- What changed: constructor no longer sets the baked-in `https://api.anthropic.com/api/ur/metrics` default endpoint (and dropped the `ANT_CLAUDE_CODE_METRICS_ENDPOINT` override); `this.endpoint` is now `''`. Added an early guard in `doExport` that returns success without any network call when no endpoint is set.
- References updated: none (private field).
- Reason: eliminate the only telemetry exporter with a hard-coded remote endpoint. OTLP/beta-tracing exporters remain env-gated off by default (opt-in = explicit user action) and were not changed.

---

### src/services/analytics/firstPartyEventLogger.ts
- Action: modified (added during verification)
- What changed: `is1PEventLoggingEnabled()` now returns `false` instead of `!isAnalyticsDisabled()`.
- References updated: none (this is the central gate; `growthbook.ts` `isGrowthBookEnabled()` depends on it, and `firstPartyEventLogger` checks it before every network log).
- Reason: disables first-party event logging and GrowthBook at the source, removing automatic analytics/telemetry network calls to `api.anthropic.com`. With this off and the BigQuery exporter neutralized, `checkMetricsEnabled()` is never reached. Satisfies "no telemetry / no hidden network calls."

## Symbol / logo — UR house replaces the asterisk

### src/constants/figures.ts
- Action: modified
- What changed: `export const TEARDROP_ASTERISK = '✻'` → `export const UR_HOUSE = '⌂'`.
- References updated: SystemTextMessage.tsx, Passes.tsx, Spinner.tsx (all import sites updated to `UR_HOUSE`).
- Reason: replace the old asterisk thinking/status glyph with the UR house symbol.

### src/components/Spinner/utils.ts
- Action: modified
- What changed: `getDefaultCharacters()` now returns the house-construction frame sequence `['·','▖','▃','▆','█','⌂']` instead of the asterisk progression; removed the terminal-specific asterisk variants.
- References updated: none (same function, consumed by SpinnerGlyph.tsx / Spinner.tsx).
- Reason: the working/thinking spinner now animates the house being built.

### src/components/messages/SystemTextMessage.tsx
- Action: modified
- What changed: identifier `TEARDROP_ASTERISK` → `UR_HOUSE` (import + 4 usages).
- References updated: import from `constants/figures.js`.
- Reason: follow the renamed constant.

### src/components/Passes/Passes.tsx
- Action: modified
- What changed: identifier `TEARDROP_ASTERISK` → `UR_HOUSE` (import + 2 usages).
- References updated: import from `constants/figures.js`.
- Reason: follow the renamed constant.

### src/components/Spinner.tsx
- Action: modified
- What changed: identifier `TEARDROP_ASTERISK` → `UR_HOUSE` (import + idle-status usages).
- References updated: import from `constants/figures.js`.
- Reason: follow the renamed constant.

### src/components/messages/AssistantRedactedThinkingMessage.tsx
- Action: modified
- What changed: literal thinking glyph `✻` → `⌂` in "Thinking…".
- References updated: none.
- Reason: replace the old asterisk thinking symbol.

### src/components/messages/CompactBoundaryMessage.tsx
- Action: modified
- What changed: literal `✻` → `⌂` in the "Conversation compacted" marker.
- References updated: none.
- Reason: replace the old asterisk loading/status symbol.

### src/components/IdeOnboardingDialog.tsx
- Action: modified
- What changed: literal `✻` → `⌂` in the onboarding marker.
- References updated: none.
- Reason: replace the old asterisk symbol.

### src/hooks/useDiffInIDE.ts
- Action: modified
- What changed: literal `✻` → `⌂` in the `[UR]` IDE diff label.
- References updated: none.
- Reason: replace the old asterisk symbol.

### src/components/LogoV2/UrHouse.tsx
- Action: created (replaces Clawd.tsx)
- What changed: new UR-owned static house component — a square body with two roof lines forming a triangle, themed with the `ur` color.
- References updated: imported by CondensedLogo.tsx.
- Reason: UR-owned replacement for the removed `Clawd` mascot component.

### src/components/LogoV2/AnimatedUrHouse.tsx
- Action: created (replaces AnimatedAsterisk.tsx / AnimatedClawd.tsx)
- What changed: new UR-owned animated component. With no `char`, it animates the house being built (`·▖▃▆█⌂`) then settles on the `⌂` house glyph; with a `char` prop it animates that glyph (preserving the prior `char`-prop behavior used by the Opus 1M notice).
- References updated: imported by VoiceModeNotice.tsx and Opus1mMergeNotice.tsx.
- Reason: UR-owned replacement for the removed `AnimatedAsterisk` / `AnimatedClawd` components.

### src/components/LogoV2/VoiceModeNotice.tsx
- Action: modified
- What changed: `import { AnimatedAsterisk }` → `import { AnimatedUrHouse }`; usage `<AnimatedAsterisk />` → `<AnimatedUrHouse />`.
- References updated: import path `./AnimatedUrHouse.js`.
- Reason: forbidden component replaced.

### src/components/LogoV2/Opus1mMergeNotice.tsx
- Action: modified
- What changed: `import { AnimatedAsterisk }` → `import { AnimatedUrHouse }`; usage `<AnimatedAsterisk char={UP_ARROW} />` → `<AnimatedUrHouse char={UP_ARROW} />`.
- References updated: import path `./AnimatedUrHouse.js`.
- Reason: forbidden component replaced; `char` behavior preserved.

### src/components/LogoV2/CondensedLogo.tsx
- Action: modified
- What changed: replaced `import { AnimatedClawd }` and `import { Clawd }` with `import { UrHouse }`; usage `isFullscreenEnvEnabled() ? <AnimatedClawd /> : <Clawd />` → `isFullscreenEnvEnabled() ? <UrHouse /> : <UrHouse />`.
- References updated: import path `./UrHouse.js`; `isFullscreenEnvEnabled` still referenced.
- Reason: forbidden mascot components replaced by the UR house logo; consistent sizing in both branches.

### src/components/LogoV2/LogoV2.tsx
- Action: modified
- What changed: removed the unused `import { Clawd } from './Clawd.js';`.
- References updated: none (import was unused).
- Reason: `Clawd` removed; dangling import cleared.

### src/components/LogoV2/AnimatedAsterisk.tsx
- Action: removed
- What changed: file deleted.
- References updated: VoiceModeNotice.tsx, Opus1mMergeNotice.tsx now use AnimatedUrHouse.
- Reason: forbidden old asterisk-symbol component.

### src/components/LogoV2/AnimatedClawd.tsx
- Action: removed
- What changed: file deleted.
- References updated: CondensedLogo.tsx now uses UrHouse.
- Reason: forbidden Clawd component.

### src/components/LogoV2/Clawd.tsx
- Action: removed
- What changed: file deleted.
- References updated: CondensedLogo.tsx and LogoV2.tsx updated.
- Reason: forbidden Clawd component.

Note: the `clawd_body` / `clawd_background` theme keys in `src/utils/theme.ts` were left unchanged. They were only consumed by the removed components and are now inert; removing them was avoided to prevent unnecessary edits to otherwise-clean code.

---

## Identity / docs

### package.json
- Action: modified
- What changed: `"version": "1.4.3"` → `"1.5.0"`.
- References updated: none.
- Reason: align the package version with UR 1.5.0. Name (`ur-agent`) and description were already UR-branded.

### docs/CONFIGURATION.md
- Action: modified
- What changed: Model Provider section rewritten to state the fixed local endpoint `http://localhost:11434/api`; removed `OLLAMA_HOST`, `OLLAMA_BASE_URL`, `OLLAMA_API_KEY`; stated that Ollama Cloud / remote endpoints / API keys are unsupported; kept `OLLAMA_MODEL`/`UR_MODEL` as model-name selection.
- References updated: none.
- Reason: documentation must match the locked local-only backend.

### docs/USAGE.md
- Action: modified
- What changed: Models section fallback `kimi-k2.7-code:cloud` → `llama3.2`; removed the `OLLAMA_HOST`/`OLLAMA_BASE_URL` override block and the `OLLAMA_API_KEY` block; stated the fixed `http://localhost:11434/api` endpoint and that overrides/cloud/keys are unsupported.
- References updated: none.
- Reason: documentation must match the locked local-only backend.

### README.md
- Action: modified
- What changed: "Ollama-compatible default model" → "local Ollama default model"; requirements line "An Ollama-compatible server" → "A local Ollama server … at http://localhost:11434/api"; launch-wrapper fallback `kimi-k2.7-code:cloud` → `llama3.2`.
- References updated: none.
- Reason: documentation must match the locked local-only backend.

---

## Vendor-removal pass (see UR_REMOVAL_REPORT.md)

A later pass removed all `api.anthropic.com`/`anthropic.com` hosts from live code (feedback, transcript-share, MCP registry, metrics, GrowthBook, files API, WebFetch domain-info, OAuth, upstream proxy, sessions WebSocket, voice STT, and assorted UI/error/User-Agent/legal text), disabled first-party analytics/telemetry at the source, removed `ANTHROPIC_API_KEY` env reads from the auth path and UI, renamed the `clawd_*` theme tokens to `ur_logo_*`, and converted remaining user-facing "Claude" strings (including the `/hooks` "ask Claude") to "UR". `tsc --noEmit` stays at 0 errors. Full file-by-file detail and the catalogue of irreducible residue (SDK protocol types, model registry data, text cursor, secret-redaction allowlists) is in `UR_REMOVAL_REPORT.md`.

## Intentionally NOT changed (per plan)

- `getAPIProvider()` already returns `'ollama'`; the Claude/Bedrock/Vertex/Foundry code paths are dead and were left inert (deleting risks broken imports; no live backend).
- Internal `claude`/`anthropic` occurrences that are env-var names, SDK type names, OAuth/protocol constants, dead-path strings, or compatibility filenames (`CLAUDE.md` / `CLAUDE.local.md`, which UR actively loads as project memory — a working feature) were left as-is. No user-facing product-name strings (`Claude Code`, `Welcome to Claude`, `by Anthropic`) were found in live UI.
- `cursor` (text cursor), `openai`/`copilot` (references to reading other tools' config files) are features, not model backends — left as-is.
- Plugin marketplace, local plugins, internet/search/browser tools, commands, docs, examples, and tests were preserved.

---

## Verification greps (no tests run yet)

- Forbidden component/symbol names (`AnimatedAsterisk`, `AnimatedClawd`, `Clawd`, `TEARDROP_ASTERISK`): NONE in `src/`.
- `:cloud` in `src/`, `bin/`, `docs/`, `README.md`: NONE.
- `OLLAMA_HOST` / `OLLAMA_BASE_URL` / `OLLAMA_API_KEY` reads: NONE (only the fixed local `OLLAMA_BASE_URL` constant remains).
- `127.0.0.1:11434`: NONE.
- `api.anthropic.com` in `src/utils/telemetry/`: NONE.
- `DEFAULT_BASE_URL` dangling references: NONE.
