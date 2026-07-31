# UR-Nexus audit and fix report — 1.72.0 → 1.73.0

**Scope actually completed is a subset of what was requested.** This document
states exactly what was fixed and verified, and exactly what was not attempted.
Nothing here is inferred; every claim below has a command and an exit code.

---

## 0. Honest scope statement

The request covered ten subsystems across a 2,464-file codebase, each with full
test coverage and verification. **Four areas were audited, fixed, tested and
verified. The rest were not attempted.** Nothing was partially edited and left
broken — untouched areas are byte-identical to `HEAD`.

| Requested area | Status |
| --- | --- |
| Provider API-key input (one char per line, key corruption) | **Verified fixed** |
| Provider credential change / disconnect | **Verified fixed** |
| Token accounting showing `0` beside tool counts | **Verified fixed** |
| Questions choices UI detaching past 4 options | **Verified fixed** |
| Dynamic model-list refresh | **Audited — already implemented; not modified** |
| Task list / subagent behaviour | **Audited — existing tests pass; not modified** |
| Tool-schema audit | **Not attempted** |
| Bash reliability | **Not attempted** |
| Timeout / stalled-work | **Not attempted** |
| Status-bar redesign + field settings | **Not attempted** |
| Prompt/execution bottleneck audit | **Not attempted** |

Protected areas (security, safety, permissions, approvals, sandbox,
workspace-access, prompt-injection defenses) were **not read for modification and
not touched**. No file under `src/tools/BashTool/`, `src/services/safety/`,
`src/utils/sandbox/`, or any permission/approval path appears in the diff.

---

## 1. Audit findings

### F1 — API key field renders one character per line · **Critical** · Fixed

**Evidence.** `src/components/ProviderFirstModelPicker.tsx:364` was the only
`<TextInput>` in `src/` that omitted `columns`, `cursorOffset` and
`onChangeCursorOffset`. All three are non-optional in
`src/types/textInputTypes.ts:113`. The file opens with `// @ts-nocheck` (line 1),
so the compiler could not report the missing props.

**Root cause.** Three distinct defects from one omission:

1. **1-column wrap.** `columns: undefined` → `useTextInput` →
   `Cursor.fromText(text, undefined, …)` → `normalizeCursorColumns(undefined)`
   (`src/utils/Cursor.ts:1119`) returns `2` because `Number.isFinite(undefined)`
   is false → `new MeasuredText(text, 2 - 1)` → `wrapAnsi(text, 1, {hard: true})`
   → one grapheme per line.
2. **Key stored reversed.** `cursorOffset: undefined` → `externalOffset`
   undefined → `Cursor.fromText`'s `offset = 0` default applies on every render,
   so the offset never advanced and each keystroke inserted at the head.
   Typing `sk-abc` stored `cba-ks`.
3. **Throw on every keystroke.** `onChangeCursorOffset: undefined` →
   `setOffset` undefined → `setOffset(nextCursor.offset)` at
   `src/hooks/useTextInput.ts:452` and `:477` throws `TypeError`.

**Impact.** No provider connectable through the in-app picker; any key that
appeared to save was corrupted.

**Resolution.** Fixed at both the component boundary and the call site so no
future call site can reproduce it:

- `src/components/TextInput.tsx` — resolves a usable width from the live
  `TerminalSizeContext` when `columns` is absent or `< 2`, and holds the cursor
  offset in internal state when the caller does not lift it. Read via
  `useContext` rather than `useTerminalSize()` so a render outside an Ink app
  degrades instead of throwing.
- `src/components/ProviderFirstModelPicker.tsx` — passes `columns`,
  `cursorOffset`, `onChangeCursorOffset`, `focus` and `showCursor` explicitly.

### F2 — Pasted keys keep the newline from the copied line · **High** · Fixed

**Evidence.** `setProviderApiKey` applied only `.trim()`
(`src/services/providers/providerCredentials.ts:60`), which removes leading and
trailing whitespace but not interior line breaks.

