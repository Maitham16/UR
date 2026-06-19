# UR 1.5.0 — Change Plan (AUDIT ONLY — NOT IMPLEMENTED)

Source folder: `1.4.3 (UR)`
Target folder: `UR-1.5.0`

This is a precise, file-by-file plan. The source is a fork that is already partway through a UR rebrand (it has `src/ur/`, `URLogo.tsx`, `URBanner.tsx`, `getAPIProvider()` hardcoded to `'ollama'`, a working `src/services/api/ollama.ts`, `.ur/`, `.ur-plugin/`, `marketplace-plugins/`). The remaining work is targeted, not a rewrite.

Guiding rule applied throughout: a file is **copied unchanged** unless it contains an affected name, branding string, old symbol, forbidden backend logic, a broken reference, or a bug. Where only one symbol/line is affected, only that part is changed.

---

## 0. Audit summary (what is actually wrong)

The project is mostly clean for UR. Only four problem areas exist:

1. **Ollama Cloud + arbitrary endpoint + cloud auth** — a small, well-contained set of files defaults the model to a `:cloud` tag, allows `OLLAMA_HOST`/`OLLAMA_BASE_URL` overrides, and sends `OLLAMA_API_KEY`. These violate the backend/network rules and must be locked to local Ollama at `http://localhost:11434/api`.
2. **Forbidden symbol/animation components** — `AnimatedAsterisk.tsx`, `AnimatedClawd.tsx`, `Clawd.tsx` exist and are referenced. The loading/thinking spinner uses the old asterisk glyph set. These must be replaced by the UR house symbol and a "house being built" animation.
3. **Telemetry network egress** — telemetry is env-gated off by default, but `bigqueryExporter.ts` has a baked-in `https://api.anthropic.com/api/ur/metrics` endpoint. Must be neutralized to satisfy "no telemetry / no hidden network calls."
4. **Branding strings** — `claude`/`anthropic` appear ~1,100+ times, but the vast majority are internal protocol constants, dead code paths (provider is hardcoded to ollama), type names, or references to *other tools'* config files (legitimately kept). Only user-facing strings need minimal edits.

Confirmed NON-issues (do not touch on their account):
- `cursor` (1,559 hits) = text cursor, not the Cursor IDE. No model-backend usage.
- `openai` (1 hit) and `copilot` (6 hits) = references to reading other tools' config files (`.cursorrules`, `.github/copilot-instructions.md`) and a classifier note. These are features, not backends — **keep**.
- `getAPIProvider()` already returns `'ollama'` unconditionally (`src/utils/model/providers.ts`). The Claude/Bedrock/Vertex/Foundry code paths are already dead. They do **not** need deletion (removing them risks breaking shared imports); they stay as inert code.

---

## 1. Files to COPY UNCHANGED

Copy the entire source tree into `UR-1.5.0/` preserving layout, then apply the changes in sections 2–6. Everything not listed in sections 2–6 is copied byte-for-byte. This explicitly includes:

- **All plugin / marketplace infrastructure** — `marketplace-plugins/`, `plugins/`, `src/plugins/`, `.ur-plugin/` (do not remove plugin marketplace; do not remove local plugins).
- **All internet/search/browser tools** — `src/tools/WebBrowserTool/`, `src/tools/WebFetchTool/`, `src/tools/WebSearchTool/`, `src/tools/ToolSearchTool/` (kept; gated behind explicit user action — see section 8).
- **UR identity assets that are already correct** — `src/components/LogoV2/URLogo.tsx`, `src/components/LogoV2/URBanner.tsx` (the UR logo/wordmark — keep as-is).
- **Ollama support that is already correct in shape** — `src/utils/model/providers.ts` (already forces `'ollama'`), `src/utils/model/ollamaModels.ts` parsing helpers (`parseOllamaModelNames`, `mergeModelOptions`), `src/services/api/ollama.ts` request/streaming logic — *except* the specific lines in section 5.
- **Kimi tool-call transport** — `src/cli/transports/kimiToolCalls.ts`, `ccrClient.ts` and `test/kimiToolCalls.test.ts`. Kimi runs locally via Ollama; only the `:cloud` default tag is the problem, not the parser. Keep.
- **docs / examples / tests** — keep all (`docs/`, `examples/`, `test/`), except the specific doc lines fixed in section 5 and the obsolete-line note in section 7. None are truly obsolete; none are removed.
- **Config/build** — `package.json`, `bun.lock`, `bunfig.toml`, `tsconfig.json`, `.gitignore`, `.github/`, `LICENSE`, `scripts/secret-scan.sh`, `stubs/` (Anthropic SDK type stubs — required for the build to typecheck; inert at runtime; keep).
- **The bundled `src/main.tsx`** (803 KB) — copy unchanged. Its ~60 `claude`/`anthropic` hits are inside a build artifact; do not hand-edit the bundle. The one user-facing `:cloud` mention there is regenerated from source on rebuild (see section 5 note).

