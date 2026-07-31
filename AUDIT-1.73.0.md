# UR-Nexus audit and fix report — 1.72.0 → 1.73.0

Every claim below has a command and an exit code behind it. Where something was
not done, or could not be verified, it says so.

---

## 1. Audit findings

Severity · root cause · evidence · impact · resolution.

### F1 — API key field renders one character per line · **Critical**

**Evidence.** `ProviderFirstModelPicker.tsx:364` was the only `<TextInput>` in
`src/` omitting `columns`, `cursorOffset`, `onChangeCursorOffset`. All three are
non-optional in `textInputTypes.ts:113`; the file's `// @ts-nocheck` (line 1)
hid it from the compiler.

**Root cause.** Three defects from one omission:
1. `columns: undefined` → `normalizeCursorColumns(undefined)` (`Cursor.ts:1119`)
   returns `2` because `Number.isFinite(undefined)` is false → `MeasuredText(text, 1)`
   → `wrapAnsi(text, 1, {hard:true})` → one grapheme per line.
2. `cursorOffset: undefined` → offset defaulted to 0 on every render, so each
   keystroke inserted at the head. Typing `sk-abc` stored **`cba-ks`**.
3. `onChangeCursorOffset: undefined` → `setOffset(...)` at `useTextInput.ts:452`
   and `:477` threw `TypeError` per keystroke.

**Impact.** No provider connectable through the in-app picker; any key that
appeared to save was corrupted.

**Resolution.** Fixed at the component boundary *and* the call site.
`TextInput.tsx` resolves a width from `TerminalSizeContext` when `columns` is
absent or `< 2`, and holds the offset internally when the caller does not lift
it — so no future call site can reproduce this.

### F2 — Pasted keys keep the newline from the copied line · **High**

`setProviderApiKey` applied only `.trim()` (`providerCredentials.ts:60`), which
does not remove interior line breaks. A bracketed paste carrying `\n` produced a
value that is not a legal HTTP header, failing later requests with an opaque
transport error instead of a `401`. New `apiKeyInput.ts` strips C0/C1 controls
and Unicode line separators and reports interior whitespace rather than
silently accepting it. Keys are never truncated or re-cased.

### F3 — No way to change or remove a stored key · **Medium**

`clearProviderApiKey` existed and worked (`providerCredentials.ts:106`) but had
no UI caller. A `manage` step now offers *Continue to models* / *Change API key*
/ *Disconnect*, shown only when `getProviderApiKeySource(...) === 'stored'` — an
env-var key belongs to the shell and is left alone.

### F4 — Key-entry screen advertised an Esc that did nothing · **Low**

`handleKeyCancel` was defined but never referenced while the footer rendered
`Esc → back`. The text input owns escape, so a `useInput` scoped to
`isActive: step === 'connect'` now handles it.

### F5 — `0 tokens` printed beside real tool counts · **Medium**

`AgentTool/UI.tsx:376` built `formatNumber(totalTokens) + ' tokens'`
unconditionally. When a provider reports no usage the pipeline substitutes
`EMPTY_USAGE` (all zeros), so the UI rendered `Done (7 tool uses · 0 tokens · 1m 4s)`.
Absent and zero usage were indistinguishable by value. `hasReportedTokenUsage()`
and `formatReportedTokens()` in `tokens.ts` treat an all-zero block as
unreported and omit the segment.

### F6 — Choices past the fourth detach from the list · **Medium**

`QuestionView.tsx:207,230` rendered `<Select>`/`<SelectMulti>` with no
`visibleOptionCount`; the default is 5 (`select.tsx:219`,
`use-select-state.ts:128`). `QuestionView` appends a synthetic `__other__`
entry, so four choices already hit the window and the tail landed below the
footer divider. `choiceListLayout.ts` sizes the list to the terminal.

### F7 — Cached tokens counted twice, reasoning tokens discarded · **High**

**Evidence.** `openaiCompatible.ts:418` mapped only `prompt_tokens`/
`completion_tokens`, hardcoding both cache counters to `0`.
`streamingAdapters.ts:1258` did the same. `usageFromOpenAIResponses` mapped
`cached_tokens` into `cache_read_input_tokens` *without* subtracting it from
`input_tokens`.