**Impact.** A bracketed paste carrying `\n` produced a stored value that is not
a legal HTTP header value, failing later requests with an opaque transport error
instead of a `401`.

**Resolution.** New `src/services/providers/apiKeyInput.ts` strips C0/C1
controls and Unicode line separators (` `/` `) and reports interior
whitespace to the user rather than silently accepting it. Keys are opaque, so
nothing beyond "non-empty and single-line" is enforced; the value is never
truncated or re-cased.

### F3 — No way to change or remove a stored key · **Medium** · Fixed

**Evidence.** `clearProviderApiKey` exists and works
(`providerCredentials.ts:106`) but had no UI caller. Selecting a connected
api-key provider went straight to model selection.

**Resolution.** A `manage` step in the picker offers *Continue to models* /
*Change API key* / *Disconnect*, shown only when
`getProviderApiKeySource(...) === 'stored'` — a key supplied through the
environment belongs to the shell and is left alone. "Continue to models" is the
default, so the common path is still Enter-Enter.

### F4 — Key-entry screen advertised an Esc that did nothing · **Low** · Fixed

**Evidence.** `handleKeyCancel` was defined but never referenced; the footer
rendered `KeyboardShortcutHint shortcut="Esc" action="back"`. The text input owns
the escape key (double-press-to-clear), so nothing returned to the provider list.

**Resolution.** A `useInput` handler scoped to `isActive: step === 'connect'`.

### F5 — `0 tokens` printed beside real tool counts · **Medium** · Fixed

**Evidence.** `src/tools/AgentTool/UI.tsx:376` built the summary segments
unconditionally: `formatNumber(totalTokens) + ' tokens'`. When a provider returns
no usage block the pipeline substitutes `EMPTY_USAGE`
(`src/services/api/emptyUsage.ts`), whose counters are all zero, so
`getTokenCountFromUsage` returned `0` and the UI rendered
`Done (7 tool uses · 0 tokens · 1m 4s)`.

**Root cause.** Absent usage and zero usage were indistinguishable by value.

**Resolution.** `hasReportedTokenUsage()` and `formatReportedTokens()` in
`src/utils/tokens.ts`. No completion that produced content can cost zero input
*and* zero output, so an all-zero block means "unreported" and the segment is
omitted entirely. Tool count and token figure are now independent: the tool count
always renders; the token figure renders only when the provider supplied it.
Provider-reported input, output, cached and creation tokens are unchanged —
`getTokenCountFromUsage` was not modified.

### F6 — Choices past the fourth detach from the list · **Medium** · Fixed

**Evidence.** `QuestionView.tsx:230` and `:207` rendered `<Select>` and
`<SelectMulti>` with no `visibleOptionCount`. The default is `5`
(`select.tsx:219`, `SelectMulti.tsx:81`, `use-select-state.ts:128`).
`QuestionView` appends a synthetic `__other__` entry, so a question with four
choices already hits the window, and the `<Divider>` at `:252` plus the footer
rows sit directly below — the tail read as a detached second group.

**Resolution.** `choiceListLayout.ts` sizes the list to the terminal: one
continuous list when it fits, windowing only when the height genuinely cannot,
never below three rows.

---

## 2. Changed files