---

## 2. Files to RENAME

None required for correctness. The layout is preserved and the existing UR-named files (`URLogo.tsx`, `URBanner.tsx`, `src/ur/`, `urApi.ts`, `urApiContent.ts`, `urAiLimits.ts`) already follow UR naming.

The forbidden component files are **removed/replaced** (section 4), not renamed, to avoid leaving the old `Clawd`/`Asterisk` names as exports anywhere.

---

## 3. Files to MODIFY MINIMALLY (single-symbol / single-line edits)

### Backend — lock to local Ollama (see section 5 for exact diffs)
- `bin/ur.js` — line 38: change default model off the `:cloud` tag.
- `src/utils/model/model.ts` — line 39: `DEFAULT_OLLAMA_MODEL` off `:cloud`.
- `src/utils/model/configs.ts` — line 5: `DEFAULT_OLLAMA_MODEL` off `:cloud`.
- `src/utils/model/ollamaModels.ts` — lines 3–8: lock base URL to `http://localhost:11434`, remove env overrides; lines 39–42: remove `OLLAMA_API_KEY` header.
- `src/services/api/ollama.ts` — lines 83 & 209–212: same base-URL lock; lines 160–163: remove `OLLAMA_API_KEY` header.
- `src/ur/sysinfo.ts` — line 56: stop reading `OLLAMA_HOST`; use the shared locked base URL helper.

### Symbol/animation (see section 6)
- `src/constants/figures.ts` — line 6: replace `TEARDROP_ASTERISK = '✻'` value with the UR house glyph (keep the export name to avoid touching importers, OR rename + update the two importers; see section 6).
- `src/components/Spinner/utils.ts` — lines 5–11: replace the asterisk frame arrays in `getDefaultCharacters()` with the house-construction frame sequence.

### Telemetry (see section 7)
- `src/utils/telemetry/bigqueryExporter.ts` — lines ~48–58: neutralize the baked-in `api.anthropic.com` default endpoint (make the exporter a no-op when no explicit user-provided endpoint exists).

### Branding strings (user-facing only)
- `src/skills/bundled/urApiContent.ts`, `src/commands/init.ts`, `src/commands/insights.ts`, `src/utils/statusNoticeDefinitions.tsx`, and any other file where a **printed/displayed** string says "Claude"/"Anthropic" as the product name → change to "UR". Do **not** change: env-var names (`ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`), SDK type names, OAuth/protocol constants, or strings describing *other* tools (e.g. init.ts mentioning `.github/copilot-instructions.md`). These are verified during implementation step 9 with a focused grep, not bulk-replaced.

---

## 4. Files to REPLACE with original UR implementation (forbidden components)

These three files must not survive in UR (rule: do not use Clawd / AnimatedAsterisk / old asterisk-symbol components):

- `src/components/LogoV2/AnimatedAsterisk.tsx` → **replace** with `src/components/LogoV2/AnimatedUrHouse.tsx` exporting `AnimatedUrHouse` (the "house being built" animation; square body + triangle roof assembling frame by frame).
- `src/components/LogoV2/Clawd.tsx` → **replace** with `src/components/LogoV2/UrHouse.tsx` exporting `UrHouse` (static UR house symbol).
- `src/components/LogoV2/AnimatedClawd.tsx` → **replace** with logic folded into `AnimatedUrHouse.tsx`; remove the `AnimatedClawd` export entirely.

All importers of the old components must be updated (section "References to update").

---

## 5. BACKEND CHANGES NEEDED (exact)

Requirement: model execution = local Ollama only at `http://localhost:11434/api`; no Ollama Cloud; no arbitrary endpoint config; no Claude/Anthropic/OpenAI/Gemini/Cursor/Copilot backends.

Current state and required edits:

**(a) Default model is a cloud tag — `kimi-k2.7-code:cloud`.** Found in 5 places. The `:cloud` suffix forces Ollama Cloud and must be removed. Replace with a local default (recommended: `llama3.2`, or another locally-pulled model name — final choice is a one-line constant):
- `bin/ur.js:38`
- `src/utils/model/model.ts:39` (`DEFAULT_OLLAMA_MODEL`)
- `src/utils/model/configs.ts:5` (`DEFAULT_OLLAMA_MODEL`)
- `docs/USAGE.md:54` and `README.md:45` (doc text — update to match)