**Root cause.** The internal counters are disjoint and summed by
`getTokenCountFromUsage`, but OpenAI-shaped providers report `prompt_tokens` as
the *whole* input including `prompt_tokens_details.cached_tokens`. Copying
across verbatim either loses the field or counts the cached prefix twice.
`completion_tokens_details.reasoning_tokens` is already inside
`completion_tokens` and must never be added to output.
([OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching),
[OpenRouter usage accounting](https://openrouter.ai/docs/use-cases/usage-accounting),
[Gemini token counting](https://ai.google.dev/gemini-api/docs/generate-content/tokens))

**Resolution.** One `usageNormalization.ts` pass for all four mapping sites.
Verified invariant: the derived total equals the provider's own `total_tokens`.

### F8 — OpenRouter returns no usage at all · **High**

OpenRouter omits the usage block unless `usage: { include: true }` is sent. It
never was — the direct cause of "0 tokens" on that provider. Now sent for
`openrouter` only.

### F9 — Model metadata discarded; free tier invisible · **Medium**

`modelDefinitionsFromNames` set `displayName = id` and a fixed description,
dropping `name`, `pricing` and `context_length`. OpenRouter rotates which models
are free and that is only visible in `pricing`. `modelCatalog.ts` reads it per
refresh, orders free-first / deprecated-last, and always shows the full id.

### F10 — Duplicate discovery requests; cache shown as current · **Medium**

No in-flight de-duplication and no cache age. Concurrent selections issued
parallel fetches whose responses could land out of order. `RequestCoalescer`
collapses them; `describeCacheAge` labels a stale list.

### F11 — `$schema` and `$ref` forwarded to every provider · **High**

`sanitizeJsonSchema` existed in three identical copies
(`openaiCompatible.ts`, `standardAPI.ts`, `ollama.ts`) and deleted four vendor
keys **at the root only**. Verified by probe: zod v4 emits
`"$schema": "https://json-schema.org/draft/2020-12/schema"` on every tool schema
and `{"$ref": "#"}` for a recursive one. Gemini's Schema type (OpenAPI 3.0.3
derived) supports none of `$schema`, `$ref`, `additionalProperties`, or a null
type, and `toGeminiTools` forwarded the Anthropic schema unchanged.
([Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling))
New `toolSchema.ts` strips meta/vendor keys at every depth, inlines local
references, narrows the Gemini dialect, and validates before sending.

### F12 — Bash lost the working directory and misreported exit codes · **High**

`bashProvider.ts:186` chained `pwd -P >| file` after the command with `&&`:
- it never ran after a failing command, so a preceding `cd` was lost and the
  session silently continued in the old directory;
- on success the shell's exit status became `pwd`'s, so a command that removed
  its own working directory reported failure despite succeeding;
- a command containing `exit` terminated the shell before the capture ran.

Now captured from an `EXIT` trap, which fires on all three paths and does not
disturb the exit status. All three are covered by real-bash tests.

### F13 — A stalled stream had no timeout at all · **High**

`fetchWithProviderReliability` clears its total-request timeout in `finally`,
which for a streaming request is the moment the *headers* arrive. A provider
that accepted the request and then went silent left the stream open
indefinitely — the UI kept showing work in progress and nothing failed or
completed. `streamIdleTimeout.ts` adds an inactivity watchdog (distinct from the
total-run timeout: a long stream that keeps producing is never interrupted).

### F14 — Duplicate questions/options rejected rather than repaired · **Medium**

The schema's `UNIQUENESS_REFINE` (`AskUserQuestionTool.tsx:140`) failed the
whole call on a duplicate label. That is the "initial failed request followed by
a retry" pattern: a recoverable formatting slip cost a round trip and showed the
user nothing. `normalizeQuestions.ts` de-duplicates in the preprocessor;
genuinely unaskable questions (fewer than two distinct labels) are still
rejected, because no repair can invent a choice.

### F15 — Status bar: fixed fields, no width awareness, pending counted as active · **Medium**

`buildDefaultStatusBar` composed a fixed sequence with no visibility control and
no width handling — the terminal truncated whatever did not fit, so the
rightmost fields vanished with no indication. `StatusLine.tsx:238` counted
`pending` tasks as active, overstating progress. Rebuilt around a field registry
with priorities; lowest-priority fields drop first.

---

## 2. Changed files

| File | Purpose |
| --- | --- |
| `src/components/TextInput.tsx` | Resolve wrap width from terminal size; internal cursor offset when uncontrolled |
| `src/components/ProviderFirstModelPicker.tsx` | Width/offset/setter on the key field; manage step; working Esc; ctrl+r retry; abortable discovery; terminal-sized model window |
| `src/services/providers/apiKeyInput.ts` *(new)* | Single-line key normalisation and validation |
| `src/services/providers/modelCatalog.ts` *(new)* | Model metadata, free-tier detection, ordering, cache age, request coalescing |
| `src/services/providers/providerRegistry.ts` | Cache timestamps, coalesced discovery, catalog-backed API discovery |
| `src/services/api/usageNormalization.ts` *(new)* | Disjoint counter partitioning for OpenAI / Responses / Gemini |
| `src/services/api/toolSchema.ts` *(new)* | Schema preparation, `$ref` inlining, Gemini dialect, pre-send validation |
| `src/services/api/streamIdleTimeout.ts` *(new)* | Streaming inactivity watchdog |
| `src/services/api/openaiCompatible.ts` | Normalised usage; OpenRouter `usage.include`; shared schema prep |
| `src/services/api/standardAPI.ts` | Shared schema prep; Gemini dialect for `functionDeclarations` |
| `src/services/api/ollama.ts` | Shared schema prep |
| `src/services/api/providerHttp.ts` | Idle timeout wired into streaming responses |
| `src/services/api/streamingAdapters.ts` | All three usage mappers routed through normalisation |
| `src/utils/tokens.ts` | `hasReportedTokenUsage`, `formatReportedTokens`, `getReasoningTokens` |
| `src/tools/AgentTool/UI.tsx` | Omit the token segment when usage is unreported |
| `src/tools/AskUserQuestionTool/normalizeQuestions.ts` *(new)* | Duplicate repair + payload problem description |
| `src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx` | De-duplicate in the preprocessor |
| `.../AskUserQuestionPermissionRequest/choiceListLayout.ts` *(new)* | Terminal-aware choice sizing |
| `.../AskUserQuestionPermissionRequest/QuestionView.tsx` | Computed count for both select modes |
| `src/utils/statusBarFields.ts` *(new)* | Field registry, defaults, visibility resolution |
| `src/utils/statusBar.ts` | Field-based, width-aware, de-duplicated composition |
| `src/components/StatusLine.tsx` | Live task/state/width data; pending no longer counted as active |
| `src/commands/status-bar/` *(new)* | `/status-bar` picker + persistence |
| `src/commands.ts` | Register `/status-bar` |
| `src/utils/settings/types.ts` | `statusBarFields` setting |
| `src/utils/shell/bashProvider.ts` | `EXIT`-trap cwd capture |
| `technical/03-slash-commands.md`, `technical/06-configuration.md` | Required doc coverage for the new command and setting |
| `test/statusBar.test.ts` | Updated to the requested completed-of-total format (see §10) |
| 10 new `test/*.test.ts` | 197 tests |

---

## 3. Provider API input and dynamic model refresh

**API input — verified.** Sanitisation covers typed keys, trailing `\n`,
`\r\n`, embedded newlines, tabs, interior spaces, a 403-character key, and
empty/whitespace-only input. Cursor position, editing, paste, deletion and
masking are exercised through `Cursor` at the resolved width; secure storage
(`providerCredentials.ts`) was **not modified**.

**Model refresh — verified by unit test, not against live endpoints.**
Discovery already implemented live → cache → static with per-provider official
endpoints; this release adds metadata, ordering, free-tier detection, cache
ageing and request coalescing. Loading, empty, error and retry states are wired
in the picker. **No live provider call was made from this sandbox** — there are
no credentials here, so the endpoint contracts are covered by fixtures shaped
from the official docs, not by a real request.

---

## 4. Task list and subagent behaviour — before and after

**Before / after are identical for the executor. It was audited, not changed.**
`test/promptPlanExecutor.test.ts` already asserts the four requested behaviours
and passes 4/4 with adequate time:

```
(pass) running tasks update correctly and completed tasks are checked
(pass) failed tasks render clearly as failed, not unchecked
(pass) does not emit duplicate consecutive boards
(pass) final board is clean with no duplicate separators
```

**Changed:** the status bar's reading of that state. `StatusLine.tsx` counted
`pending` as active; it now separates running/pending/completed and reports
completed-of-total.

**Not investigated:** fresh-list-per-prompt, never-append-to-a-completed-list,
parallel subagent scheduling and file-conflict avoidance. No code in those paths
was changed.

---

## 5. Tool-schema, Bash, timeout and questions-UI fixes

All four implemented — F11, F12, F13, F6/F14 above. 24 + 32 + 17 + 28 tests.

---

## 6. Token accounting — before and after

| Condition | Before | After |
| --- | --- | --- |
| Provider reports no usage | `7 tool uses · 0 tokens · 1m 4s` | `7 tool uses · 1m 4s` |
| OpenRouter | no usage block requested → always 0 | real usage |
| `prompt_tokens 1000`, `cached 800` | input 1000 + cache_read 0 → total 1000, cache lost | input 200 + cache_read 800 → total 1050 = provider total |
| Responses `input 2000`, `cached 1500` | input 2000 + cache_read 1500 → **3500** (double count) | input 500 + cache_read 1500 → 2100 = provider total |
| `reasoning_tokens 850` | discarded | preserved, shown as `(850 reasoning)`, never added to output |
| Gemini `cachedContentTokenCount` | discarded | separated from prompt tokens |

Nothing is estimated or fabricated. **Not investigated:** aggregation across
*nested* and *retried* tool operations specifically; the invariant is proven for
sequential turns and for absent/failed turns.

---

## 7. Prompt and execution bottlenecks

**Two fixed, the rest not attempted.**
- Duplicate model-list requests eliminated (`RequestCoalescer`).
- A stalled stream no longer blocks the UI indefinitely.

**Not attempted:** repeated repository scans, re-reading unchanged files,
duplicate model/tool calls, oversized context, repeated instructions,
unnecessary planning/handoffs, caching, blocking UI operations, summary
fidelity, prompt transformations. No code in those paths was changed.

---

## 8. Status bar redesign and settings

14 fields: attention, state, model, task, task progress, agents, tool, context,
tokens, runtime, provider, mode, branch, update. Each has a priority; the bar
drops lowest-first to fit rather than being cut mid-word. A field with no data
is omitted, never rendered as `0`. Two fields resolving to the same text render
once.

Defaults: on except `tokens` and `runtime`. `/status-bar` toggles them with
space and saves with enter, persisted to `statusBarFields` in user settings.
Unknown ids in a settings file are ignored rather than breaking the bar.

**Verified:** every width from 10 to 200 stays within bounds; long model and
branch names are clipped; identical input yields identical output across 50
renders. **Not verified:** live terminal resizing and flicker — no TTY here.

---

## 9. Measurable evidence

- Bundle: 4321 → 4330 modules; all new imports resolve.
- Type check of the 8 self-contained new modules: **0 errors, exit 0, 2.5s**.
- `usageAccounting` proves derived total == provider total for all three shapes.
- `statusBarFields` asserts bounds across 191 terminal widths.
- Bash suite spawns real `/bin/bash` 32 times; the `exit`-inside-command case
  fails on the pre-fix construction and passes on the trap.

---

## 10. Verification commands, outputs, exit codes

`bun` was absent from the sandbox; installed to a user prefix
(`npm install -g bun` → 1.3.14, matching `packageManager`).

```
$ node ./bin/ur.js --version           1.73.0 (UR-Nexus)                    exit 0
$ node scripts/lint.mjs                UR lint passed                       exit 0
$ node scripts/bundle.mjs              Bundled 4330 modules; dist v1.73.0   exit 0
$ node scripts/package-check.mjs       tarball builds and shipped CLI starts exit 0
$ node scripts/release-check.mjs       Release check passed for 1.73.0      exit 0
$ tsc -p <8 new leaf modules>          0 errors                             exit 0
```

Full suite, chunked (the sandbox kills any command past ~45 s):

| Files | Result | Exit |
| --- | --- | --- |
| 1–45 | 463 pass, 0 fail | 0 |
| 46–80 | 248 pass, 1 skip, 0 fail | 0 |
| 81–110 | 223 pass, 0 fail | 0 |
| 111–140 | 360 pass, 0 fail | 0 |
| 141–165 (less `repoEdit*`) | 145 pass, 0 fail | 0 |
| 166–195 | 249 pass, 0 fail | 0 |
| 196–223 | 247 pass, 0 fail | 0 |
| 10 new suites | 197 pass, 0 fail | 0 |

**≈1,935 passed · 1 skipped · 0 failed.**

**Skipped:** 1 pre-existing skip in files 46–80 (not mine).
**Not run:** `repoEditAst`, `repoEditMove`, `repoEditImports`, `repoEditReadOps`
— each exceeds the 45 s shell ceiling; `repoEditAst`/`repoEditMove` were already
failing at baseline on wall-clock alone. Untouched by this change.

**Three failures I introduced and then fixed, disclosed in full:**
1. `commandRegistryIntegrity` — `/status-bar` was not in the slash-command
   reference. Fixed by documenting it.
2. `settingsDocCoverage` — `statusBarFields` was not in the configuration doc.
   Fixed by documenting it.
3. `testTimeoutBudgets` — my bash tests declared 15 s/20 s per-test budgets,
   which silently override the release gate's `--timeout 120000` and fail on a
   slow runner. The repo's own guard caught it; budgets removed.

**One pre-existing test I changed:** `test/statusBar.test.ts` asserted
`tasks: 1/3 active`. The request specifies "completed and total tasks", so that
assertion encoded the behaviour I was asked to change. Updated to `2/3 done` +
`1 running`. **This is the only existing test whose expectations I altered.**

### Type checking — partial, stated plainly

`bun run typecheck` (`tsc --noEmit` over 2,464 files) and
`scripts/strict-core-check.mjs` **both exceed the sandbox's 45 s hard ceiling and
were not run to completion.** Scoped projects were used instead:

- 8 self-contained new modules: **0 errors, exit 0**.
- `statusBar.ts` + `statusBarSettings.ts` + `bashProvider.ts` + closure:
  **59 errors, 0 in my files** — 56 × `TS2307` for modules absent from this
  distribution (`src/commands/workflows/`, `src/utils/attributionHooks.ts` —
  verified absent on disk) and 3 × `TS2305` `Module '"react"' has no exported
  member 'use'` (React 19 code against `@types/react` ^18). Both pre-existing.

This scoped check **did** catch one real error in my code
(`status-bar.tsx:48`, union narrowing under `strictNullChecks: false`), which I
fixed before the run above.

`TextInput.tsx` and `ProviderFirstModelPicker.tsx` carry `@ts-nocheck` and are
not type-checked by any configuration; their correctness rests on the runtime
tests and the bundler. Removing `@ts-nocheck` was out of scope.

---

## 11. Capability matrix

| Capability | Status |
| --- | --- |
| API key stays on one line | **Verified** |
| Typed key preserves order | **Verified** (test also reproduces the old reversal) |
| Long key not truncated; newlines/controls stripped; masking kept | **Verified** |
| Secure storage round-trip | **Unchanged** — not modified |
| Change key / disconnect / Esc back | **Implemented, not runtime-verified** — no TTY |
| Token segment omitted when unreported | **Verified** |
| Cached prefix not double counted | **Verified** — derived total == provider total |
| Reasoning tokens preserved, not added to output | **Verified** |
| OpenRouter usage requested | **Verified** (request shape; not against live API) |
| Free-model detection, ordering, full ids | **Verified** on documented fixtures |
| Duplicate discovery suppressed; cache age labelled | **Verified** |
| Live provider endpoints | **Not tested** — no credentials in this sandbox |
| Choices in one continuous list | **Verified** |
| Duplicate questions/options repaired not rejected | **Verified** |
| `$schema`/`$ref`/vendor keys stripped; Gemini dialect | **Verified** |
| Schema validated before send; clear failure | **Verified** |
| Every built-in tool through a real model→tool path | **Not tested** — needs a live provider |
| Bash exit codes, cwd, quoting, unicode, heredocs, pipes, large output, signals | **Verified** — 32 real-bash tests |
| Interactive/background/parallel Bash | **Partial** — background and stdin covered; interactive not |
| Stream inactivity timeout | **Verified** — 17 tests |
| Model/tool/command/network/total timeouts separated | **Partial** — inactivity added and separated from total; per-tool and per-command budgets not restructured |
| Status bar fields, priorities, widths, persistence | **Verified** |
| Live terminal resize / flicker | **Not tested** — no TTY |
| Task list & subagent executor | **Working, pre-existing** — audited, unmodified |
| Fresh-list-per-prompt, parallel subagents | **Not attempted** |
| Prompt/execution bottleneck audit | **Not attempted** |
| Whole-project type check | **Failed to run** — exceeds sandbox ceiling |

---

## 12. Remaining external limitations

1. **45 s hard ceiling per shell command; processes are reaped between calls.**
   Proven: a `setsid … & disown` heartbeat writing once a second stopped at 4
   lines with no surviving process. This is why the suite is chunked and why
   full `tsc` could not complete.
2. **No TTY.** Ink components cannot be driven, so keystroke-level behaviour of
   the key field, manage menu, `/status-bar` picker and choice list is verified
   through the pure functions and props they depend on, not by rendering.
3. **No provider credentials.** Live model discovery, real tool-call round trips
   and real usage payloads were not exercised against any provider.
4. **`bun` absent**; installed to a user prefix (`/usr/lib` not writable).
5. **`node_modules` incomplete** — `chromium-bidi` unresolvable, so `bun build`
   on a single component fails through `playwright-core`. Full `scripts/bundle.mjs`
   succeeds because it externalises differently.

---

## 13. Protected areas

Not modified, not refactored, not test-changed. No file under
`src/tools/BashTool/`, `src/services/safety/`, `src/utils/sandbox/`,
`src/utils/shell/readOnlyCommandValidation.ts`, or any permission/approval path
appears in the diff. `bashProvider.ts` was changed only in its cwd-capture and
exit-status handling; the extglob-disable line and every security guard around
it are untouched. No new restriction, block, approval requirement or hardening
mechanism was added.

---

## 14. Release commands — for you to run

Nothing was pushed, tagged, published or released.

```bash
cd ~/Desktop/ur3-dev/UR-1.65.0

# 1. Review
git diff -- src test technical CHANGELOG.md
git status --short

# 2. Re-verify on real hardware, with a TTY and no 45s ceiling
bun test                     # expect the repoEdit* files to pass here
bun run typecheck            # NOT completed in the sandbox — run this
bun run lint
bun run build
bun run release:check

# 3. Exercise by hand (needs a TTY; not possible in the sandbox)
node ./bin/ur.js
#   /model  → pick an API-key provider → paste a key
#             confirm: one line, correct order, masked, Esc returns
#   reselect that provider → Change API key / Disconnect
#   /model  → ctrl+r refreshes; free models listed first with full ids
#   /status-bar → toggle fields, save, confirm they persist across restart

# 4. Commit
git add -A
git commit -m "fix(provider,usage,schema,bash,status): single-line key entry, honest token accounting, portable tool schemas, reliable bash exit/cwd, field-based status bar

- provider key field passed no columns/cursorOffset/onChangeCursorOffset, so
  input wrapped at 1 column and stored the key reversed
- strip control chars and line breaks from pasted keys; add change/disconnect
- partition provider usage counters so a cached prefix is not counted twice;
  preserve reasoning tokens; request OpenRouter usage accounting
- omit the token segment when the provider reports no usage instead of '0'
- read model name, pricing and context length from /models; surface the
  rotating free tier; coalesce duplicate discovery; label stale cache
- strip \$schema/\$ref/vendor keys at every depth; narrow the Gemini dialect;
  validate schemas before sending
- capture bash cwd from an EXIT trap so a failing or exiting command still
  records its directory and the reported code is the command's own
- add a streaming inactivity timeout so a silent provider fails instead of
  leaving the UI on 'working'
- repair duplicate questions/options instead of failing the call
- rebuild the status bar around prioritised fields with /status-bar settings"

# 5. Tag and push
git tag -a v1.73.0 -m "UR-Nexus 1.73.0"
git push origin master
git push origin v1.73.0

# 6. GitHub release
gh release create v1.73.0 --title "UR-Nexus 1.73.0" \
  --notes-file <(sed -n '/^## 1.73.0/,/^## 1.72.0/p' CHANGELOG.md | sed '$d')

# 7. npm — only after steps 2 and 3 pass
npm publish --access public   # runs prepack → release:check
```

**Do not publish before `bun run typecheck` completes and step 3 passes by
hand.** Neither was possible here.