| File | Purpose |
| --- | --- |
| `src/components/TextInput.tsx` | Resolve wrap width from terminal size when `columns` absent; internal cursor offset when caller does not lift it. Exports `resolveImplicitInputColumns` / `hasUsableColumns` for test. |
| `src/components/ProviderFirstModelPicker.tsx` | Pass width/offset/setter/focus to the key field; `manage` step for change-key and disconnect; working Esc; sanitise on submit. |
| `src/services/providers/apiKeyInput.ts` *(new)* | Single-line normalisation and validation of entered keys. |
| `src/utils/tokens.ts` | `hasReportedTokenUsage`, `formatReportedTokens`. Existing functions unchanged. |
| `src/tools/AgentTool/UI.tsx` | Omit the token segment when usage is unreported. |
| `.../AskUserQuestionPermissionRequest/choiceListLayout.ts` *(new)* | Terminal-aware choice-list sizing. |
| `.../AskUserQuestionPermissionRequest/QuestionView.tsx` | Pass computed count to both select modes. |
| `test/providerApiKeyInput.test.ts` *(new)* | 14 tests. |
| `test/tokenReporting.test.ts` *(new)* | 9 tests. |
| `test/questionChoiceLayout.test.ts` *(new)* | 9 tests. |
| `CHANGELOG.md`, `package.json`, `bunfig.toml`, `docs/VALIDATION.md`, `documentation/index.html`, `extensions/*`, `src/commands/agent-ci/agent-ci.ts`, `src/services/agents/{agenticCi,featureScaffolds}.ts` | 1.72.0 → 1.73.0 across all eight locations the release gate checks. |

---

## 3. Provider API input and model refresh

**API input:** fixed and tested — see F1–F4. Sanitisation is covered for typed
keys, trailing `\n`, `\r\n`, embedded newlines, tabs, interior spaces, a
403-character key, and empty/whitespace-only input.

**Dynamic model refresh: audited, already correct, not modified.**
`listModelsForProviderWithSource` (`providerRegistry.ts:2187`) already implements
live → cache → static fallback with a per-endpoint cache key, per-provider
official endpoints and parsers (`anthropic-api` `x-api-key` + `anthropic-version:
2023-06-01`; `gemini-api` `x-goog-api-key` filtered to `generateContent`;
`openrouter` and OpenAI-compatible `Bearer` + `data[].id`), `AbortSignal`
support, and a distinct `warning` per failure mode. It was left alone.

**Not done:** per-request deduplication, an explicit retry affordance, and the
"arranged list / full model name" presentation change. The picker still shows
`model.displayName` at `Math.min(10, …)` visible rows.

---

## 4. Task list and subagent behaviour

**Audited, not modified.** `test/promptPlanExecutor.test.ts` already asserts the
four behaviours called out in the request:

```
(pass) running tasks update correctly and completed tasks are checked
(pass) failed tasks render clearly as failed, not unchecked
(pass) does not emit duplicate consecutive boards
(pass) final board is clean with no duplicate separators
4 pass, 0 fail   [bun test --timeout 30000 test/promptPlanExecutor.test.ts] exit 0
```

These three fail under the default 5 s per-test cap in this sandbox purely on
wall-clock (6–9 s observed) and pass with headroom. **Before and after are
identical — no change was made here.** Fresh-list-per-prompt, never-append-to-a-
completed-list, and parallel subagent scheduling were **not** investigated.

---

## 5. Tool-schema, Bash, timeout and questions-UI

- **Questions UI:** fixed (F6), 9 tests.
- **Tool schemas, Bash reliability, timeout/stalled-work:** **not attempted.**
  No file in those paths is in the diff.

---

## 6. Token accounting — before and after

| Condition | Before | After |
| --- | --- | --- |
| Provider reports usage | `7 tool uses · 12,431 tokens · 1m 4s` | unchanged |
| Provider reports nothing | `7 tool uses · 0 tokens · 1m 4s` | `7 tool uses · 1m 4s` |
| Usage object absent | `0 tokens` | segment omitted |
| Cached / creation tokens | counted in total | counted in total (unchanged) |

Nothing is estimated or fabricated; when attribution is unavailable the figure is
omitted rather than shown as `0`. Duplicate counting across parallel, nested,
failed and retried tool operations was **not** investigated.

---

## 7. Prompt and execution bottlenecks

**Not attempted.** No claim is made about repeated repository scans, duplicate
model calls, context sizing, caching or handoffs.

## 8. Status bar

**Not attempted.** No redesign, no field-visibility settings.

---

## 9. Verification commands and exit codes

Toolchain: `bun` was absent from the sandbox and was installed to a user prefix
(`npm install -g bun` → `1.3.14`, matching `packageManager` in `package.json`).