**(b) Arbitrary endpoint config via `OLLAMA_HOST` / `OLLAMA_BASE_URL`.** Two duplicate `getOllamaBaseUrl()` implementations read these env vars. Lock both to a constant `http://localhost:11434` (note: requirement spells `localhost`, current code uses `127.0.0.1` — change to `localhost`). The `/api/...` path suffixes already match the allowed `http://localhost:11434/api`:
- `src/utils/model/ollamaModels.ts:3` (`DEFAULT_BASE_URL`) and `:5–8` (`getOllamaBaseUrl`) — remove the `process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST ||` chain; return the constant.
- `src/services/api/ollama.ts:83` (`DEFAULT_BASE_URL`) and `:209–212` (`getOllamaBaseUrl`) — same.
- Recommended: collapse the two duplicates into one exported helper to prevent drift (optional, low-risk).

**(c) Cloud auth via `OLLAMA_API_KEY`.** Remove the Authorization header (local Ollama needs no key; sending one implies cloud):
- `src/utils/model/ollamaModels.ts:39–42`
- `src/services/api/ollama.ts:160–163`
- `docs/USAGE.md:73`, `docs/CONFIGURATION.md:20` (remove the documented var)

**(d) Endpoints in use are already correct** — `/api/chat` (execution) and `/api/tags` (model list) under the locked base. No change to request bodies.

**(e) Other model backends are already disabled** — `getAPIProvider()` (`src/utils/model/providers.ts:11`) returns `'ollama'` unconditionally; Claude/Bedrock/Vertex/Foundry branches are dead. Leave the inert code (deleting risks broken imports across `services/api/claude.ts`, `client.ts`, `bedrock.ts`, etc.). No new backend is added.

`bin/ur.js` keeps honoring `OLLAMA_MODEL` / `UR_MODEL` — these select a *model name* (allowed), not an endpoint, so they stay.

---

## 6. SYMBOL / LOGO CHANGES NEEDED

**Keep the UR logo:** `URLogo.tsx` and `URBanner.tsx` are clean (themed with the `ur` color) — unchanged.

**Replace the old asterisk loading/thinking symbol with the UR house symbol.** The house symbol = a square body with two roof lines forming a triangle.