```
$ node ./bin/ur.js --version
1.73.0 (UR-Nexus)                                            exit 0

$ node scripts/lint.mjs
UR lint passed                                               exit 0

$ node scripts/bundle.mjs
Bundling UR-Nexus v1.73.0 ... Bundled 4321 modules in 6389ms
OK: built and verified dist at v1.73.0 (86 occurrences).     exit 0

$ node scripts/package-check.mjs
Package check passed: tarball builds and shipped CLI starts.  exit 0

$ node scripts/release-check.mjs
Release check passed for UR-Nexus 1.73.0.                     exit 0

$ bun test test/providerApiKeyInput.test.ts test/tokenReporting.test.ts \
           test/questionChoiceLayout.test.ts
32 pass, 0 fail, 3 files                                      exit 0
```

Full suite, run in chunks because the sandbox kills any command past ~45 s:

| Files | Result | Exit |
| --- | --- | --- |
| 1–55 | 471 pass, 1 skip, 1 fail *(flaky, below)* | 1 |
| 56–85 | 265 pass, 0 fail | 0 |
| 86–115 | 221 pass, 1 fail *(flaky)* | 1 |
| 116–135 | 257 pass, 1 fail *(flaky, proven below)* | 1 |
| 136–148 | 83 pass, 0 fail | 0 |
| 149–175 (less `repoEdit*`) | 146 pass, 0 fail | 0 |
| 176–200 | 175 pass, 0 fail | 0 |
| 201–216 | 156 pass, 0 fail | 0 |

**≈1,774 passed · 1 skipped · 3 environment-timeout failures · 4 files not run.**

**The 3 failures are pre-existing sandbox-speed timeouts, not regressions.**
Each exceeds bun's default 5 s per-test cap on wall-clock only:

- `packageDependencies` "every external module … declared in package.json" —
  fails identically at baseline, **before** any change (7.9 s).
- `packageRuntime` "packed package CLI starts …" — fails identically at
  baseline (7.2 s).
- `promptPlanExecutor` — **proven** environment-bound: reverted to pristine
  `HEAD` via `git show HEAD:<path> > <path>` and it still failed; passes 4/4
  with `--timeout 30000` both with and without the changes.

**Not run:** `repoEditAst`, `repoEditMove`, `repoEditImports`, `repoEditReadOps`
— each exceeds the 45 s shell ceiling. `repoEditAst` and `repoEditMove` were
already failing at baseline for the same reason. Untouched by this change.

### Type checking — partial, stated honestly

`bun run typecheck` (`tsc --noEmit` over 2,464 files) and
`scripts/strict-core-check.mjs` **both exceed the sandbox's 45 s hard ceiling and
could not be run to completion.** Instead, a scoped `tsc` project over the
changed type-checked files and their full import closure completed in 33 s:

```
$ tsc -p <scoped config>            exit 2 — 59 diagnostics
errors in changed files: 0
```

All 59 are pre-existing and in untouched files: 56 × `TS2307` for modules absent
from this distribution (`src/commands/workflows/`, `src/utils/attributionHooks.ts`
— verified absent on disk), and 3 × `TS2305` `Module '"react"' has no exported
member 'use'` (React 19 code against `@types/react` `^18`). A further 108 ×
`TS2304 Cannot find name 'MACRO'` were an artefact of the scoped config omitting
the ambient declaration; adding `src/types/macro.d.ts` removed all 108.

`src/components/TextInput.tsx` and `src/components/ProviderFirstModelPicker.tsx`
carry `@ts-nocheck` and are **not** type-checked by any configuration. Their
correctness rests on the runtime tests and a `Bun.Transpiler` parse check (all 7
touched files: OK). **Removing `@ts-nocheck` was out of scope** — it would
surface unrelated pre-existing errors across both files.

---

## 10. Capability matrix

| Capability | Status |
| --- | --- |
| API key entry stays on one line | **Verified** — `resolveImplicitInputColumns(120)` renders a 48-char key with zero `\n` |
| Typed key preserves character order | **Verified** — regression test also reproduces the old reversal |
| Paste of long key not truncated | **Verified** — 403 chars round-trip |
| Newline / CRLF / control chars stripped | **Verified** |
| Masking preserved | **Verified** — `mask="*"` asserted at the call site |
| Secure storage round-trip | **Unchanged** — `providerCredentials.ts` not modified |
| Change key / disconnect | **Implemented, not runtime-verified** — logic is direct; no interactive TUI test exists |
| Esc returns from key entry | **Implemented, not runtime-verified** |
| Token figure omitted when unreported | **Verified** — 9 tests |
| Choices stay in one list past 4 options | **Verified** — 9 tests |
| Terminal-resize behaviour of the choice list | **Verified by unit** — pure function tested across heights; not rendered in a live terminal |
| Dynamic model refresh | **Working, pre-existing** — audited, unmodified, untested by me |
| Task list / subagent states | **Working, pre-existing** — 4/4 pass, unmodified |
| Tool schemas / Bash / timeouts / status bar | **Not attempted** |
| Whole-project type check | **Failed to run** — exceeds sandbox time ceiling |
| Interactive TUI verification | **Not tested** — no TTY in this sandbox |

---

## 11. External limitations

1. **45 s hard ceiling per shell command; background processes are reaped
   between calls.** Verified: a `setsid … & disown` heartbeat writing once a
   second stopped at 4 lines and no process survived. This is why the suite was
   chunked and why full `tsc` could not complete.
2. **No TTY.** Ink components cannot be driven, so keystroke-level behaviour of
   the key field, the manage menu and the choice list is verified through the
   pure functions and props they depend on, not by rendering.
3. **`bun` was not installed** and had to be added to a user prefix; `/usr/lib`
   is not writable.
4. **`node_modules` is incomplete** — `chromium-bidi` is unresolvable, so
   `bun build` on a single component fails through `playwright-core`. The full
   `scripts/bundle.mjs` succeeds because it externalises differently.
5. **Repo mount blocks `unlink`** by default.

---

## 12. Release commands — for you to run

Nothing was pushed, tagged, published or released.

```bash
cd ~/Desktop/ur3-dev/UR-1.65.0

# 1. Review
git diff -- src test CHANGELOG.md docs
git status --short

# 2. Re-verify locally, with a TTY and no 45 s ceiling
bun test                     # expect the 3 sandbox timeouts to pass on real hardware
bun run typecheck            # NOT run here — please run this before committing
bun run lint
bun run build
bun run release:check

# 3. Exercise the fix by hand
node ./bin/ur.js             # then: /model → pick an API-key provider → paste a key
                             # confirm: one line, correct order, masked, Esc returns
                             # reselect the provider → Change API key / Disconnect

# 4. Commit
git add -A
git commit -m "fix(provider,usage,questions): single-line API key entry, honest token reporting, continuous choice list

- provider key field passed no columns/cursorOffset/onChangeCursorOffset, so the
  input wrapped at 1 column and stored the key reversed; TextInput now resolves
  a width and owns the offset when a caller does not lift it
- strip control chars and line breaks from pasted keys before storage
- add change-key and disconnect actions; make Esc work on the key screen
- omit the token segment when the provider reports no usage instead of showing 0
- size the AskUserQuestion choice list to the terminal so choices past the
  fourth stay in one continuous list"

# 5. Tag and push
git tag -a v1.73.0 -m "UR-Nexus 1.73.0"
git push origin master
git push origin v1.73.0

# 6. GitHub release
gh release create v1.73.0 --title "UR-Nexus 1.73.0" --notes-file <(sed -n '/^## 1.73.0/,/^## 1.72.0/p' CHANGELOG.md | sed '$d')

# 7. npm — only after step 3 passes by hand
npm publish --access public   # runs prepack → release:check
```

**Do not publish before running `bun run typecheck` and the manual step 3.**
Neither was completed here.