- **Static glyph:** `src/constants/figures.ts:6` currently `TEARDROP_ASTERISK = '✻'`. This single glyph is consumed by `src/components/Spinner.tsx` and `src/components/Spinner/TeammateSpinnerTree.tsx` (idle status). Provide a UR house glyph constant. Preferred approach: add `export const UR_HOUSE = '⌂'` (the house glyph: square body + triangular roof), update the two importers to use it, and remove `TEARDROP_ASTERISK`. (Single-glyph terminals can't render a literal multi-line house, so the inline status uses the `⌂` house glyph; the multi-line built-house art is used by the animation component below.)

- **Spinner frame animation = "house being built":** `src/components/Spinner/utils.ts:5–11` `getDefaultCharacters()` returns the asterisk progression `['·','✢','✳','✶','✻','✽']` (with Ghostty/terminal variants). Replace each variant array with a house-construction progression that builds the house step by step (e.g. ground dot → left wall → walls → roof-left → roof-complete → full house), so the spinner visibly assembles the square body and triangular roof. Keep the same array length and the reverse-frame logic in `SpinnerGlyph.tsx`/`Spinner.tsx` so timing is unaffected.

- **Forbidden components removed/replaced** (section 4): create `UrHouse.tsx` (static, multi-line ASCII house: square body + two roof lines) and `AnimatedUrHouse.tsx` (frame-by-frame house construction) as the original UR implementations replacing `Clawd.tsx` / `AnimatedClawd.tsx` / `AnimatedAsterisk.tsx`.

---

## 7. Files to REMOVE (with exact reason)

- `src/components/LogoV2/AnimatedAsterisk.tsx` — **reason:** forbidden old asterisk-symbol component; replaced by `AnimatedUrHouse.tsx`.
- `src/components/LogoV2/AnimatedClawd.tsx` — **reason:** forbidden Clawd component; functionality replaced by `AnimatedUrHouse.tsx`.
- `src/components/LogoV2/Clawd.tsx` — **reason:** forbidden Clawd component; replaced by `UrHouse.tsx`.

No other files are removed. Docs, examples, tests, plugins, marketplace, browser/search tools are all retained (only specific lines edited per sections 5–6). The `:cloud` line inside the bundled `src/main.tsx` is **not** removed by hand — it is a generated artifact and is corrected by rebuilding from the edited source, or left until the next build (it is inert text in `--model` help, not an execution default).

---

## 8. PLUGIN / SEARCH / BROWSER RULES TO PRESERVE

- **Plugin marketplace:** keep `marketplace-plugins/`, `.ur-plugin/`, `src/utils/plugins/`, plugin telemetry stays disabled-by-default (section 7 telemetry). Do not remove.
- **Local plugins:** keep `plugins/`, `src/plugins/`. Do not remove.
- **Internet / search / browser tools:** keep `WebBrowserTool`, `WebFetchTool`, `WebSearchTool`, `ToolSearchTool`. These remain available **only by explicit user action** — verify they are not auto-invoked and are not called during model execution. No change to their code unless a hidden auto-call is found.
- **Network policy:** model calls → local Ollama only (section 5). Tools → local by default. Internet/search/browser/marketplace → explicit user action only. No hidden network calls. No telemetry (section 7).

---

## 9. REFERENCES THAT MUST BE UPDATED

When the forbidden components are replaced, every importer must point at the new UR house components:

- `src/components/LogoV2/VoiceModeNotice.tsx:9` — `import { AnimatedAsterisk }` → `import { AnimatedUrHouse }` (+ usages).
- `src/components/LogoV2/Opus1mMergeNotice.tsx:8` — `import { AnimatedAsterisk }` → `AnimatedUrHouse` (+ usages).
- `src/components/LogoV2/CondensedLogo.tsx:16–17` — `import { AnimatedClawd }` and `import { Clawd }` → `AnimatedUrHouse` / `UrHouse` (+ usages).
- `src/components/LogoV2/LogoV2.tsx:11` — `import { Clawd }` → `UrHouse` (+ usages).
- `src/components/LogoV2/AnimatedClawd.tsx:6` — eliminated (file removed).

When `TEARDROP_ASTERISK` is replaced by `UR_HOUSE`:
- `src/components/Spinner.tsx` (import + usage).
- `src/components/Spinner/TeammateSpinnerTree.tsx` (idle status usage/comment line ~19).

When the duplicate `getOllamaBaseUrl()` is consolidated (optional): update `src/ur/sysinfo.ts:56` to import the shared helper instead of reading `OLLAMA_HOST`.

Verification after edits (focused, not broad): re-grep for `AnimatedAsterisk`, `AnimatedClawd`, `Clawd`, `:cloud`, `OLLAMA_API_KEY`, `OLLAMA_HOST`, `OLLAMA_BASE_URL`, `127.0.0.1:11434`, `TEARDROP_ASTERISK` and confirm zero remaining hits outside the bundled `main.tsx` and intentionally-kept doc history.

---

## 10. EXACT IMPLEMENTATION ORDER

1. **Copy** the full `1.4.3 (UR)` tree into `UR-1.5.0/` unchanged (preserve layout).
2. **Backend lock (5a–5c):** edit `bin/ur.js`, `model.ts`, `configs.ts`, `ollamaModels.ts`, `services/api/ollama.ts`, `src/ur/sysinfo.ts`. Remove `:cloud` default, lock base URL to `http://localhost:11434`, remove `OLLAMA_API_KEY` and env-endpoint overrides.
3. **Telemetry neutralize (7):** edit `bigqueryExporter.ts` to drop the `api.anthropic.com` default endpoint; confirm OTLP/beta paths stay env-gated off.
4. **Create UR house components (4, 6):** add `UrHouse.tsx` and `AnimatedUrHouse.tsx`.
5. **Replace glyphs (6):** edit `figures.ts` (`UR_HOUSE`) and `Spinner/utils.ts` (house-build frames).
6. **Update references (9):** repoint all importers; then **remove** `AnimatedAsterisk.tsx`, `AnimatedClawd.tsx`, `Clawd.tsx`.
7. **Branding strings (3):** focused grep for user-facing "Claude"/"Anthropic" product strings; change to "UR" only where displayed.
8. **Docs (5):** update `USAGE.md`, `CONFIGURATION.md`, `README.md` to local-only endpoint and non-cloud default model; remove `OLLAMA_API_KEY` mentions.
9. **Verify (9):** run the focused re-grep checklist; confirm `getAPIProvider()` still `'ollama'`; confirm browser/search/marketplace tools intact and not auto-invoked.
10. **Build & test** (only after the above, and only when you authorize it).

---

PLAN COMPLETE — NOT IMPLEMENTED YET
