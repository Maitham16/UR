# Changelog

## 1.65.1

- Fixed `ur selftest run` reporting 0/5 anywhere but the UR repo. The drill
  runner spawned `./bin/ur.js`, a path relative to the current directory, so
  every drill failed instantly with an empty detail — which reads as five
  broken features rather than one broken path. It now re-spawns
  `process.execPath` with `process.argv[1]`, the exact pair this process was
  launched with, so it works from any directory and for a global install.
- Every existing test ran `bun test` from the repo root, where the relative
  path happens to exist, so all of them stayed green while the command was
  unusable in practice. Added a test that runs the drills from a temp
  directory; verified it fails against the old code and passes against the fix.

## 1.65.0

- The release gate now asks the registry whether the packed dependency ranges
  can actually be installed. This is the check that was missing when 1.61.2
  through 1.64.0 shipped uninstallable: the tarball built, the CLI started,
  every test passed and the gate was green, because all of it ran against the
  working tree and none of it asked npm whether `playwright-core@^1.64.0`
  exists. The failure only ever appeared on a user's machine.
- A dependency range equal to the UR version is rejected outright, resolvable
  or not. That equality is the fingerprint of a version bump that matched too
  much, which is exactly how the break happened.
- Verified by reintroducing the historical break: exit 1 with
  `playwright-core@^1.64.0 does not resolve: npm error code E404`, and exit 0
  on a clean tree.

## 1.64.1

- Fixed `npm install -g ur-agent` failing with
  `No matching version found for playwright-core@^1.64.0`. Releases 1.61.2,
  1.62.0, 1.63.0 and 1.64.0 were uninstallable: the version bump was a
  `sed 's/OLD/NEW/g' package.json`, and `playwright-core` happened to sit at
  `^1.61.1` — the same version UR was on — so the substitution rewrote the
  dependency too, then cascaded with every later bump to a version that does
  not exist. The built artifact and every test were fine; only `npm install`
  failed, on other people's machines.
- Version bumping is now `scripts/version-bump.mjs`, which edits JSON files as
  JSON and touches only the top-level `version` key, and uses anchored patterns
  for text files that cannot match a dependency range.
- Added `test/dependencyIntegrity.test.ts`: no dependency range may equal the
  UR version, which is the exact fingerprint of a bump that matched too much.
  Verified it fails when the historical break is reintroduced.

## 1.64.0

- Tool-result pruning now announces itself. It changed context silently, so
  there was no way to confirm it fired or to attribute a missing detail to it —
  the same defect memory suggestions had when they went to stderr. A prune now
  prints what it removed and how many tokens that freed.
- Corrected the fan-out drill, which tested the wrong limit. Asking for 30
  subagents in one turn cannot reach `agents.maxConcurrent`, because
  `MAX_CONCURRENT_TOOLS` caps a single turn at 8 — so the run reported an
  unrelated cap and I mistook that for the governor being unreachable. It is
  reachable by nesting: 8 roots, each spawning more, hits 20 and fires naming
  the setting. The drill now exercises that path.
- Added a manual drill for tool-result pruning. It only fires inside a live
  query loop, so no automated drill can reach it.
- Added opt-in signing of the memory integrity manifest via
  `UR_MEMORY_INTEGRITY_KEY`. Unsigned, anyone who can write a memory file can
  rewrite the manifest to match and pass verification; the HMAC raises that to
  needing the key. Off by default because a key stored beside the data it
  protects is theatre.
- `verify` exits non-zero on an invalid signature — the first implementation
  detected forgery and still exited 0, because a forged manifest updates the
  digests so every tamper count reads zero. A manifest that is signed but
  unverifiable also fails, rather than passing on an unperformed check.

## 1.63.0

- Added size-triggered pruning of superseded tool results
  (`context.pruneToolResults`). UR already had the clearing machinery, but
  nothing external could reach it: cached microcompact is internal-only and
  returns unchanged messages in shipped builds, and the time-based trigger
  needs an hour of idling *and* a GrowthBook flag that a local install never
  receives. An active session therefore pruned nothing and ran until autocompact
  replaced the whole history with a summary.
- Pruning fires only when it would free at least 20k tokens, because clearing
  invalidates the cached prefix and a small cleanup costs more in cache misses
  than it reclaims. Short sessions are untouched; a 40-read session frees ~64k.
- The most recent 8 compactable results are a protected zone and are never
  cleared, so the model keeps the working set it is reasoning about.
  `keepRecent` is floored at 1: clearing everything would leave no working
  context, and `slice(-0)` would paradoxically keep all of it.
- Configured through settings rather than GrowthBook, so it can actually be
  turned off or tuned.

## 1.62.0

- `ur agent-inspect --costs` now labels each row with what the agent was
  actually doing. A real 62-agent fan-out reported opaque hex ids, so you could
  see that one agent burned 810k input tokens — 14% of the session — without
  being able to tell which of your subagents it was. The description already
  existed in the `agent-{id}.meta.json` sidecar and was simply never read.
- Agents with missing or malformed metadata still appear, keyed by id.
  Historical sessions predate the description field, and dropping those rows
  would lose spend in order to avoid losing a label.

## 1.61.2

- Fixed `ur agent-inspect --costs` reporting nothing, always. It resolved the
  *live* session, but every `ur` invocation mints a new session id, so bare it
  pointed at a session created milliseconds earlier that had by definition
  spawned nothing — two consecutive runs in the same directory produced two
  different empty session ids and no data either time. It now prefers the live
  session when it has transcripts (the `/agent-inspect` case, inside a session
  that already fanned out) and otherwise falls back to the most recent session
  in the project that does.
- The transcript writer was never at fault: Agent-tool subagents do write
  `agent-*.jsonl`. Only the reader's choice of session was wrong.

## 1.61.1

- Fixed secondary model queries failing on any Ollama setup whose session model
  is not `qwen2.5-coder:7b`. `getSmallFastModel()` fell back to the compiled
  default when auto-routing was off or no model list had been discovered, so a
  user running `kimi-k2.7-code:cloud` had every WebFetch summarisation and
  classifier call rejected with "Model qwen2.5-coder:7b is not available for
  provider ollama". A fallback to a model the user may never have pulled is a
  guaranteed failure; it now falls back to the session model, which is
  guaranteed to exist.
- WebFetch no longer returns a failed summarisation as if it were the page.
  The error text was passed through as the fetch result, so the evidence ledger
  recorded "API Error: Provider ollama ..." as the content of example.com and a
  `--check` against real page text correctly found nothing. It now throws, and
  the failure is visible as a failed tool call.

## 1.61.0

- Added `ur selftest`, end-to-end drills for the gap that produced every
  serious defect in recent releases: a module that is correct while something
  between it and the user is not — a wire format, a CLI registration, an exit
  code, a wording choice. The drills deliberately do not import the modules;
  they spawn the shipped binary against real directories and assert on what a
  user would see.
- Five drills run automatically and cover the four defects that reached you:
  memory integrity reporting an unchecked store as verified, the trajectory
  gate printing FAILED while exiting 0, `--costs` hiding which directory it
  searched, and per-agent attribution itself.
- Drills that need a live model cannot be automated, so they are emitted as
  prompts with the specific observation that separates working from broken —
  "it seemed fine" is how the screenshot bug survived its first report.
- `ur selftest run` exits non-zero on failure, and a test asserts the drills
  actually fail when pointed at a broken binary. A self-test that cannot fail
  is decoration.

## 1.60.1

- `ur memory-integrity verify` no longer reports an empty or missing store as
  verified. It printed "verified — 0 file(s) match the recorded digests" for an
  empty directory, and that identical reassurance would have appeared for a
  mistyped path or a store an attacker had just emptied. Zero files checked is
  not evidence of integrity, so empty and nonexistent stores now say exactly
  that and name the path.
- The exit code tracks tampering rather than validity, so an empty or
  unbaselined store still exits 0. Failing on it would fire for every fresh
  install and train the user to ignore the exit code.
- `ur agent-inspect --costs` names the directory it searched. "No subagent
  transcripts found for this session" was indistinguishable from having
  resolved the wrong path.

## 1.60.0

- Added `ur memory-integrity`, tamper-evidence for the file-backed memory
  stores. Project task memory was hash-chained and could prove tampering; the
  auto-memory and team-memory directories had nothing, and their contents are
  injected straight into context. A chain over append-only lines does not
  describe a mutable file tree, so this is a digest manifest: it detects files
  modified, deleted outside UR, and — the case that matters most — dropped in
  by something else, which is an injection vector with a direct path to the
  model. `quarantine` moves suspect files aside rather than deleting them, and
  `verify` exits non-zero so it can gate.
- Deletion is now provable: removing an entry rewrites the manifest, so a
  previously-deleted memory that reappears is reported as untracked instead of
  being quietly reloaded.
- The release gate now grades recorded eval trajectories and writes versioned
  per-category scores to `dist-release/trajectory-scores.json`. A run that
  edited files without verifying, issued a destructive command, or looped on an
  identical failure fails the gate even when its conclusion was correct.
- Added `test/settingsDocCoverage.test.ts`: every `SettingsSchema` key must
  appear in `technical/06-configuration.md`. It found six undocumented settings
  (`worktree`, `channelsEnabled`, `allowedChannelPlugins`, `urMdExcludes`,
  `pluginTrustMessage`, `$schema`), now documented. Command coverage was
  already enforced; settings coverage was not, which is how they slipped.
- Refreshed `ur agent-trends`, which still listed the claim-to-source ledger,
  trajectory grading and multimodal capability warnings as future work after
  they shipped — leaving UR misreporting its own coverage.

## 1.59.0

- Added `ur sources`, a claim-to-source ledger. `wrapUntrusted` already stamped
  every untrusted block with a nonce and a source label, but discarded both the
  moment the block reached the model, so there was no way to audit what web or
  MCP content an answer was built on. Recording happens inside `wrapUntrusted`
  itself — the single choke point every untrusted block passes through, so the
  ledger cannot miss one. `--check "<span>"` reports which fetched source
  contains a span, and says plainly when none does, which is the useful signal:
  that claim was not grounded in anything UR retrieved. This is the automatic
  counterpart to the existing `/claim-ledger`, which records claims a human or
  the agent asserts by hand; `ur sources` records what actually entered context
  without anyone having to remember to log it.
- The ledger is in-memory and capped. Persisting it would create a second
  on-disk store of third-party content — including whatever a prompt-injection
  attempt put there — with its own retention and deletion obligations.
- Added `ur grade-trajectory`, which grades a run on how it worked rather than
  what it concluded: unverified changes, edits to files never read, destructive
  commands, and loops on identical failures. Every rule is deterministic and
  read from the transcript; no model grades another model, because a judge that
  can hallucinate turns a CI gate into a coin flip.
- `--min-score` sets `process.exitCode`, so the gate genuinely fails a CI step.
  Returning an `exitCode` field is silently ignored by `runLocalTextCommand`,
  which exits with `process.exitCode ?? 0` — the first implementation printed
  FAILED and exited 0.

## 1.58.1

- Unified vision-capability detection behind
  `src/utils/model/visionCapability.ts`. Three implementations disagreed: the
  Ollama adapter's `modelCapabilityEnabled` returned `has(x) ?? true`, so a
  model advertising nothing was assumed capable; `ur model-doctor` matched
  names privately; the router read a precomputed flag. The binary shape was the
  defect — absence of evidence was reported as evidence, in opposite directions.
- Vision support is now tri-state. A capability list is authoritative both ways;
  a recognised name can confirm support but never rule it out; anything else is
  `unknown`. Images are withheld only on a confirmed no, so servers without a
  capabilities endpoint keep working, and the note distinguishes "this model
  cannot see" from "support could not be confirmed" — advice that had been
  backwards for models like `kimi-k2.7-code:cloud`.

- Fixed choice menus where all three fields said the same thing. Neither the
  schema nor the tool prompt stated that `header`, `label` and `description`
  must carry different information, so the header restated the question and the
  description paraphrased the label — leaving the one field with room to be
  informative saying nothing. Each field now has a defined job, and the prompt
  carries a contrasted bad/good example rather than an abstract instruction.

## 1.58.0

- Added per-agent cost and token attribution: `ur agent-inspect --costs`.
  `stats.ts` already read every `{sessionId}/subagents/agent-{agentId}.jsonl`
  transcript, but only to fold those tokens into a single total, so a fan-out
  that consumed most of a session's budget was indistinguishable from one that
  did not. Rows are attributed by filename rather than by joining turns back to
  the spawning `tool_use`, because the Agent tool's input carries no agent id
  and any such join would be a guess.
- The breakdown reports tokens and omits the money column on a local runtime.
  `calculateUSDCost` returns 0 for Ollama, so a cost column would have rendered
  as a wall of `$0.00` and read as a broken feature; cost appears only when a
  provider actually billed.

## 1.57.5

- Fixed the release gate failing on `repoEditImports`. The gate runs
  `bun test --timeout 120000`, but a per-test budget silently overrides that
  global, and this test declared 15s while its body — which builds a
  TypeScript program to resolve imports — takes about 21s on a 2-core CI
  runner. Every assertion passed; the release went red on timing alone.
- Added a guard so this cannot recur: a test now fails if any test file
  declares a per-test budget below 60s. Both budgets that broke CI (15s and
  20s) are flagged by it; ordinary call arguments are not.

## 1.57.4

- Fixed slash command arguments being silently truncated. `parseArguments`
  kept only the string tokens shell-quote returned, but shell-quote classifies
  `left?` and `src/*.ts` as globs and `&`, `>`, `(` as operators — so
  `/btw what is left?` arrived as "what is", and `read src/*.ts` lost the path
  entirely. These are command arguments, usually plain English, not a shell
  pipeline; the literal text is now recovered.
- `/btw` now passes the question through verbatim instead of re-joining
  tokens, which collapsed runs of whitespace and respaced punctuation even
  when no token was dropped. Same for the tail of `continue` and `rename`.
- Memory suggestions now render in the transcript. They were written to
  `process.stderr`, which under the Ink REPL lands outside the rendered frame
  and is overwritten on the next repaint, so the feature was effectively
  invisible. stderr remains the fallback for headless `ur -p`.
- Extended the untrusted-content boundary to MCP tool results. A GitHub issue
  body or Jira comment arriving through an MCP server is the same trust class
  as a web fetch and a higher-volume channel, but only WebFetch and WebSearch
  were wrapped. Text blocks are wrapped in place so images and array structure
  survive. The configured permission-prompt tool is exempt via
  `trustedControlChannel`: its result is JSON-parsed into an allow/deny
  decision and is UR's control plane, not model-facing context.

## 1.57.3

- Stopped a false diagnosis on failed tool calls. When a tool call failed
  schema validation, UR appended "this tool's schema was not sent to the API"
  and told the model to load it via `ToolSearch`. Both claims were wrong on
  every UR runtime: tool search requires `tool_reference` expansion, which no
  UR runtime supports, so it is disabled and all schemas are sent. The model
  acted on the false hint and wasted a turn. The hint now gates on the same
  condition the request path uses, so a mis-shaped call surfaces only the Zod
  error, which already names the offending field.
- Fixed tool search being enabled on LM Studio, vLLM and llama.cpp, where it
  had only ever been disabled for Ollama. Those runtimes cannot expand
  `tool_reference` either, so every deferred tool was unreachable: `ToolSearch`
  answered with reference blocks that resolve to nothing. Support is now
  derived from the runtime rather than the provider name.

## 1.57.2

- Fixed the Ollama adapter discarding images returned by tools. A tool result
  containing an image was flattened with `contentBlockToText`, which renders an
  image block as the literal string `[Image output omitted]` — so a `Computer`
  screenshot reached the model as that text and nothing else. Image blocks are
  now extracted from the tool result and sent as `images` on the following user
  message, which is where Ollama renders them reliably.
- On a model with no vision capability the placeholder now names the model and
  points at `/model`, so the agent states the real reason it cannot see instead
  of inventing one.
- `Computer(screenshot)` now reports the bytes actually sent rather than the
  on-disk size, which was misleading after downsampling.

## 1.57.1

- Fixed the `Computer` tool returning a byte count instead of the screenshot.
  `mapToolResultToToolResultBlockParam` dropped the captured image, so the
  model saw only "Captured 5164460 bytes" and had to ask the user where to save
  the file — defeating the tool's main purpose. Screenshots now come back as an
  image content block, resized through the same path `FileRead` uses so a
  Retina capture cannot exceed the request size limit.
- When encoding fails the file still exists, so the result now reports the path
  for the model to read rather than reporting nothing usable.

## 1.57.0

- Connected four features that were built, tested and then left unreachable.
  Each had passing unit tests while contributing nothing to a real session.
- `wrapUntrusted()` now runs on WebFetch and WebSearch results, at the
  `mapToolResultToToolResultBlockParam` choke point every return path passes
  through. Fetched pages and search results reach the model inside a
  nonce-bound boundary they cannot close, with injection signals labelled. The
  WebSearch citation reminder deliberately stays outside the boundary: it is
  UR's own instruction, and wrapping it would present it as untrusted data.
- Added the `Computer` tool, so desktop control is available to the agent and
  not only to the human through `/computer`. Screenshots are permitted as
  read-only; clicks and keystrokes always ask, because the model chooses the
  coordinates and the user has not seen them. Clicks are bounds-checked against
  real screen geometry and refused when geometry is unavailable. The UI renders
  a character count rather than the typed text, so a dictated password is not
  echoed into the transcript.
- Added opt-in end-of-turn side effects at the `handleStopHooks` seam:
  `voice.speakResponses` reads replies aloud, and `memory.suggest` proposes
  durable facts deduped against stored memory. Both default to off, run on the
  main thread only so subagents stay silent, and are best-effort — speech is
  fire-and-forget so a long reply cannot delay the next prompt, and any failure
  is swallowed rather than ending the turn.
- Extracted `existingMemoryLines` into `memoryLines.ts`, shared by
  `/memory-suggest` and the turn hook.
- Added `test/wiringIntegration.test.ts`, which asserts the connections rather
  than the modules — the specific failure the unit tests could not catch.

## 1.56.1

- Documented the 1.52.0–1.56.0 features, which had reached `technical/03` as
  command rows but nowhere else. Doc 09 now covers the fan-out limits and how
  to run several workers at once; doc 12 covers the prompt-injection module and
  deny-default Seatbelt profiles; doc 05 covers Ollama Cloud authentication,
  base-URL precedence, and the narrowed `APIProvider` with its named
  predicates; doc 06 covers `agents.maxDepth`/`maxConcurrent`, permission
  profiles, and the provider environment variables.

## 1.56.0

- Added a subagent fan-out governor. Agents could spawn agents with no depth or
  concurrency bound, and `/crew`, `/arena`, `/bg fanout` and `/pattern` all
  spawn several at once, so a single prompt could expand into an unbounded tree
  until the machine wedged. Spawning is now refused past a nesting depth of 3
  or 20 concurrent agents, checked before any work starts so a refusal is free.
  The slot is released in the existing `finally`, so an aborted or crashed
  agent cannot strand the budget.
- Limits are configurable through `agents.maxDepth` and `agents.maxConcurrent`,
  clamped to hard ceilings of 10 and 100. A settings file cannot disable the
  governor, and out-of-range or non-numeric values clamp rather than switching
  it off. Refusal messages name the limit that fired and the setting that
  raises it.
- Added `src/security/promptInjection.ts`: detection of injection phrasing
  (instruction override, role reassignment, exfiltration, tool coercion, forged
  system turns, secrecy demands, boundary forgery), removal of zero-width and
  bidirectional characters used to hide payloads from human review, a
  nonce-bound content boundary that untrusted text cannot close because it
  cannot predict the nonce, and canary tokens that prove whether a boundary was
  crossed. Framed as detection and privilege separation rather than filtering,
  because no reliable injection classifier exists.
- Added `denyByDefault` to the Seatbelt profile builder. Without a read
  allowlist the profile previously fell back to `(allow default)` plus targeted
  denials — a blocklist rather than a sandbox, and the shape behind the 2026
  Seatbelt escape write-ups. Opt-in for back-compatibility, since it can break
  agents that read outside the standard runtime roots.

## 1.55.0

- Narrowed `APIProvider` to the two values `getAPIProvider()` can actually
  return, `'foundry' | 'ollama'`, and let the compiler find every dead branch.
  It surfaced 66 errors across 25 files; all are now resolved and the
  typechecker prevents the class of bug from returning. Comparisons against
  `'firstParty'`, `'bedrock'` and `'vertex'` had been silently false since the
  provider rewrite, which is what disabled `--effort` and `/fast`.
- Added `DeploymentKey` for the legacy per-deployment lookup tables in
  `configs.ts`, `deprecation.ts` and `modelStrings.ts`. Those tables are data
  rather than runtime state: they legitimately carry rows for deployments this
  build cannot select, and deleting the rows would have deleted real
  configuration.
- Replaced the dead comparisons with the named predicates
  `isFirstPartyRuntime()`, `isBedrockRuntime()` and `isVertexRuntime()` instead
  of deleting the branches. Behaviour is identical — all three return false —
  but the intent is now greppable rather than hidden in an impossible
  comparison, and re-enabling a deployment is a one-line change.
- Fixed one such comparison in `toolSearch.ts` that the compiler could not
  reach because the file carries `@ts-nocheck`. Found by grep after the
  typechecker was clean; it was the only one.
- `/memory-suggest` now seeds its dedup set from stored memory — the
  `/remember` notes store, `UR.md`, `UR.local.md` and the auto-memory
  entrypoint — so a fact already recorded is no longer proposed back. Each
  source is best-effort; an unreadable one narrows dedup rather than failing.

## 1.54.1

- Fixed `/speak`, `/computer`, `/memory-suggest`, `/import-session` and
  `/permission-profile` being unreachable from the shell. They were registered
  as slash commands but never wired into the Commander tree in `main.tsx`, so
  `ur speak "hi"` was parsed as the interactive prompt and failed with "too
  many arguments". All five now have shell subcommands with their own flags.
- Fixed argument parsing in the three new commands. The shell wiring quotes
  every argument, so `split(/\s+/)` yielded `"'100'"` rather than `100` and
  numeric arguments were rejected. They now use the quote-aware
  `parseArguments`, matching every other local command.
- Quieted `scripts/backfill-releases.mjs`: `gh release view` writes "release
  not found" for each unpublished tag, which is the expected answer during a
  scan and was burying the plan in twenty lines of noise.

## 1.54.0

- Wired the 1.53.0 capability libraries into runnable commands. They were
  verified modules but nothing invoked them; these are the execution paths.
- Added `/speak <text>` (alias `/say`), which drives the platform speech
  synthesiser with `--voice` and `--rate`. Text is passed on stdin, so it is
  never shell-parsed, and a missing synthesiser reports an install hint rather
  than failing the session.
- Added `/computer screenshot|click|type` (alias `/desktop-control`). Clicks
  are validated against the real screen geometry and refuse to run when the
  geometry cannot be read, rather than clicking blind. Every state-changing
  action requires an explicit `--yes`; without it the command prints what it
  would do and stops. A macOS screenshot that silently writes nothing reports
  the Screen Recording permission requirement.
- Added `/memory-suggest` (alias `/suggest-memory`), which scans recent user
  messages from the live transcript and proposes durable facts with their
  type, confidence and originating rule. Proposals are never saved on their
  own; `/remember` still does the writing.

## 1.53.0

- Added automatic memory extraction (`src/memdir/extractFacts.ts`). Durable
  preferences and project conventions are proposed from user messages, deduped
  against stored memory by normalized key and containment, and ranked by
  confidence. Deliberately rule-based: a per-turn model call costs latency on
  every turn, and a model asked what to remember over-answers. Precision beats
  recall here because a wrong memory is replayed into every later session.
  Instructions scoped to the moment ("for now", "just this once") and anything
  resembling a credential are never captured. Extraction reads user messages
  only, so the agent cannot teach itself its own guesses.
- Added spoken output (`src/voice/speak.ts`) for macOS, Linux and Windows.
  Code blocks, URLs and file paths are replaced before synthesis rather than
  read character by character, output is capped and cut on a sentence
  boundary, and the text travels on stdin so it is never shell-parsed. A
  missing synthesiser degrades to silence instead of interrupting the session.
- Added desktop-control primitives (`src/utils/computerUse/commands.ts`) for
  macOS and Linux: screenshot, click, and type. Coordinates are bounds-checked
  against the real screen, typed text is escaped into an AppleScript literal it
  cannot break out of, and every state-changing action is marked as requiring
  approval while reads are not.
- Added `/permission-profile [list|use <name>|clear]` (alias `/profile`) to
  switch the active profile from the CLI. The switch is written to whichever
  settings source defines the profile, so it lands beside its definition rather
  than creating a shadowing entry elsewhere.
- Added `scripts/backfill-releases.mjs` to publish GitHub Releases for tags
  that predate the release workflow. Tags without a matching `CHANGELOG.md`
  section are skipped rather than given invented notes, existing releases are
  left alone, and nothing is created without `--apply`.

## 1.52.0

- Implemented Ollama Cloud authentication. The Ollama client sent no
  `Authorization` header at all, so the hosted API was unreachable: local
  sessions only worked because the signed-in daemon proxies `:cloud` models on
  the user's behalf, and CI — which has no daemon — could not use Ollama at
  all. `OLLAMA_API_KEY` is now sent as a bearer token, trimmed so a pasted
  trailing newline cannot corrupt the header.
- A configured key with no configured host now resolves to `https://ollama.com`
  rather than localhost, since a bare key is useless against a local daemon. An
  explicit `OLLAMA_HOST` still wins, so self-hosted gateways are unaffected.
- Added `OLLAMA_API_KEY` to the Agentic CI provider-credential allowlist, so it
  reaches the isolated agent while platform write tokens still do not. Together
  these make `@ur` runnable in GitHub Actions against Ollama Cloud.
- Fixed the release gate hanging instead of failing. `bun test` loads all ~173
  files into one process and peaks past 3 GB; when a runner OOM-kills it the
  parent waits forever on dead children, which looks like a hang rather than a
  failure. The gate now runs `--parallel=4`, which implies `--isolate` and
  reclaims memory per worker. The suite itself was never broken.

## 1.51.0

- Added named permission profiles. `settings.permissions.profiles` holds named
  rule sets (allow/deny/ask plus a description) and
  `settings.permissions.activeProfile` selects one; its rules are appended to
  the base lists from the same settings source. A misnamed profile contributes
  nothing rather than failing open, and deny still beats allow downstream, so
  a profile can only narrow or extend.
- Added `/import-session <path>` for session portability. It validates a
  transcript exported from another machine line by line — all-or-nothing, so a
  corrupt file can never half-import — caps size at the resume reader's limit,
  and lands it under a fresh session id so imports never collide with local
  history. The result prints the `ur -r <id>` command to resume it.
- Background agent completion and failure now fire the user's Notification
  hooks with types `agent_completed` and `agent_failed`, so external tooling
  (desktop notifiers, pagers, dashboards) can react to background work
  finishing without polling. The in-app toast behavior is unchanged.

## 1.50.6

- Implemented `--effort` on Ollama. The support predicate compared
  `getAPIProvider()` against `'firstParty'` — a value it can never return — so
  the advertised flag was silently dropped everywhere. Effort is now advertised
  on Ollama runtimes and mapped onto the wire's `think` parameter: graded
  levels for families that accept them (`max` clamps to `high`), otherwise any
  requested effort enables reasoning. The adapter still probes `/api/show`
  first, so models without thinking support never receive the parameter.
- Fixed `/fast` misreporting. The same impossible comparison made fast mode
  permanently unavailable while blaming "Bedrock, Vertex, or Foundry"
  regardless of the actual provider. The command is now reachable and reports
  the honest reason: fast mode is a serving tier of the hosted URHQ service,
  which this build does not use.
- Added `isFirstPartyRuntime()` and replaced the misleading dead comparisons in
  the model-option builders (12 sites) and fast mode with it. Remaining
  `'firstParty'` comparisons in request shaping (beta headers, caching flags)
  are correctly dead and were left with their existing semantics.
- Ungated `/chrome`, `/desktop`, `/install-slack-app`, `/remote-setup`,
  `/upgrade`, `/usage`, and `/voice`. Their `ur-ai` availability requirement
  was unsatisfiable: it requires the `subscription` provider, which the
  provider registry itself blocks as an internal placeholder, so no user could
  ever see these commands.
- Removed 18 stub commands from the registry (`autofix-pr`,
  `backfill-sessions`, `good-ur`, `issue`, `ctx_viz`, `break-cache`,
  `onboarding`, `share`, `teleport`, `bughunter`, `mock-limits`, `summary`,
  `reset-limits`, `ant-trace`, `perf-issue`, `env`, `oauth-refresh`,
  `debug-tool-call`). Each was a one-line disabled placeholder named "stub"
  with no TypeScript source.
- Replaced every dead `ur.com`-family URL. `ur.com`, `platform.ur.com`,
  `docs.ur.com`, and `support.ur.com` have no DNS records; user-facing strings
  now point at the repository, developer comments at the equivalent live
  upstream documentation pages, and the nonexistent domain was dropped from the
  preapproved fetch host list.

## 1.50.5

- Added `.github/workflows/release.yml`. The repository had only a test
  workflow, so tags never became production releases: 18 tags existed with no
  GitHub Release and no automated publish. Pushing a `v*` tag now runs the full
  gate (typecheck, lint, tests, build, `release:check`, CLI smoke test),
  publishes a GitHub Release whose notes are the matching `CHANGELOG.md`
  section, and pushes the verified tarball to npm.
- The tag is not trusted on its own. The run fails if it disagrees with
  `package.json` or if `CHANGELOG.md` has no section for that version, and the
  artifact published to npm is the same one the gate verified rather than a
  fresh pack. Publishing is skipped, not failed, when the version is already on
  npm or when `NPM_TOKEN` is absent.

## 1.50.4

- Removed the `/install-github-app` command and its GitHub App setup flow,
  along with the startup tip suggesting `@ur` be tagged from issues and pull
  requests. The composite action at the repository root is removed with it.
- The agent is unchanged. `ur agent-ci` and the Agentic CI engine still compile
  workflows, evaluate triggers, and run isolated verified patches exactly as
  before; only the interactive installer that wrote those files into a
  repository is gone.

## 1.50.3

- Removed the GitHub App installation step from `/install-github-app`. UR
  authenticates in CI with the workflow's built-in `GITHUB_TOKEN` and a
  repository secret, so there is no app to install and no bot identity to
  authorize. The step was inherited from a flow that had a published app; this
  fork does not, so it opened the UR source repository and asked the user to
  install something that does not exist. The flow now goes from repository
  selection straight to workflow selection.
- Replaced the "API key is required" dead end with a skip. The key is consumed
  by the GitHub runner rather than the local session, so the person setting up
  the repository often does not hold it, and on a local provider there may be
  no URHQ key at all. Submitting an empty key now commits the workflow and spec
  and reports the exact `gh secret set` command needed to finish.

## 1.50.2

- Fixed local-provider sessions showing "Not logged in · Run /login" with no
  account to log in to, introduced in 1.50.1. Credential ownership and URHQ
  auth applicability are separate questions: an Ollama session uses the user's
  own local runtime, so it is not third-party, but inference never reaches
  URHQ and no URHQ credential exists to verify. `isURHQAuthEnabled()` now keys
  off a dedicated `usesURHQSubscriptionAuth()` predicate, so only the
  subscription provider — where `/login` is actionable — can report a missing
  key. `/login` and `/logout` stay registered everywhere they are useful.
- Skipped a keychain and settings read on every session that cannot use URHQ
  auth, by returning before the external-credential lookup instead of folding
  the provider test into the final condition.

## 1.50.1

- Fixed an always-true provider test that silently disabled a large part of the
  command surface. `isUsing3PServices()` was derived from `getAPIProvider()`,
  a request-shaping enum that never returns `'firstParty'`, so the comparison
  held for every user. Consequences: `/login` and `/logout` were never
  registered; every `availability`-gated command failed its check, so
  `/install-github-app`, `/fast`, `/chrome`, `/desktop`, `/install-slack-app`,
  `/remote-setup`, `/upgrade`, `/usage`, and `/voice` reported "Unknown skill";
  `ur auth status` classified every user as `third_party` and always logged in;
  `is1PApiCustomer()` always returned false, suppressing three tips. Third-party
  status is now derived from the provider registry — vendor API keys and
  external CLI logins are third-party, while local, self-hosted, and
  subscription runtimes are not.
- Ungated `/install-github-app`. It provisions a workflow and a repository
  secret rather than consuming inference, and the API key is entered in the
  flow, so it is now available on every provider including local runtimes.

## 1.50.0

- Completed `/install-github-app` so `@ur <task>` works from GitHub. The
  mention now triggers on issue comments, pull-request comments, inline review
  comments, submitted reviews, and new issues; `/ur` remains accepted. Matching
  is word-bounded and skips fenced code and quoted replies, so `@urgent`,
  `me@ur.example`, and bots quoting an earlier comment no longer start runs.
- Fixed the installed workflow being inert: the installer wrote
  `.github/workflows/ur.yml` but never committed `.ur/agentic-ci/default.yaml`,
  so every run aborted with "Spec not found" before the agent started. Both
  files now land in the same pull request.
- Added a trusted publisher so a mention produces visible feedback: an eyes
  reaction and a tracking comment that is edited in place with the summary,
  verification table, and proposed diff. The job that reads untrusted event
  text still holds no write token — it emits the bounded hash-addressed patch
  artifact, and a separate write-scoped job consumes only that artifact.
  Agent-authored text reaches the publisher through `jq --rawfile`, never
  through shell interpolation.
- Added opt-in `publish.mode: pull-request`, which applies the verified patch
  and opens a PR. It is the only mode granting `contents: write`;
  `publish.mode: artifact` restores the previous producer-only single job.
- Added the composite action at the repository root, so
  `uses: Maitham16/UR@v1` resolves. `ur-review.yml` referenced it but no
  `action.yml` existed, so that workflow failed immediately.
- Fixed the compiled workflow emitting an invalid folded scalar: continuation
  lines of the job `if:` expression were indented below the block indent.
- Fixed the installer's secret rename only rewriting the composite-action input
  form, which left the Agentic CI workflow pointing at a nonexistent
  `secrets.UR_API_KEY` whenever a custom secret name was chosen.
- Restricted trigger keywords to a charset that cannot terminate a GitHub
  workflow expression.

## 1.49.0

- Added cryptographically signed A2A Agent Cards: RFC 7515 detached JWS over
  the RFC 8785 canonical form of the card, using Ed25519 (`alg: "EdDSA"`).
  Verification recomputes the payload with `signatures` excluded, so a card can
  carry several independent signatures, and rejects algorithm substitution
  rather than honoring a caller-supplied `alg`. Signing is opt-in through the
  card builder's `signingKey`, so deployments without a provisioned key
  continue serving byte-identical unsigned cards. Replaces the previous
  `signatures: []` placeholder, which was typed so that it could never hold a
  signature.
- Fixed `release:check` failing on a clean tree: `release-hygiene.mjs` forbids
  `.claude/settings.local.json` in release archives, but the ignore policy did
  not exclude it, so the untracked file entered the source archive candidate
  through `git ls-files --others`.

## 1.48.0

- Added managed cloud fan-out with durable, idempotent steering, owner-scoped
  mobile/A2A control, explicit PASS plus safe-branch selection, and
  cancellation-safe task transitions.
- Added evidence-backed learned playbooks, citation-validated shared memory,
  durable hash-chained side chats, and isolated multi-repository coordination
  with dependency-aware execution and review-only PR/rollback plans.
- Added hardened Agentic CI, trajectory-aware evaluation gates, Electron
  desktop QA with privacy-safe evidence, and verified deterministic/model/
  hybrid best-of-N arenas whose checks are cryptographically bound to the
  candidate patch.
- Hardened agent subprocess credentials, artifact storage and delivery,
  concurrent state updates, verifier mutation detection, signed-URL memory
  redaction, terminal cancellation races, and CI-facing failure exit codes.
- Expanded user, configuration, validation, static-site, and technical
  documentation plus adversarial regression coverage for the new workflows.

## 1.47.1

- Hardened file downloads, filesystem permission checks, and signed skill
  trees against traversal and chained-symlink escapes.
- Fixed task-memory integrity validation, prompt-plan file locking and change
  evidence, multi-prompt legacy execution, tool cancellation, and invalid
  concurrency handling.
- Made OAuth callbacks, remote session WebSockets, relay buffering, provider
  body timeouts, and macOS keychain fallback behavior fail safely and recover
  from transient errors.
- Updated vulnerable transitive dependencies and added focused regression
  coverage for each corrected path.

## 1.47.0

- Added a secure, opt-in AG-UI HTTP/SSE adapter with official schema/encoder
  integration, truthful capability discovery, ordered text/tool/state events,
  cancellation, exact CORS, bearer protection for network exposure, resource
  limits, redacted errors, and explicit rejection of unsupported capabilities.
- Added a dual-stack A2A server: the stable v0.3 SDK binding remains available,
  while strict v1 ProtoJSON JSON-RPC and HTTP+JSON routes provide versioned
  discovery, pagination, artifacts, cancellation, tenant isolation, durable
  state, and compatibility coverage against the official A2A TCK.
- Completed the ACP v1 stdio lifecycle with private durable history,
  `session/list`, `session/load`, `session/delete`, bounded ordered replay,
  session modes, configuration options, available-command updates, and
  cancellation-safe concurrent transport behavior.
- Added an opt-in MCP 2026-07-28 stateless HTTP adapter with strict request
  metadata, negotiated Tasks and Apps extensions, owner-isolated durable tasks,
  schema-referenced extension headers, cache/TTL discovery metadata, CORS,
  bearer authentication, rate/concurrency limits, and corruption quarantine.
- Added an opt-in OpenAI Responses transport while retaining Chat Completions
  as the default. It supports multimodal/tool translation, structured output,
  semantic SSE streaming, background create/poll/resume/cancel, WebSocket
  continuation, server compaction, deferred tool search, and privacy-first
  `store: false` state handling. No paid API calls are required by its tests.
- Added explicit OpenTelemetry OTLP/console exporters and current GenAI
  inference, agent, workflow, tool, memory, token, cache, latency,
  time-to-first-chunk, inter-output-chunk latency, and error semantics. Export
  and message-content capture remain disabled by default.
- Added strict Agent Skills validation, deterministic permission/tree digests,
  Ed25519 signing and trusted-key verification, invocation-time integrity
  rechecks, `ur skill verify|sign|keygen` commands, and deterministic discovery
  from the cross-client `.agents/skills/` project/user locations.
- Upgraded project task memory to a tamper-evident provenance chain with atomic
  private writes, cross-process locking, legacy anchoring, fail-closed reads,
  verification, quarantine, and rollback commands.
- Hardened all new durable stores with bounded input/state, symlink rejection,
  private permissions, atomic replacement, corruption handling, and focused
  concurrency/adversarial tests.

## 1.46.0

- Added a stable, official-SDK ACP v1 stdio agent with resumable sessions,
  client MCP transports and additional roots, streamed updates, native
  permission requests, cancellation, and private persisted session identity.
- Added an official-SDK A2A v0.3 JSON-RPC binding and hardened the separate UR
  HTTP compatibility APIs with scoped authorization, strict media/schema
  validation, bounded requests/responses/state, durable task identity, and
  fail-closed permission handling.
- Hardened OpenAI, Anthropic, and Gemini provider wire behavior, including
  strict tool schemas, exact tool-call identity, Gemini thought signatures,
  request correlation, bounded stdin secrets, and protocol regression tests.
- Completed background-task management in the VS Code Actions panel and made
  JetBrains prompt cancellation reach the running server task. Modernized and
  verified both IDE extension builds against their supported platforms;
  JetBrains bytecode no longer emits compatibility bridges to internal APIs.
- Made background manifests cross-process safe, atomic, private, bounded, and
  traversal-resistant; added bounded CLI/log handling and explicit isolated or
  offline task-launch choices without implicit publishing or permission bypass.
- Updated dependencies and supply-chain automation, pinned CI actions, added
  multi-ecosystem Dependabot coverage, synchronized every release surface, and
  expanded release, packaging, security, protocol, and integration checks.
- Made source archives Git-ignore-aware, private-state-safe, and replacement-
  safe; provider smoke tests now isolate their JSON reports instead of
  rewriting the tracked diagnostic snapshot, and secret scanning covers new
  non-ignored release files before they are committed.
- Re-audited the agent roadmap against primary sources after the version bump;
  corrected stale provider and dense-memory claims and recorded dated gaps for
  A2A v1, ACP lifecycle methods, MCP Tasks/Apps, provider-native durable
  inference, Agent Skills governance, GenAI telemetry, and memory integrity.

## 1.45.6

- Deduplicated project verification approval so compile/test/lint commands are
  offered at most once per user turn. The approval marker is cleared for the
  next user task, preserving one explicit decision per task.
- Kept AutoApprove behavior, test execution policy, and explicit publishing
  boundaries unchanged. Added regression coverage and synchronized user,
  technical, static-site, npm, IDE, and bundled release metadata.

## 1.45.5

- Bounded Ollama Cloud response-header and streaming phases to 120 seconds by
  default while preserving the five-minute allowance for local Ollama models.
  `API_TIMEOUT_MS` and per-request timeouts still take precedence.
- Stopped deliberate Ollama Cloud stream deadlines from triggering the shared
  non-streaming fallback and retry chain. Other providers and local Ollama
  retain their existing fallback and retry behavior.
- Extended the deterministic verifier to reject turns that end by promising an
  immediate file change or command but emit no successful matching tool call.
  Conditional plans and instructional prose remain unaffected.
- Added focused timeout, retry-containment, intent-detection, and verifier
  integration coverage; synchronized npm, IDE extension, static-site, user,
  validation, and technical release metadata.

## 1.45.4

- Added mandatory provider-first model selection for the first interactive run
  in every workspace that has no project-local model. The validated provider
  and model pair is saved to `.ur/settings.local.json` before the REPL starts.
- Prevented user-global and built-in defaults from silently choosing a model
  for a fresh folder. Explicit CLI/environment, shared project, flag, managed,
  agent, and restored-session model choices continue without interruption.
- Made fresh headless workspaces fail before model execution with actionable
  guidance to run the picker or pass `--model <model>`; initialization-only and
  resume flows remain non-blocking. AutoApprove behavior is unchanged.

## 1.45.3

- Made slash-command resolution deterministic across bundled skills, plugins,
  project skills, workflows, and built-ins. Duplicate canonical tokens are
  rejected by source priority and conflicting aliases are removed; registry
  tests now verify every shipped command token, description, and lazy loader.
- Removed overlapping `/paper`, `/security`, `/audit`, `/skills`, and
  `/sandbox` registrations. The single `/sandbox` command now provides both
  interactive settings and `status`, `check`, `init`, `eval`, and `exclude`
  subcommands.
- Added `/ci-loop --cwd <path>` and working-directory evidence. Test-runner
  "No tests found" failures now stop after one attempt with actionable cwd
  guidance instead of invoking a fix agent repeatedly.
- Serialized concurrent artifact-viewer startup so simultaneous callers share
  one server and one reported URL.
- Synchronized the user guides, static documentation site, and technical
  specifications with the final command counts, source-priority rules,
  `/skill` versus `/skills`, merged `/sandbox`, CI cwd behavior, and explicit
  worktree publishing contract.

## 1.45.2

Correctness and containment release completing the runtime audit.

- Made sandbox, security-scope, WebFetch, API, browser, database, test-runner,
  GitHub mutation, lifecycle-hook, and file-edit boundaries fail closed. URL
  validation now covers DNS resolution and every redirect; browser navigation
  uses a persistent Playwright session with guarded subrequests.
- Completed provider request mapping and error handling across OpenAI,
  Anthropic, Gemini, OpenRouter, Ollama, and OpenAI-compatible runtimes. Generic
  compatible endpoints use their own credential key, offline mode blocks cloud
  dispatch, retry zero is honored, and local Ollama is the default route.
- Made AST/LSP workspace edits transactional and containment-safe, including
  symlink rejection, stale-edit preconditions, atomic writes, new-file rollback,
  and TypeScript-language-service import organization.
- Hardened SSE/WebSocket replay, transcript write serialization, direct-connect
  cancellation, arena isolation/judging, thread sharing, and same-timestamp file
  replacement detection. Session/diff/lab/security-fix paths reject traversal
  and symlink escapes.
- Fixed VS Code multi-root selection, stale turn callbacks, and diff manifest
  validation. Replaced the JetBrains plugin's nonexistent `/v1/prompt` call
  with project-scoped JSON-RPC sessions over `/acp`; the plugin builds against
  IntelliJ IDEA 2024.2.
- Enabled transcript deep search instead of the compiled-off path. Worktree
  skills now keep changes local, ask before the final full verification suite,
  and never commit, push, or open a PR unless explicitly requested. The
  `autoApprove` permission mode is unchanged.
- Removed an internal SDK barrel's throw-only runtime exports; the supported
  programmatic contract remains `ur -p` stream-json. Provider fallback is now
  documented and reported accurately as explicit recovery guidance, never an
  automatic cross-provider switch.

## 1.45.1

Completes the three partially-delivered 1.45.0 items to 100%.

- Semantic code search is now zero-config: the CodeSearch tool auto-enables
  the moment a built index exists (`ur code-index build`) — no `UR_CODE_INDEX`
  env var needed. The env var remains an override in both directions
  (`UR_CODE_INDEX=off` disables even with an index present).
- JetBrains plugin now actually builds: migrated to the IntelliJ Platform
  Gradle Plugin 2.x (the 1.x plugin is incompatible with Gradle 9) and
  compiled against IntelliJ IDEA Community 2024.2, producing a distributable
  zip via `gradle buildPlugin`.
- Deprecated top-level `disableAutoMode` now emits a one-time warning at
  load pointing to `permissions.disableAutoMode` (both keys still honored;
  removal reserved for the next major).

## 1.45.0

Top-tier feature release — closes the gaps against 2026's leading agents.

- `ur cloud` — detached best-of-N tasks (the local-first codex-cloud
  analogue): `run "<task>" --attempts N` races up to 8 isolated worktree
  agents in the background via the arena judge; `list`/`show <id>` browse
  results any time; `apply <id>` applies the winning diff. Outcomes feed the
  automatic learning store.
- `ur wiki` — living repo wiki (Devin-Wiki analogue): `generate` writes
  `.ur/wiki/` (overview, architecture by import in-degree, dependency map)
  from project DNA + the code index; `install-hook` refreshes it after every
  merge; `map` maintains `.ur/repo-map.md`.
- Repo map in context (Aider/Cursor pattern): when `.ur/repo-map.md` exists
  and is fresh (<7 days), a byte-capped orientation map is injected into the
  system prompt. Zero tokens until you generate one.
- `ur recipe` — structured-output playbooks (Devin-style): stored prompt +
  JSON Schema; `run` spawns a child session whose final answer must validate
  (one automatic repair round with the validation errors).
- `ur thread share` — share a session transcript as a local web page,
  served at `/threads/<id>` on the artifacts server. Local-first: nothing
  leaves the machine unless you expose the port.
- Web dashboard at `/dashboard` on the artifacts server: cloud tasks,
  background agents, live task board, and learning stats on one page
  (`/api/dashboard` for JSON).
- `ur audit export` — hash-chained audit trail (tool actions + run traces)
  as JSONL/CSV; `ur audit verify <file>` proves an export wasn't edited or
  reordered.
- `/pdf <file> [pages]` — deps-aware PDF ingestion (pdftotext/pdfinfo) with
  page ranges, mirroring /image.
- Crew dynamic fan-out: `ur crew run <name> --dynamic [--max-workers N]`
  scales the worker pool to the task board (tasks appended mid-run are
  picked up), governed by a hard concurrency cap.
- Auto-skillify: `/learn stats` now surfaces skill candidates — categories
  with ≥5 recorded successes and no matching skill get a concrete
  /create-skill suggestion.
- Voice mode and the computer-use MCP server (`ur --computer-use-mcp`) now
  ship in release builds (previously compile-time-disabled). Voice's native
  audio backend stays optional and degrades gracefully when not installed.
- JetBrains plugin scaffold under `extensions/jetbrains-ur/` (experimental,
  thin ACP client mirroring the VS Code extension).
- Settings: top-level `disableAutoMode` is marked deprecated in favor of
  `permissions.disableAutoMode` (both still honored).

## 1.44.10

- Render `AskUserQuestion` permission requests inside a `PermissionDialog` so
  multiple-choice options appear as a bordered dialog box rather than a plain
  list.
- Add `/undo` local command to restore the last-edited file from its pre-edit
  checkpoint.
- Add shell quote-safety gate to `BashTool.validateInput`: reject commands with
  unbalanced quotes before execution and return a model-actionable diagnostic.
- Add four built-in output styles: `Concise`, `JSON-strict`, `Debug-verbose`,
  `Release-notes`.

## 1.44.9

- Fix recurring "String to replace not found in file" Edit errors by adding
  whitespace-tolerant matching (trailing whitespace, tab/space indentation).
- Fix AskUserQuestion "questions type expected as array" validation errors by
  parsing stringified `questions`/`options` from small local models.

## 1.44.8

- Keep auto-memory and automatic learning on by default with explicit opt-outs.
  Automatic learning can now be disabled with `automaticLearningEnabled: false`
  or `UR_CODE_DISABLE_AUTO_LEARNING=1`.
- Make `/remember <text>` promote explicit notes into recallable auto-memory
  topic files when auto-memory is enabled.
- Reduce recall token load by prefiltering memory candidates before the
  selector model and surfacing fewer, smaller high-confidence memories.

## 1.44.7

- Add `autoApprove` permission mode for command/tool approval prompts. It
  auto-approves operations that would otherwise require permission approval,
  while preserving user-input dialogs and explicit denials.
- Hide the legacy non-interactive denial mode from user-facing mode selectors.

## 1.44.6

- Internal permission-mode iteration superseded by `1.44.7`.

## 1.44.5

- Internal permission-mode iteration superseded by `1.44.6`.

## 1.44.4

- The agent now learns from every run automatically — no `/learn run` needed.
  ci-loop, arena, escalation, and test-first completions fold their pass/fail
  outcome (per task category and model) into `.ur/learning/stats.json` as a
  pure JSON update: zero model calls, zero tokens, idempotent, and failure of
  the store can never break the run that produced the outcome.
- The `auto` routing strategy consumes that evidence: when a model has a
  proven track record for a task's category (≥ 3 recorded runs, ≥ 60% pass
  rate) and is currently selectable, it is chosen directly. Categories that
  history shows a cheap local model handles reliably stop paying for the
  strong tier — tokens go down because of evidence, not guesswork. With thin
  or absent evidence, routing falls through to the exact previous heuristics,
  so behavior can never degrade below today's.
- `/escalate` keeps consuming the same store (learned difficulty bias), which
  now grows by itself, so tier selection sharpens run over run.
- New `autoMemoryExtractionInterval` setting: run the auto-memory extraction
  agent every N eligible turns instead of every turn. The default (1) is
  unchanged; the extraction is a forked agent call on the session model, so
  this is an explicit token/compute dial for long sessions.

## 1.44.3

- Make thinking visually distinct from answers: thinking blocks are labeled
  "model reasoning to itself — not the answer" (dim italic, left-bordered when
  expanded); answer text carries an accent-colored ⏺ marker.
- Pin the live task panel: it stays visible above the prompt while the agent
  works (previously hidden during turns), with real-time status icons
  (✔ done, ■ in progress, □ pending, ✘ failed, ⚠ skipped). `showExpandedTodos`
  now defaults on; ctrl+T still toggles.
- Add tasks on request: saying "add to your tasks …" now creates the task
  immediately, even mid-turn, and it appears live in the pinned panel.
- Add `/undo`: restores the most recently edited file to its content from
  before the last turn's edits (deletes a file the last edit created). Full
  checkpoint restore remains `/rewind`.
- Reject shell commands with unterminated quotes before execution, with a
  diagnostic that names the defect, suggests the quoted-heredoc fix, and
  tells the model not to retry the identical command.
- Add Concise, JSON-strict, Debug-verbose, and Release-notes output styles.
- Ollama: drop text-form tool calls that duplicate native ones (no more
  double-executed Writes); tolerate and strip up to two hallucinated extra
  keys on bare-JSON Write/Edit calls instead of leaking them as prose.
- Fix the test suite: repaired two committed test files that failed or
  poisoned other suites via global module mocks — the suite is now fully
  green (1134 pass, 0 fail).
- TypeScript now covers test/ (fixed all 171 surfaced errors) and 544
  compiled files no longer end in megabyte-scale inline sourcemap comments —
  VS Code diagnostics and long-line problems are gone.
- Repo hygiene: untracked committed local state (.ur state files, FUSE
  artifact, stray yarn.lock) and added ignore rules; added UR.md project
  memory so the agent learns the repo across sessions.
- `Task` status schema now includes `failed` and `skipped`, matching what
  crew/workflow runs produce and the task panel renders.

## 1.44.2

- Fix Ollama streamed tool-call accumulation: Ollama streams each completed
  tool call in its own chunk, but the merge logic overwrote call N-1 with
  call N, collapsing multi-call turns (e.g. several `Write` calls scaffolding
  a test suite) into just the last call. Calls now append; string argument
  fragments concatenate; empty argument resends no longer clobber good
  arguments; cumulative resends stay idempotent.
- Repair almost-JSON tool-call arguments instead of silently emptying them.
  Local models routinely emit raw newlines inside JSON string values,
  markdown fences, and trailing commas; strict parsing collapsed the whole
  input to `{}`, which surfaced as `InputValidationError: required parameter
  \`file_path\` is missing` and trapped the model in a retry loop. A lenient
  parser (`parseToolInputJsonLenient`) now repairs these across the Kimi
  marker parser, the bare-JSON text parser, the Ollama input parser, and
  streamed tool-input normalization. Repairs are tracked via the
  `tengu_tool_input_json_repaired` event; only genuinely hopeless input still
  falls back to `{}`.
- Warn (once per model, in debug logs) when an Ollama model does not
  advertise the `tools` capability, since tool definitions are then silently
  dropped. In that mode the system prompt now includes a concise instruction
  telling the model to emit single-line bare-JSON tool arguments — the exact
  format the text parser recovers — instead of leaving it to guess.

## 1.44.1

- Fix task board rendering: finished, failed, and skipped tasks now render as
  checked instead of unchecked.
- Deduplicate consecutive task board emissions and keep final boards clean
  (single header, single progress summary).

## 1.44.0

- Add `verifier.askBeforeGates` setting (default `false`). When enabled, UR asks
  via `AskUserQuestion` whether to run project verification commands after a
  task, instead of auto-running tests/typecheck/lint gates. Available in
  `/config`, `ur config set verifier.askBeforeGates true`, and
  `.ur/settings.json`.
- Prompt the model to stop after delivering its final response, reducing silent
  extra thinking turns.

## 1.43.6

- Render output from reasoning models on OpenAI-compatible providers (LM Studio,
  vLLM). The streaming and non-streaming parsers now read `reasoning_content`
  (and `reasoning`) deltas and surface them as thinking blocks. Models that emit
  their output in the reasoning field (e.g. NVIDIA Nemotron, DeepSeek-R1
  distills, QwQ) previously produced an empty response with no error.

## 1.43.5

- Fix model discovery for OpenAI-compatible providers (LM Studio, llama.cpp,
  vLLM) when base_url omits the API version segment. Discovery and `ur provider
  doctor` now also try `/v1/models` when base_url is just `host:port`, so
  `/model` lists the server's models instead of "returned no models". The
  doctor reports the path that actually returns models and warns when an
  endpoint is reachable but empty, instead of a misleading bare-`/models` pass.

## 1.43.4

- Tolerate hallucinated extra parameters on tool calls: when input validation
  fails only because of unrecognized keys (e.g. `title`/`description` on a
  `Write` call), those keys are stripped and the call is re-validated instead
  of failing with `An unexpected parameter X was provided`. Genuine errors
  (missing required fields, type mismatches) still surface normally.

## 1.43.3

- Bias the assistant toward the interactive arrow-key select menu: the
  AskUserQuestion tool guidance now instructs the model to use the selectable
  menu whenever it offers the user a choice, instead of asking a free-form
  question in plain text that the user has to answer by typing.

## 1.43.2

- Fix artifact pages hanging blank: diff viewer assets (diff2html,
  highlight.js theme) are now served locally from `/assets` via the new
  `diff2html` dependency instead of render-blocking CDN tags, and the viewer
  script moved to the end of the body — pages paint instantly even offline.
- `ur artifacts serve` in headless mode now keeps the process alive serving
  until Ctrl+C (previously the process exited and killed the server), and the
  port can be passed positionally (`ur artifacts serve 4181`).

## 1.43.1

- Artifacts page renders diffs VS Code-style: side-by-side/inline views with
  syntax highlighting via diff2html (plain-text fallback when offline). New
  live view `/diff` shows current working-tree changes without manual capture,
  with a one-click "Capture as artifact" button (`POST /api/capture-diff`,
  `GET /api/diff`).
- Tolerate empty-string parameter names in model tool calls: stripped before
  validation instead of failing with `An unexpected parameter \`\` was
  provided`.

## 1.43.0

- Add `ur artifacts serve [--port 4180]`: a local web page for artifacts.
  `GET /artifacts/<id>` renders one artifact (status, summary, feedback,
  content), `/` lists all, with `/artifacts/<id>/raw` and `/api/artifacts[/<id>]`
  endpoints. Bound to 127.0.0.1; stop with `ur artifacts serve --stop`.

## 1.42.0

- Project safety policy no longer hard-blocks commands. Risky or deny-matched
  commands (package installs, destructive git operations, secret access,
  sandbox-required commands when the sandbox is unavailable) now surface as
  approval prompts instead of `Blocked by project safety policy` errors; the
  user decides. `ur safety`/`ur sandbox` evaluation output is unchanged.

## 1.41.1

- Harden provider tests against stored API keys in the local secure storage.
- Revert sandbox default to disabled; expose `sandbox.enabled`,
  `sandbox.failIfUnavailable`, and `sandbox.allowUnsandboxedCommands` through
  the `/config` tool so users can toggle the sandbox on/off explicitly.

## 1.41.0

- Persist the model chosen through the interactive `/model` picker to settings
  and clear saved model state when `/model default` is used.
- Enable the sandbox by default when no explicit `sandbox.enabled` setting is
  configured.

## 1.40.1

- Pin `diff` to ^7 and OpenTelemetry packages to 2.6.1/0.214.0 to match the
  source API, fixing type errors from accidental dependency bumps, and rebuild
  the shipped bundle against these versions.
- Update branding and A2A delegation tests for the `ur-agent` package name.

## 1.40.0

- Version bump: align package, build macro, VS Code extension, docs eyebrow, and
  changelog for the 1.40.0 release.

## 1.37.5

- Version bump: align package, build macro, VS Code extension, docs eyebrow, and
  changelog for the 1.37.5 patch release.
- Rename user-facing product/package branding to UR-Nexus while preserving the
  `ur` CLI entrypoint and legacy configuration compatibility.
- Add a typed prompt-planning layer with deterministic task decomposition,
  task-board rendering, dependency-aware parallel scheduling, file-lock
  serialization, and verification checks for unsupported file/command claims.
- Wire prompt planning into real `ur exec` execution with task-board progress,
  dependency-aware parallel scheduling, file-lock serialization, evidence-based
  final reports, and compatibility flags for direct legacy prompt execution.
- Add live task-board streaming during real planned execution, workspace
  before/after file evidence, verified versus unverified command reporting,
  strict/non-strict verification policy, and final reports generated from
  observed execution evidence.
- Fix project safety policy handling so projects that remove `network` from
  `sandboxRequiredFor` can run user-controlled localhost network checks without
  a hard sandbox-unavailable denial.

## 1.37.3

- Version bump: align package, build macro, VS Code extension, docs eyebrow, and
  changelog for the 1.37.3 patch release.

## 1.37.2

- Tightened provider reliability: API-provider calls now use a finite default
  timeout, consistent retry handling for transient network/provider failures,
  and safer OpenAI-compatible base URL normalization without changing streaming,
  tool-call, multimodal, or local-provider routing behavior.
- Hardened autonomous command safety: write, execute, and network commands now
  require sandbox coverage in autonomous mode, unavailable sandboxes fail
  closed unless explicit unsafe mode is set, and common secret read/exfiltration
  patterns through pipes, redirects, and interpreter commands are denied.
- Started real TypeScript strictness migration with a strict-core typecheck
  stage, removed several core runtime `@ts-nocheck` suppressions by fixing the
  underlying types, and added a lint guard against new core suppressions.
- Improved release hygiene with package/source archive checks for dependency
  trees, OS metadata, local env files, cache junk, logs, test output folders,
  and nested archives; the secret scanner now works in both git checkouts and
  extracted source archives.
- Added reproducible benchmark report scaffolding so local eval runs can be
  converted into versioned structured reports without claiming unmeasured
  benchmark results.

## 1.35.1

- Polished the bundled VS Code inline-diffs view with native toolbar icons,
  useful empty-state rows, clearer diff labels, and a cleaner review webview.
- Fixed `ur ide status` routing so the IDE extension status action reports
  provider/model/plugin status instead of printing inline-diff usage.
- Kept model/provider selections project-local by default and made transient
  Ollama gateway timeouts retry cleanly.

## 1.35.0

- New `ur connect` CLI command (same implementation as the `/connect` slash
  command): `ur connect status`, `ur connect <provider>`,
  `ur connect <provider> --key <KEY>`, and `ur connect logout <provider>`.
  Provider doctor fix-it hints that referenced `ur connect` now work as shown.
- `ur spec run`/`ur spec verify` now accept the documented `--kernel` flag
  from the CLI (previously only the slash command parsed it).
- Hidden non-functional legacy commands from `--help`: `ur setup-token`,
  `ur auth login`, `ur auth logout`, and the native-build `ur install`
  (no native package is published; use `ur update`).
- Removed dead external-bridge gating code left over from pre-1.34 behavior
  (`UR_ENABLE_EXTERNAL_APP_PROVIDERS` and the persisted opt-in list); the env
  var was already ignored at runtime.
- Documentation overhaul: provider/model docs now match the 1.34 first-class
  subscription-CLI behavior everywhere; new `docs/TROUBLESHOOTING.md`;
  README command table covers the full public CLI; static docs site updated
  (stale `install`/`setup-token` entries replaced with `connect`, `ide`,
  `skill`, `task`, `sandbox`, `memory`, `local-first`, `update`).
- Removed stale duplicate docs (`docs/AGENT_UPGRADE_1.15.0.md` …
  `1.22.0.md`, `docs/CODE_FEATURE_INVENTORY.md`); release history lives in
  this changelog.
- Fixed `.gitignore` ignoring itself, so ignore rules ship with the repo.

## 1.34.0

- Restore the 1.30.3 subscription approach: Codex CLI, Claude Code, Gemini CLI
  and Antigravity are first-class in `/model` again — shown by default and
  usable directly (no `UR_ENABLE_EXTERNAL_APP_PROVIDERS` opt-in and no runtime
  block). They dispatch through the official CLI; log in with
  `ur auth <provider>`. The internal generic `subscription` placeholder is
  hidden from listings.
- API and local/server providers are unchanged: live model discovery from each
  provider's `/models` endpoint and in-app masked API-key entry.

## 1.33.0

- Add API keys from inside UR while it is running: in `/model`, selecting an
  API provider (OpenAI, Anthropic, Gemini, OpenRouter) that isn't connected now
  shows a masked key-entry step. The key is stored in the OS keychain, then the
  provider's models load live and you choose one — all without leaving the
  session or setting an environment variable.
- Subscription login is unchanged: use `ur auth <provider>` (Codex, Claude,
  Gemini, Antigravity).

## 1.32.0

- `/model` now shows the subscription providers (Codex CLI, Claude Code, Gemini
  CLI, Antigravity) again. They are enabled the moment you `ur connect` them
  (persisted per-account opt-in) — no `UR_ENABLE_EXTERNAL_APP_PROVIDERS` env var
  needed — and run via the official CLI. Not connected → clear connect prompt.
- API providers (OpenAI, Anthropic, Gemini, OpenRouter) now load their model
  lists **live** from each provider's `/models` endpoint using your connected
  key (OpenAI/Anthropic/OpenRouter `data[].id`; Gemini `models[]` filtered to
  `generateContent`). No hardcoded model IDs; the curated list is only a
  fallback shown before you connect. Subscription CLIs keep a curated list
  because their official CLIs expose no models API.
- Live-discovered models validate against the discovered list (with cold-process
  tolerance), so a saved API model keeps working across restarts.

## 1.31.0

- Add in-app provider connection: `ur connect` / `/connect` connects a provider
  once and persists it. Subscription providers (Codex, Claude Code, Gemini,
  Antigravity) launch their official CLI login using your own account; API
  providers (OpenAI, Anthropic, Gemini, OpenRouter) store the key in the OS
  keychain (with an encrypted file fallback) — the same secure store UR uses for
  its own credentials.
- Runtime now reads a stored key first, then the environment variable, so a
  once-connected API provider works in later sessions without re-entering the
  key. `ur provider doctor` and the `/model` picker reflect stored-key
  connections and, when not connected, show the exact `ur connect <provider>`
  command instead of failing opaquely.
- `ur connect status` reports connection state for every provider; keys are read
  from stdin (not argv/shell history) and never written to plaintext settings.

## 1.30.6

- Restore a visible `subscription` access entry in provider lists without
  exposing provider app bridges as normal runtimes.
- Keep subscription selection honest: no fake UR model IDs are listed, and the
  generic subscription entry is blocked until a real independent subscription
  runtime exists.

## 1.30.5

- Hide external app bridge providers from normal `/model`, `/provider`, and
  `ur provider list` output. The default provider UX now shows only UR-native
  API, local, and OpenAI-compatible server runtimes.
- Simplify the status bar to show only important runtime state: provider, model,
  mode, branch, active tasks, checks, and update signals. Product name, version,
  auth label, and idle task noise are omitted.

## 1.30.4

- Make the default provider runtime independent of provider apps. Codex CLI,
  Claude Code, Gemini CLI, and Antigravity are now treated as explicit external
  app bridges and are blocked from normal `/model`, config save, and runtime
  dispatch unless `UR_ENABLE_EXTERNAL_APP_PROVIDERS=1` is set.
- Keep API, local, and OpenAI-compatible providers as the UR-native runtime path
  so turns behave like Ollama: UR owns the conversation loop, tool loop, errors,
  and output instead of delegating to another agent app.

## 1.30.3

- Fix Codex CLI dispatch for real interactive terminals by inheriting terminal
  stdin for `codex exec`. Codex treats both `/dev/null` and closed pipes as
  piped stdin, so the previous `1.30.2` EOF approach still triggered
  `Reading additional input from stdin`.

## 1.30.2

- Fix Codex subscription dispatch failing with `exited 1 ... Reading additional
  input from stdin`. `codex exec` reads stdin even when the prompt is an
  argument; UR now gives it a closed, empty stdin pipe (EOF) instead of
  `/dev/null`, so a logged-in Codex CLI runs correctly. Other subscription CLIs
  are unchanged (prompt as argument, stdin ignored).

## 1.30.1

- Fix Codex CLI runtime dispatch by ignoring stdin when UR already passes the
  prompt as a command argument. This prevents `codex exec` from treating UR's
  closed pipe as extra stdin and exiting after `Reading additional input from
  stdin...`.

## 1.30.0

- IDE integration commands: `ur ide status`, `ur ide doctor`, and `ur ide config
  <editor>` for VS Code, Cursor, Windsurf, Zed, JetBrains, Neovim, and generic
  ACP clients. Status shows workspace, ACP server, provider/model, plugin count,
  and warnings; config generation states each editor's integration mechanism
  honestly (native extension, stdio ACP, or manual).
- ACP server completion: `initialize` now advertises capabilities and the
  workspace root; added `session/new`, `session/prompt`, and `session/cancel`;
  `shutdown` actually stops the server; added `--debug` request logging.
- New stdio Agent Client Protocol agent (`ur acp stdio`) so Zed and ACP-capable
  Neovim clients can launch UR natively, with `session/update` streaming.
- `ur plugin doctor` validates installed, project, and bundled plugin manifests
  and reports declared components and the capability surface; a broken plugin is
  reported without crashing the scan.
- VS Code Inline Diffs extension: explicit Apply (confirmed `git apply`) and
  Reject actions plus a status command; no silent writes.
- New docs: `docs/IDE.md`, `docs/ACP.md`, expanded `docs/plugins.md` (manifest
  reference, doctor, hooks, permissions, troubleshooting), and README quickstarts.

## 1.29.1

- Replace fabricated Claude Code and Gemini CLI static model names with
  provider-scoped CLI model aliases/names that the official CLIs can receive.
- Reject stale subscription CLI selections such as `claude-code/sonnet-5` before
  runtime dispatch instead of forwarding `sonnet-5` to Claude Code.
- Summarize subscription CLI model/account failures with provider, model,
  suggested action, and an explicit no-cross-provider-fallback note.

## 1.29.0

- Customer release consolidating the multi-provider selection and runtime
  dispatch work (1.27.5–1.28.1) into a single production line.
- System-prompt identity now reflects the selected provider and runtime backend
  (e.g. "running through the Codex CLI provider"), so the assistant's self-report
  matches the `/model` choice instead of a generic default.
- Refresh documentation to cover the full provider/model feature set: provider-
  first `/model` flow, provider-scoped discovery, real subscription CLI dispatch,
  native API wire formats, runtime backends, and troubleshooting.

## 1.28.1

- Keep the status bar synchronized with in-session provider/model changes from
  `/model`, `/model <model>`, and `/provider`, instead of waiting for persisted
  settings to reload.
- Add a regression test proving the status bar prefers the active in-session
  provider/model over stale persisted settings.

## 1.28.0

- Subscription CLI providers (Codex, Claude Code, Gemini, Antigravity) now
  perform real dispatch: the official CLI is spawned in non-interactive mode with
  the scoped model and prompt, and its stdout becomes the response. Non-zero exit
  or empty output fails clearly instead of returning placeholder text.
- API providers now use each provider's native wire format: Anthropic
  `x-api-key` + `anthropic-version` on `/v1/messages`, OpenAI `Authorization:
  Bearer` on `/v1/chat/completions`, Gemini `x-goog-api-key` on
  `:generateContent`, routed by a new provider-family classifier.
- Real runtime provider identity: `getRuntimeProviderId`/`getProviderFamily`
  expose the true selected provider; `getAPIProvider` is derived from it rather
  than string-matching raw settings.
- Fix saved local/server (live-discovery) model pairs being rejected on a cold
  process; the endpoint is treated as the source of truth before discovery runs.
  Static (API/subscription) pairs remain strictly validated.
- Add behavior-proving tests that exercise the real clients (CLI runner, mocked
  HTTP) and assert wire format, response content, identity, and cold-cache
  restart — not just provider-id routing. Centralize the Ollama default and
  remove dead code.

## 1.27.6

- Route runtime requests through the selected provider/model pair instead of
  allowing stale Ollama/default-provider paths to handle non-Ollama requests.
- Add runtime dispatch validation, backend labels, and focused mocked dispatch
  tests for subscription CLI, API, Ollama, and OpenAI-compatible providers.
- Fix malformed message rendering from crashing startup when an undefined entry
  appears in the UI message list.

## 1.27.5

- Make `/model` provider-first and provider-scoped, with clear subscription,
  API-key, local runtime, and OpenAI-compatible server labels.
- Keep model discovery, validation, fallback, and saved config scoped to the
  selected provider so CLI, API, and local model lists do not leak into each
  other.
- Update provider documentation and tests for the provider/model selection
  flow.

## 1.25.3

- Add provider alias resolution so `ur config set provider claude`,
  `ur config set provider "Claude Code"`, and `ur provider doctor agy`
  resolve to canonical provider IDs.
- Detect the official Antigravity `agy` CLI command for auth and doctor checks.
- Update provider documentation and status-bar examples for the 1.25.3 release.

## 1.25.2

- Refresh public documentation so README, docs, static site, validation runbook,
  and code inventory all describe the current UR-Nexus feature set.
- Document the recent provider auth, status bar, bundled VS Code extension,
  `ur upgrade`, and AskUserQuestion schema fixes as first-class release
  behavior.
- Bump package, Bun macro, VS Code extension, and validation examples to the
  1.25.2 release line.

## 1.25.1

- Fix VS Code extension installation to use the bundled UR-Nexus inline-diffs extension instead of the stale unpublished `urhq.ur` marketplace ID.
- Harden AskUserQuestion normalization for description-only option objects and keep the eight-option schema in the production bundle.

## 1.25.0

- Add legal multi-provider auth/provider management for subscription CLI, API-key, and local runtime access paths.
- Add provider doctor/status/config commands, provider-aware status bar display, and explicit no-token-scraping safety policy.
- Relax plan-mode clarification choices so professional redesign prompts do not fail when more than four options are supplied.

## 1.24.0

### Added
- Plugin marketplace capability metadata for MCP tools, executable skills,
  templates, validators, language adapters, LSP servers, hooks, agents, and
  commands.
- Bundled `engineering-discipline` reference plugin with `/discipline-check`,
  `reproducible-release`, release-verifier template, release-gate validator,
  and Markdown language-adapter metadata.
- Release readiness test that keeps production bundle, release, package, and
  global-install GitHub checks behind successful Bun tests.

### Changed
- npm package now includes `plugins/` and documents the
  marketplace surfaces in the npm README.
- UR product positioning is documented as an autonomous engineering workflow
  engine for plan, execute, test, verify, document, benchmark, and reproduce.

## 1.23.3

### Fixed
- `repoIndex` tests failing in CI because `listIndexableFiles` silently returned `[]` when ripgrep (`rg`) was unavailable. Added a Node.js recursive file walker fallback that applies the same extension and skip-segment filters.

## 1.23.2

### Added
- **CI failure diagnostics** in `.github/workflows/test.yml`: environment-info step, verbose test reporter, captured `test-output.log`, and artifact upload on failure so the production test runner exposes which test fails without requiring admin log access.

### Fixed
- 

## 1.23.1

### Added
- **CI agent (`ur ci-loop`)** with agent constitution: hard rules against hiding failures, deleting without approval, editing generated/vendor files, claiming tests passed without execution, and changing public API without warning.
- **Plugin marketplace extensibility** for `templates`, `validators`, and `languageAdapters` alongside existing MCP tools and skills.

### Changed
- UR identity updated to "autonomous engineering workflow engine (plan, execute, test, verify, document, benchmark, reproduce)".

## 1.22.8

### Added
- 

### Changed
- 

### Fixed
- 

## 1.22.7

### Added
- **Benchmark mode (`ur eval`).**
  - `ur eval run <suite> [--model <m>] [--metrics]` runs eval suites with explicit model overrides and per-case metrics files.
  - `ur eval report <suite>` now surfaces rollbacks, test pass rate, files changed, command failures, human edits, cost, time, and tokens.
  - `ur eval compare <suite> <label1> <label2>...` runs the same suite against multiple model/runner labels and prints a comparison matrix.
  - `ur eval route "<task>" [--strategy auto|cheap|strong|default]` recommends a model using the capability router.
- **Public leaderboard and built-in benchmark suites.**
  - `ur eval builtin list` shows six small built-in suites: `bug-fix`, `refactor`, `test-gen`, `docker-repair`, `ts-migrate`, `py-package-repair`.
  - `ur eval builtin <id>` installs a suite under `.ur/evals/`.
  - `ur eval leaderboard [--format html|json|md] [<suite>]` writes a public leaderboard from saved reports.
- **Model routing integration.**
  - Added `RouteStrategy`, `ModelPool`, and `resolveModelForTask` in `src/services/agents/modelRouter.ts` with `src/services/agents/modelPool.ts` config.
  - `makeCliEvalRunner` accepts a per-run `model` override.
  - Background tasks (`startBackgroundTask`) support `routeStrategy` and resolve the model from the local pool before spawning.
  - Bundled skills (`debug-v2`, `security-review`, `refactor`, `benchmark`, `dockerize`) now prompt the agent to use `route: strong/auto` hints.

### Changed
- `ur eval` CLI now accepts `[action] [name] [rest...]` and `--model` / `--strategy` flags to support compare and route subcommands.
- `EvalRunMetrics` gained `rollbacks`; `EvalReport` gained `totalRollbacks`; report and dashboard now display them.
- `startBackgroundTask` and `fanoutBackgroundTasks` are now async so they can resolve model routing from local capabilities.

### Fixed
- Fixed `ur task run <id>` so it starts the queued worktree task created by
  `ur task start` instead of creating a second background task whose prompt is
  the id.
- Added explicit sandbox approval levels for `read-only`, `edit project`,
  `run safe commands`, `run network commands`, and `destructive commands`.
- Made task PR summaries PR-shaped and evidence-safe: they now include a
  labeled summary, changed files, tests run, detected verification commands,
  risks, rollback command, and remaining TODOs without claiming tests ran when
  UR has no recorded evidence.
- Extended CI-loop failure memory so failed commands record attempted fixes and
  eventual resolutions, allowing future similar failures to surface the fix
  history.

### Verified
- Added focused coverage for approval-level mapping, `ur task start` to
  `ur task run`, PR-quality output sections, and CI-loop failure memory.
- Added `test/evalCompare.test.ts` and `test/evalBenchmarkSuites.test.ts` for compare matrices, built-in suites, and leaderboard rendering.
- Updated `test/execCommand.test.ts` for the async `runExecPool` signature.
- Verified source and production bundle release checks for the `1.22.7` build.

## 1.22.6

### Fixed
- Fixed Bash tool runtime execution failing every command with
  `timeoutMs is not defined` by keeping the command hook timeout value in scope
  before lifecycle hooks run.
- Fixed Edit/Update tool runtime execution failing with
  `toolUseContext is not defined` by preserving the full tool context inside
  file edit calls.

### Verified
- Added lifecycle runtime regressions for both `BashTool.call` and
  `FileEditTool.call`.
- Verified source and production bundle release checks for the `1.22.6` build.

## 1.22.3

### Added
- **Executable skill directories.** A `.ur/skills/<name>/` directory containing
  `skill.yaml` is now an executable skill that compiles into a `WorkflowSpec`.
  Supports `instructions.md`, `scripts/`, `templates/`, and `checklists/`.
  `src/skills/skillSpec.ts` parses, validates, and compiles skills; step prompts
  support `$ARGUMENTS`, `$0..$N`, and `$ARGUMENTS[N]` substitution.
- **`ur skill` CLI.** New command surface: `ur skill list`, `ur skill show <name>`,
  `ur skill run <name> [args]`, and `ur skill init <name>`. Registered in
  `src/commands.ts` and `src/main.tsx`.
- **Semantic repo index.** `src/utils/codeIndex/repoIndex.ts` builds offline,
  dependency-free indexes under `.ur/code-index/`: `repo.json` (file
  classification + imports/importedBy), `symbols.json`, `calls.json`,
  `tests.json`, `docs.json`, and `configs.json`. `ur code-index repo` exposes
  `build|status|search|symbols|callers|tests|docs|configs` subcommands.
- **`--repo` flag for code-index build/watch.** `ur code-index build --repo`
  builds both the embedding index and the repo index; `watch --repo` refreshes
  the repo index on file changes.

### Changed
- Reused the existing workflow engine for executable skills and extended the
  existing `ur code-index` surface for the repo index, keeping changes additive.

### Verified
- Added `test/skillSpec.test.ts`, `test/skillCommand.test.ts`, and
  `test/repoIndex.test.ts` covering skill parsing, compilation, CLI scaffolding,
  repo file classification, symbol/call/test/doc/config extraction, and index
  round-trips.

## 1.22.5

### Added
- **Real sandbox core architecture (`ur sandbox`).** New first-class command to inspect sandbox status, run dependency checks, initialize `.ur/safety-policy.json`, and evaluate shell-command approval levels.
- **Worktree-per-task (`ur task`).** New command surface to start, run, list, and hand off agent tasks in isolated git branches/worktrees: `task start <name> [--worktree]`, `task run <id>`, `task pr <id> [--create]`, `task list`, `task status <id>`.
- **PR-quality output formatter (`src/services/agents/prSummary.ts`).** Every task/PR result includes summary, changed files, tests to run, risks, rollback command, and remaining TODOs.
- **Failure memory (`src/services/agents/failureMemory.ts`).** Failed shell commands are recorded in project memory via `BashTool.tsx`, and similar previous failures are surfaced as hints in subsequent errors.

### Changed
- Registered `sandbox` and `task` commands in `src/commands.ts` and `src/main.tsx`.
- Failure path in `src/tools/BashTool/BashTool.tsx` now records failures and prepends historical hints.

### Verified
- `bun run typecheck`, `bun run lint`, `bun run test` (500 pass), `bun run bundle`, and `bun run smoke` all pass.

## 1.22.4

### Added
- **AST-aware `ur repo-edit` (P7).** Added
  `src/services/repoEditing/ast/types.ts`,
  `src/services/repoEditing/ast/workspaceEdit.ts`,
  `src/services/repoEditing/ast/diagnostics.ts`,
  `src/services/repoEditing/ast/typescriptEngine.ts`,
  `src/services/repoEditing/ast/lspEditEngine.ts`,
  `src/services/repoEditing/ast/engineRouter.ts`,
  `src/services/repoEditing/ast/treeSitterEngine.ts`, and
  `src/services/repoEditing/ast/repoEditAst.ts`.
- **`rename`.** Binding-aware rename for TS/JS via `ts.createProgram` + type
  checker; LSP rename via `textDocument/prepareRename` + `textDocument/rename`
  for Python/Rust/Go and TS/JS opt-in; Tree-sitter best-effort identifier fallback.
- **`move`.** Move a TS function/class to another file with source removal and
  target insertion.
- **`organize-imports`.** Sort import blocks alphabetically for TS/JS files.
- **`unused`.** List unused local variables via TypeScript reference analysis.
- **`callers`.** Map direct callers of a TS function.
- **Diagnostics before/after edits with rollback.** Each apply path collects a
  `DiagnosticSnapshot`, applies edits, then re-collects. New errors or a failing
  `--check` command roll back all changed files.
- **LSP editing support.** `LSPServerInstance.ts` advertises `textDocument.rename`
  and `workspace.applyEdit`; `LSPServerManager.ts` handles reverse
  `workspace/applyEdit` requests.

### Changed
- `src/commands/repo-edit/repo-edit.ts` dispatches the new `rename`, `move`,
  `organize-imports`, `unused`, and `callers` subcommands while keeping legacy
  `plan/preview/apply rename` paths working.

### Verified
- Added `test/repoEditAst.test.ts`, `test/typescriptEngine.test.ts`,
  `test/repoEditMove.test.ts`, `test/repoEditImports.test.ts`, and
  `test/repoEditReadOps.test.ts` covering binding-aware rename, cross-file
  import updates, rollback on check failure, move, organize imports, unused
  detection, and caller mapping.

## 1.22.2

### Added
- **Lifecycle hooks.** Added six new hook events in `src/entrypoints/sdk/coreTypes.ts`
  and `src/entrypoints/sdk/coreSchemas.ts`: `BeforeEdit`, `AfterEdit`,
  `BeforeCommand`, `AfterCommand`, `BeforeCommit`, and `OnFailure`. Dispatchers
  in `src/utils/hooks.ts` run them around file edits, shell commands, git commits,
  and failure paths. Call sites are wired in `FileEditTool`, `BashTool`,
  `PowerShellTool`, `toolExecution.ts`, and `query.ts`. Hooks are advisory by
  default and can block actions or append project memory.
- **Persistent project memory.** Extended `TaskMemoryKind` in
  `src/services/context/projectContextManifest.ts` with `architecture`,
  `preference`, `attempt`, `accepted`, and `rejected`. Entries now support
  `status`, `rationale`, `alternativeTo`, `supersedesId`, `scope`, and `source`
  metadata. `ur context-pack remember` accepts the new kinds and metadata flags.

### Changed
- **Compressed context** now includes sections for all memory kinds, including the
  new project-memory categories.

### Verified
- Added `test/lifecycleHooks.test.ts` covering the new `HOOK_EVENTS` literals and
  Zod schema validation.
- Added `test/projectMemory.test.ts` covering append/read/compress/summarize for
  the new memory categories and metadata.

## 1.22.1

### Added
- **Rich task decomposition.** `src/services/agents/decomposer.ts` splits large
  goals into atomic subtasks with `goal`, `filesTouched`, `risk` (low/medium/high),
  `testsRequired`, and `rollbackPoint`. `ur crew create|run|plan ... --decompose`
  uses it; a deterministic fallback keeps the command offline and fast, while a
  headless subagent path produces structured JSON.
- **Parallel specialized subagents.** New `parallel` multi-agent pattern in
  `src/services/agents/patterns.ts`: bug finder, patch writer, test writer,
  security auditor, and style reviewer run concurrently, then a synthesizer
  merges their outputs. Run it with
  `ur pattern parallel "<task>" --execute [--dry-run]`.
- **AgentKernel abstraction.** `src/services/agents/kernel.ts` is a pure
  orchestrator with seven roles: planner, executor, verifier, critic, memory,
  router, and guard. `ur spec run|verify <name> --kernel` routes through kernel
  stages while the legacy path stays the default.
- **Spec verification / verifier kernel role.** `ur spec verify <name>` runs
  deterministic `.ur/verify.json` project gates, then a read-only deep
  verification subagent that must prove compile/test/lint/diff/runtime before
  `VERDICT: PASS`. Persists `.ur/specs/<name>/verification.md` and records the
  result in `spec.json`.

### Changed
- **Version bump.** Updated from 1.22.0 to 1.22.1 across `package.json`,
  `bunfig.toml`, the VS Code extension manifest, and the bundled CLI.

### Verified
- Added `test/decomposition.test.ts`, `test/parallelPattern.test.ts`, and
  `test/kernel.test.ts` covering decomposition metadata, parallel pattern
  workflow execution, and all seven kernel roles.

## 1.22.0

### Added
- **Agent execution metrics in `ur eval`.** `ur eval run` now captures
  cost, input/output tokens, model used, API duration, files changed,
  insertions/deletions, command failures, human-edit heuristics, and optional
  per-case `testCommand` results. Metrics are written by the headless child
  via `UR_EVAL_METRICS_FILE`, so future parallel eval runs stay safe.
- **Richer eval dashboard.** `ur eval dashboard` and
  `ur eval report <suite> --dashboard` generate local HTML dashboards with
  summary cards (pass rate, test pass rate, cost, tokens, files changed, command
  failures, human edits, duration) and a per-case timeline showing model, time,
  cost, tokens, diffs, test result, and output preview.
- **Per-case run metrics persistence.** `ur eval run <suite> --metrics` writes
  each case's metrics to `.ur/evals/.runs/<suite>/<case>.json` for downstream
  analysis.
- **Benchmark-style reporting.** `formatEvalReport` prints aggregate cost,
  tokens, files changed, command failures, human edits, duration, and test pass
  rate alongside the pass-rate summary.
- **Spec verification / verifier kernel role.** `ur spec verify <name>` runs
  deterministic project gates from `.ur/verify.json`, then invokes a read-only
  deep verification subagent that must demonstrate compile/test/lint/diff/runtime
  proof before emitting `VERDICT: PASS`. Results are persisted to
  `.ur/specs/<name>/verification.md` and recorded in `spec.json` so `ur spec status`
  shows the latest verdict.
- **AgentKernel abstraction.** Added `src/services/agents/kernel.ts`, a pure
  orchestrator with seven roles: planner, executor, verifier, critic, memory,
  router, and guard. `ur spec run <name> --kernel` and
  `ur spec verify <name> --kernel` route through kernel stages while the legacy
  loop remains the default. `src/services/agents/kernelSpec.ts` provides
  spec-to-stage adapters.
- **Rich task decomposition.** Added `src/services/agents/decomposer.ts`. `ur crew
  create|run|plan ... --decompose` splits a goal into atomic subtasks with
  `goal`, `filesTouched`, `risk` (low/medium/high), `testsRequired`, and
  `rollbackPoint` metadata. A deterministic fallback keeps it offline and fast;
  the model path asks a headless subagent for structured JSON.
- **Parallel specialized subagents.** Added `parallel` multi-agent pattern in
  `src/services/agents/patterns.ts`. Bug finder, patch writer, test writer,
  security auditor, and style reviewer run in parallel, then a synthesizer merges
  the results. `ur pattern parallel "<task>" --execute` runs it via the workflow
  executor with concurrency matching the number of parallel agents.

### Changed
- **`makeCliEvalRunner` resets cost state per case**, reads child metrics,
  gathers `git diff --stat` totals, runs `expect.testCommand` when present, and
  returns an `EvalRunMetrics` object with best-effort command-failure and
  human-edit counts.
- **Version bump.** Updated from 1.21.0 to 1.22.0 across `package.json`,
  `bunfig.toml`, and the VS Code extension manifest.

### Verified
- Added `test/evalMetrics.test.ts` and `test/evalDashboard.test.ts` covering
  child metrics serialization, report aggregation, dashboard HTML rendering,
  HTML escaping, and run-metrics persistence.
- Added `test/specVerify.test.ts` covering dry-run verification, gate fast-fail,
  verification record persistence, and verifier prompt construction.
- Added `test/kernel.test.ts` covering all seven kernel roles and the spec
  run/verify kernel adapters.
- Added `test/decomposition.test.ts` covering deterministic decomposition, risk
  heuristics, LLM-driven dry-run decomposition, and crew metadata persistence.
- Added `test/parallelPattern.test.ts` covering the `parallel` pattern stages,
  workflow compilation, and dry-run execution through the workflow executor.

## 1.21.0

### Added
- **Agent skill runner (`agentSkillRunner.ts`).** Reusable helper that wraps
  `startBackgroundTask({ worktree: true, pr: true })`, polls the background
  manifest to completion, and returns a PR-style summary with branch, commits,
  PR URL, and diff summary.
- **New slash skills for agent worktrees.** Added `/debug-v2`, `/refactor`,
  `/paper-implementation`, `/benchmark`, `/security-review`, `/dockerize`, and
  `/latex-paper` bundled slash skills. Each expands into a prompt that instructs
  the model to work in an isolated git worktree and produce a clean branch,
  commits, and PR.
- **Matching agent templates.** Added `debug-v2`, `refactor`, `paper-implementation`,
  `benchmark`, `security-review`, `dockerize`, and `latex-paper` templates to
  `AGENT_TEMPLATES`; install them with `ur agent-templates install`.
- **`ur worktree` command.** Added `ur worktree list|status|clean` to inspect
  and clean up UR agent worktrees created by background runs.

### Changed
- **Background runner exports.** Exported `commitIfNeeded` and `createPullRequest`
  from `backgroundRunner.ts` so the agent skill runner can inspect and finalize
  PR state.
- **Version bump.** Updated from 1.20.0 to 1.21.0 across `package.json`,
  `bunfig.toml`, the VS Code extension manifest, and the bundled CLI.

### Verified
- Added tests for the agent skill runner, each new bundled skill, and the new
  `ur worktree` command.

## 1.20.0

### Added
- **ACP server (`ur acp`).** Added an HTTP+JSON-RPC Agent Communication
  Protocol server for IDE extensions. Supports `initialize`, `tools/list`,
  `tools/call`, `tasks/send`, `tasks/get`, `tasks/cancel`, and `shutdown`.
  Runs on `127.0.0.1:8123` by default with optional bearer-token auth.
- **`ur exec` pool execution.** Added a non-interactive pool command that runs
  one or more prompts with optional concurrency, worktrees, output capture,
  and dry-run mode.
- **GitHub tool.** Added `GitHubTool` for PR/issue/repo operations via the
  `gh` CLI.
- **API tool.** Added `ApiTool` for REST HTTP calls with JSON/text output.
- **Browser tool.** Added `BrowserTool` for headless browser automation
  (fetch/goto/click/type/evaluate/screenshot). Disabled by default; enable
  with `UR_BROWSER_TOOL=1`.
- **Docker tool.** Added `DockerTool` wrapping the `docker` CLI for container
  and compose operations.
- **Test-runner tool.** Added `TestRunnerTool` that auto-detects the project
  test command from `package.json` scripts, `Makefile`, `Cargo.toml`,
  `pyproject.toml`, or `go.mod`.
- **Database tool.** Added `DatabaseTool` for SQL queries against SQLite,
  Postgres, MySQL, and DuckDB.

### Changed
- **Tool surface.** File-system and terminal tools (`FileRead`, `FileEdit`,
  `FileWrite`, `Glob`, `Grep`, `Bash`, `PowerShell`) are now automatically
  exposed through the existing MCP server and the new ACP server.
- **Version bump.** Updated from 1.19.0 to 1.20.0 across `package.json`,
  `bunfig.toml`, the VS Code extension manifest, and the bundled CLI.

### Verified
- Added focused tests for the ACP server/client, `ur exec`, GitHub tool,
  API tool, browser tool, Docker tool, test-runner tool, and database tool.

## 1.19.0

### Added
- **Permission and safety policy (`ur safety`).** Added a project shell safety
  evaluator that separates read, write, execute, and network command classes;
  asks before destructive commands; recommends sandboxing for risky operations;
  and denies common secret-file and secret-like environment exfiltration paths.
- **Bash permission integration.** The project safety policy now runs before
  broad Bash allow paths and sandbox auto-allow, so destructive commands still
  require approval and secret exfiltration is blocked even when permissive
  command rules exist.
- **Project context pack (`ur context-pack`).** Added repo architecture
  scanning from manifests, instruction files, Project DNA, verify gates, and
  safety config. Task memory records decisions, constraints, commands, diffs,
  and notes under `.ur/context/`, with compression into a durable summary.

### Changed
- **Chrome/Desktop links.** Replaced deprecated Chrome and desktop documentation
  links in source with current `ur.ai` URLs.
- **Version bump.** Updated from 1.18.0 to 1.19.0 across `package.json`,
  `bunfig.toml`, the VS Code extension, and bundled CLI metadata.

### Verified
- Added focused tests for safety policy decisions, policy file creation,
  context manifest generation, task memory compression, CLI command parsing,
  and updated agent feature/trend inventories.

## 1.18.0

### Added
- **Test-first execution loop (`ur test-first`).** Added a P0 quality loop that
  detects the project stack, orders compile/test/lint commands, runs them as
  command evidence, invokes a bounded fix agent on failure, and refuses a
  passing status unless the detected commands exit 0.
- **Failure trace store.** Failed commands write inspectable logs under
  `.ur/test-first/traces/` with timestamp, phase, command, exit code, stdout,
  and stderr.
- **Edit-time gate installer.** `ur test-first install` and
  `ur test-first --install-gates` merge detected commands into
  `.ur/verify.json` so the existing verifier can run them after file edits.

### Changed
- **Typecheck classification.** Project DNA now classifies Node/TypeScript
  `typecheck` scripts as compile evidence instead of test evidence.
- **Version bump.** Updated from 1.17.0 to 1.18.0 across `package.json`,
  `bunfig.toml`, the VS Code extension, and bundled CLI metadata.

### Verified
- Added focused tests for stack detection, verify-gate installation, failure
  trace persistence, retry-through-fix behavior, and CLI argument parsing.

## 1.17.0

### Added
- **Reliable repo editing (`ur repo-edit`).** Added a P0 repo-editing workflow
  with dependency-free file/symbol indexing, indexed search, AST-aware
  JavaScript/TypeScript identifier rename planning, explicit patch preview, and
  transactional multi-file apply.
- **Rollback-safe refactors.** `ur repo-edit apply rename ...` writes all
  planned files as one operation, validates syntax, optionally runs
  `--check <cmd>`, and restores every touched file if validation fails.

### Verified
- Added focused tests for repo edit indexing/search, AST rename planning that
  leaves strings and comments untouched, patch preview without writes, and
  rollback after failed checks.

## 1.16.0

### Added
- **Network Ollama discovery.** `ur --discover-ollama` scans active local subnets
  for Ollama servers on port 11434, verifies each via `/api/tags`, and shows an
  interactive host picker. The chosen host is used for that session only; plain
  `ur` continues to default to `localhost:11434` unless `ollama.host` is set
  explicitly.
- **`--ollama-host <url>` CLI flag.** Point UR at a specific Ollama server for a
  single session without writing settings.
- **`ollama` settings block** in `~/.ur/settings.json` with `host` and
  `lanDiscovery` keys.

### Changed
- **Version bump.** Updated from 1.15.0 to 1.16.0 across `package.json`,
  `bunfig.toml`, the VS Code extension, and bundled CLI.

### Verified
- Added `test/ollamaDiscovery.test.ts` and updated `test/ollamaModels.test.ts`.
- Rebuilt `dist/cli.js` and verified typecheck, full test suite, bundle,
  package check, and version output.

## 1.15.0

### Changed
- **Version bump.** Updated from 1.14.0 to 1.15.0 across `package.json`, `bunfig.toml`, and bundled CLI.

### Verified
- Rebuilt `dist/cli.js` at 1.15.0 and verified release check, package check, and version output.

## 1.14.1

### Changed
- Removed the `desktop-app` startup tip pointing to the legacy desktop URL.

### Changed
- **Version bump.** Updated from 1.14.0 to 1.14.1 across `package.json`, `bunfig.toml`, and bundled CLI.

## 1.14.0

### Changed
- **Version bump.** Updated from 1.13.9 to 1.14.0 across `package.json`, `bunfig.toml`, and bundled CLI.

### Verified
- Rebuilt `dist/cli.js` at 1.14.0 and verified release check, package check, and version output.

## 1.13.9

### Added
- **Spec-driven development (`ur spec`).** Scaffolds `requirements.md ->
  design.md -> tasks.md` plus a phase/approval `spec.json` under `.ur/specs/`,
  then drives execution task-by-task through a headless agent, checking off each
  task on a PASS verdict. Tasks use the GitHub Spec Kit / Kiro `- [ ] T1: ...`
  checkbox format, so lists are drop-in portable. `generate` can model-fill a
  phase; scaffolding and task parsing stay pure and offline.
- **In-loop model escalation / local Oracle (`ur escalate`).** Picks a fast tier
  and a strong "oracle" tier from `ur model-doctor`, starts routine work on the
  fast model, and auto-escalates hard reasoning/debug/review (or a failed cheap
  attempt) to the oracle. `escalate oracle` gets a one-shot second opinion;
  `escalate policy` pins tiers. Tier selection and difficulty scoring are
  deterministic and testable.
- **Multi-agent best-of-N judging (`ur arena`).** Runs N agents on the same task
  in isolated git worktrees, judges the resulting diffs with the deterministic
  self-review gate plus verdict/diff-shape heuristics, surfaces the winner, and
  can `--apply` it. Local-first take on parallel-agent judging.
- **Self-healing CI loop (`ur ci-loop`).** Runs a build/test command and, on
  failure, summarizes the error, hands it to a fix agent, and re-runs with a
  bounded retry budget; `--commit`/`--push` are gated by the self-review check so
  a fix can never push secrets. `--from-log` seeds the first failure from a log.
- **Verifiable artifacts surface (`ur artifacts`).** Records reviewable
  deliverables (plans, diffs, test runs, screenshots) under `.ur/artifacts/`
  with pending/approved/rejected status and threaded feedback; `capture-diff`
  and `capture-tests` snapshot the working tree and test output for audit.

### Verified
- Added focused unit suites for escalation, arena judging, the spec workflow,
  the CI loop, and artifacts (26 tests); rebuilt `dist/cli.js` and verified
  typecheck, the full test suite, release check, package check, secret scan,
  version output, npm publish dry-run, and direct CLI smoke tests for
  `ur spec`, `ur arena`, and `ur escalate`.

## 1.13.8

### Fixed
- **Image paste resize fallback.** Clipboard image paste now falls back to
  macOS `sips` when the normal Sharp/native resize path cannot process an
  oversized pasted image.
- **Under-limit image passthrough.** Images whose base64 payload is already
  within the API limit now pass through even if local dimension downsampling
  fails, avoiding unnecessary `Unable to resize image` paste failures.

### Verified
- Rebuilt `dist/cli.js` at 1.13.8 and verified focused image resize tests,
  typecheck, full test suite, release check, package check, secret scan, and
  npm publish dry-run.

## 1.13.7

### Added
- **Explicit update notice.** Interactive sessions now show
  `Update available: <current> -> <latest>` when a newer published package is
  detected, before auto-update starts or when manual action is needed.

### Changed
- Normalized `ur update` output across npm, Homebrew, winget, and apk paths so
  all update notices use the same current-to-latest version wording.

### Verified
- Rebuilt `dist/cli.js` at 1.13.7 and verified the update notice helper tests,
  typecheck, full test suite, release check, package check, secret scan, and npm
  publish dry-run.

## 1.13.6

### Added
- **Professional static documentation site.** Added `documentation/` with a
  full HTML/CSS/JS documentation project covering installation, architecture,
  feature map, tutorials, command reference, slash command families,
  configuration, project files, examples, and troubleshooting.
- **Packaged documentation asset.** Added `documentation` to the npm package
  files list and linked the static site from the root README.

### Verified
- Rebuilt `dist/cli.js` at 1.13.6 and verified the documentation site scripts,
  release check, package check, secret scan, and npm publish dry-run.

## 1.13.5

### Added
- **Headless agent crews.** Added `ur crew` for lead/worker task boards that
  split a goal into subtasks, let worker subagents claim work, and support
  parallel dry-runs or live execution.
- **Long-horizon goals.** Added `ur goal` for persistent objectives with
  progress notes, workflow or pattern links, and resumable execution.
- **Model routing.** Added `ur model-route` to recommend the best local Ollama
  model for a task by capability fit.
- **Trigger bridge.** Added `ur trigger` for parsing GitHub, Slack, and generic
  webhook payloads and optionally launching a headless UR run.
- **Embeddable SDK surface.** Added `ur sdk` plus `src/sdk` helpers so projects
  can drive UR programmatically and scaffold TypeScript/Python examples.

### Changed
- **Automation and model diagnostics.** Expanded automation scheduling support,
  model-doctor reporting, agent feature scaffolds, and trend coverage for the
  new crew, goal, trigger, model-route, and SDK surfaces.

### Verified
- Rebuilt `dist/cli.js` at 1.13.5 and prepared npm package metadata for
  `ur-nexus@1.13.5`.

## 1.13.4

### Added
- **Parallel workflow execution.** The declarative workflow executor now runs
  independent ready steps concurrently. `ur workflow run --concurrency <n>`
  caps fan-out width (`1` forces sequential); approval gates and the
  verification/review loop still run sequentially so existing semantics are
  preserved exactly.
- **Live multi-agent dashboard.** `ur workflow run --live` streams a real-time
  execution board (per-step state, verdicts, and parallel-wave grouping) driven
  straight from executor events — the live counterpart to the post-hoc
  `ur agent-inspect` timeline.
- **More orchestration patterns.** Added `concurrent` (parallel fan-out/fan-in),
  `handoff` (triage → specialist), and `debate` (propose → critique → moderate
  loop) alongside PEER and DOE, completing the
  sequential/concurrent/handoff/group-chat/manager-loop taxonomy. Patterns can
  now compile into true DAGs (stage `dependsOn`), and `ur route` recommends the
  new patterns.
- **Public eval harness.** New `ur eval init|list|validate|run|report` runs
  replayable, gradeable cases (contains / notContains / regex / verdict / length
  checks) grouped by category, with deterministic offline grading and a
  `--dry-run` mode. Seeds a starter suite under `.ur/evals/`.
- **A2A delegation tokens.** Signed (HMAC-SHA256), attenuated, expiring
  capability tokens scoped to specific skills and bound to one audience.
  `ur a2a token mint|verify`, enforced by the A2A task server (static bearer
  still works), advertised in the Agent Card `securitySchemes`.

### Verified
- Full test suite green (workflow parallelism, patterns, live board, eval
  grading, and delegation each covered); `tsc --noEmit` clean; `dist/cli.js`
  rebuilt and smoke-tested through the CLI.

## 1.13.3

### Added
- **Checkpointed agent workflows.** Added `ur workflow` for declaring,
  validating, graphing, planning, resuming, and dry-running multi-step agent
  workflows with checkpoints and gates.
- **Multi-agent collaboration patterns.** Added `ur pattern` for PEER and DOE
  workflows, including install, save, dry-run, and live execution paths.
- **Agent routing and inspection.** Added `ur route` for task-to-subagent
  recommendations and `ur agent-inspect` for reconstructing per-subagent
  timelines from session transcripts.
- **Curated project knowledge base.** Added `ur knowledge` for registering
  file, directory, and note sources, building lexical or local-Ollama embedding
  indexes, searching, pruning, and reporting status.

### Changed
- **Agent feature roadmap coverage.** Expanded `ur agent-features` and
  `ur agent-trends` to include collaboration patterns, workflows, inspection,
  routing, and knowledge-base surfaces.

### Verified
- Rebuilt `dist/cli.js` at 1.13.3 and prepared npm package metadata for
  `ur-nexus@1.13.3`.

## 1.13.2

### Added
- **Top-level code-index and role-mode commands.** `ur code-index` and
  `ur role-mode` are now registered in the main CLI, matching the shipped
  command modules and help output.
- **Agent-task review controls.** `ur agent-task` now exposes `--force` and
  `--no-review` so PR creation can either override or skip the self-review gate
  intentionally.

### Fixed
- **Self-review PR diff coverage.** The pre-PR self-review now resolves a real
  base ref across local and remote branch names, includes committed branch
  changes, tracked working-tree changes, and untracked files.
- **macOS image paste reliability.** Clipboard image detection now recognizes
  TIFF-only pasteboard images, converts TIFF/BMP payloads to PNG before upload,
  and surfaces real image-read failures instead of reporting "no image found."

### Verified
- Rebuilt `dist/cli.js` at 1.13.2 and verified npm package metadata resolves
  to `ur-nexus@1.13.2`.

## 1.13.1

### Added
- **AGENTS.md as runtime context.** UR now loads `AGENTS.md` (the cross-tool
  standard) from project roots at runtime, alongside `UR.md` and `.ur/rules/`.
  It is loaded *before* `UR.md` so a repo's native `UR.md` keeps higher
  priority when both exist — drop-in compatibility with repos already using
  the standard, with zero setup.
- **Semantic code index + CodeSearch.** New local, embedding-based code search.
  `ur code-index build|search|status` builds an incremental vector index of the
  repository using the local Ollama app (embedding model configurable via
  `UR_CODE_INDEX_EMBED_MODEL`, default `nomic-embed-text`). When `UR_CODE_INDEX`
  is set, an opt-in read-only `CodeSearch` tool lets the agent find code by
  meaning alongside Grep/Glob. Fully local-first; no extra provider config.
- **OS-level execution sandbox.** UR's sandbox now actually enforces on macOS
  (Seatbelt via `sandbox-exec`) and Linux/WSL (bubblewrap), confining writes to
  the workspace + temp dirs. Enable with `sandbox.enabled: true`; block network
  egress with `UR_SANDBOX_BLOCK_NETWORK`. Reads remain unrestricted.
- **Self-review gate before PRs.** `ur agent-task pr --create` now runs a
  deterministic self-review of the diff first and blocks PR creation on
  high-severity findings (merge-conflict markers, hardcoded secrets, focused
  tests). Override with `--force`, or skip with `--no-review`.
- **Named role modes.** `ur role-mode list|show|install` ships Architect, Code,
  Debug, and Ask roles with scoped toolsets and role prompts, installable as
  `.ur/agents/*.md` so they work with the existing Agent tool and `/agents`.

### Fixed
- **Image paste hint.** When the clipboard holds no image, the image paste
  shortcut (`ctrl+v`, `alt+v` on Windows) no longer shows a circular "use
  ctrl+v to paste images" message — the very key that was just pressed. It now
  tells you to copy an image (e.g. a screenshot) first, then press the shortcut
  to paste it. SSH sessions keep the existing `scp` hint.

## 1.12.3

### Added
- **Agent feature expansion commands.** Added `ur agent-features`,
  `ur agent-templates`, `ur automation`, `ur agent-task`, `ur model-doctor`,
  `ur semantic-memory`, `ur claim-ledger`, and `ur browser-qa` so the agent
  platform roadmap is visible and executable from both CLI and slash command
  surfaces.
- **Opt-in A2A task server.** `ur a2a serve` now exposes loopback Agent Card,
  health, and dry-run task endpoints from the launcher, with off-loopback binds
  requiring a bearer token.
- **Project scaffolds and examples.** `ur agent-features init` creates reusable
  project assets for agents, automations, GitHub workflow entrypoints, A2A,
  memory, provenance, and browser QA, with `examples/agent_features.md`
  documenting the workflow.

### Fixed
- **Agent template typo safety.** `ur agent-templates install <name>` now
  rejects unknown template names instead of interpreting a misspelling as
  "install all templates."
- **Ollama model inspection request.** `ur model-doctor` now uses the preferred
  `/api/show` request body key (`model`) when inspecting local Ollama models.

### Verified
- Added focused Bun tests for feature scaffolds, template installation,
  automations, PR dry-run generation, local memory/provenance/browser QA
  commands, and the model-doctor Ollama request body.

## 1.12.2

### Changed
- **Ziggurat of Ur spinner.** Replaced the canoe spinner with the Ziggurat of
  Ur catching light: an up-pyramid whose lit face sweeps across (`△ ◭ ▲ ◮`)
  with a gold glint at the fully-lit peak.
- **Lapis & gold prompt.** The prompt input rules are now dashed lapis-lazuli
  (Standard of Ur), with a Standard-of-Ur gold chevron and a soft navy
  drop-shadow beneath the box so the prompt reads as a card floating above the
  surface.

## 1.12.1

### Changed
- **Mashoof spinner.** The activity spinner is now a Mashoof (مشحوف) — the
  marsh canoe — bobbing on the water. It cycles boat-hull arcs (`⌣ ⏝ ‿`) into
  a gentle up-down bob loop instead of the old dot→blocks→house growth, and
  the brightness "breathe" was dropped so it reads as a clean bob.

## 1.12.0

### Added
- **Agent trend coverage.** New `ur agent-trends` CLI command and
  `/agent-trends` slash command report how UR maps to current agent trends:
  local-first model runtime, MCP, A2A, durable workflows, multi-agent
  orchestration, memory, browser automation, provenance, evals, security,
  agent identity, and multimodal workflows. The report includes source
  references for each trend.
- **A2A Agent Card export.** New `ur a2a card` CLI command and `/a2a-card`
  slash command print UR-Nexus Card metadata for discovery by A2A-aware tools.
- **Professional trend docs.** `docs/AGENT_TRENDS.md` documents the coverage
  matrix, source/trust policy, and prioritized roadmap.

### Changed
- **Web-source trust guidance.** WebSearch and WebFetch prompts now explicitly
  treat search results and fetched pages as untrusted evidence, not instruction
  channels, while preserving source citation requirements.

## 1.11.3

### Changed
- **Read-only web browsing.** `WebSearch` and `WebFetch` now run without
  prompting by default, while still respecting explicit deny or ask rules.
- **Source visibility.** `WebFetch` tool results now include the fetched URL so
  final answers can mention where the result came from.

## 1.11.2

### Fixed
- **Clarification dialogs.** `AskUserQuestion` is now loaded without a
  `ToolSearch` round trip and accepts common question text aliases such as
  `prompt` and `text`, preventing malformed clarification attempts from
  surfacing as validation errors.

## 1.11.1

### Changed
- **Npm publication docs.** README installation guidance now reflects that
  `ur-nexus` is published on npm, while keeping the GitHub install path for
  source-based installs.

## 1.11.0

### Changed
- **Ollama model selection now lets routing work by default.** The launcher no
  longer forces `OLLAMA_MODEL` when neither `OLLAMA_MODEL` nor `UR_MODEL` is
  set, so UR's Ollama router can choose from the models exposed by the local
  Ollama app. The built-in fallback is `qwen3-coder:480b-cloud` when model-list
  discovery is unavailable.
- **Repository metadata now matches production.** Package metadata, docs, bundled
  issue links, marketplace defaults, and GitHub workflow templates now point to
  `Maitham16/UR`.

### Added
- **Release consistency gate.** `bun run release:check` verifies package,
  `bunfig.toml`, bundled CLI, docs, and launcher version output agree. It also
  runs automatically from `prepack`.
- **Quality notes.** `QUALITY.md` documents the release gate, runtime
  assumptions, safety boundaries, and known limits.
- **Stronger production CI.** The GitHub workflow now runs typecheck, tests,
  bundle, smoke, secret scan, release check, package dry-run, and global install
  verification.

### Fixed
- **Stale bundle/version drift.** The release process now prevents publishing a
  package where `package.json`, `dist/cli.js`, `bunfig.toml`, and `ur --version`
  disagree.
- **Ollama Cloud wording.** Docs now clarify that UR talks only to the local
  Ollama app, while models exposed by that app may be local or Ollama
  Cloud-backed.

## 1.10.2

### Fixed
- **Clipboard image paste — the fix that actually ships.** The 1.10.1 change edited the native NSPasteboard branch, which is dead-code-eliminated from the bundle (its feature gate compiles out), so it never ran. The live path is osascript, whose `saveImage` reused a fixed temp file (`ur_cli_latest_screenshot.png`) opened `with write permission` but never truncated — so a smaller image pasted over a previously larger one kept the old trailing bytes, producing a corrupt PNG ("found in clipboard but not attached"). Added `set eof fp to 0` to truncate before writing.

## 1.10.1

### Fixed
- **Clipboard image paste.** An image the clipboard reported as present but the native reader couldn't decode was silently dropped — "found in clipboard but not attached." `getImageFromClipboard` now falls back to the osascript path instead of treating a native `null` as authoritative.
- **Token truncation on Ollama Cloud models.** Cloud models (the `-cloud` / `:cloud` suffix) now default to a 128K-token context floor for both `num_ctx` and auto-compaction, instead of the small or missing value `/api/show` reports for them — so prompts are no longer silently truncated, with no env vars required. The reported value is still used when it is larger, and `UR_OLLAMA_NUM_CTX` (no longer capped to the detected value) / `OLLAMA_CONTEXT_TOKENS` still override.

### Changed
- **Default model** is now `qwen3-coder:480b-cloud` instead of `llama3.2`, so a session started without an explicit model no longer falls back to a 3B model.
- **Comment discipline now applies to all sessions.** UR's "default to writing no comments / don't explain WHAT the code does / verify it actually works before reporting complete" guidance was gated to internal builds; it is now enabled for everyone (the upstream `@[MODEL LAUNCH]` TODO had it marked for external release).

## 1.10.0

### Added
- **`skill-forge` plugin** in the `ur-plugins-official` marketplace — have the agent author skills for you. `/forge-skill <description>` runs on the active session model: it designs the skill (name, `when_to_use` triggers, arguments, minimal `allowed-tools`, inline vs fork, and steps that each carry a success criterion), shows the `SKILL.md` for a single confirmation, then saves it to `~/.ur/skills/<name>/` (or `./.ur/skills/` with `--project`) without clobbering an existing one. `/skill-refine <name> : <change>` improves an existing skill, and a bundled `skill-authoring` skill encodes the conventions. Complements the built-in `/create-skill`, which only scaffolds an empty template.

### Verified
- The plugin manifest plus its two command and one skill frontmatter blocks parse as strict YAML; the marketplace entry resolves; and there are no slash-command name collisions across the marketplace.

## 1.9.0

### Added
- **Seven first-party integration plugins** in the `ur-plugins-official` marketplace. Each bundles an official MCP server, curated slash commands, and a methodology skill, and falls back to a CLI or local library so the commands still work before any token is configured:
  - **`obsidian`** — operate a vault as a second brain: `/second-brain`, `/daily-note`, `/moc`, `/backlinks`, `/vault-search`. Direct vault file edits or the Obsidian Local REST API MCP server, plus a Zettelkasten/PARA/MOC skill.
  - **`github`** — `/gh-pr-review`, `/gh-pr-create`, `/gh-issues`, `/gh-repo-health` via GitHub's official remote MCP server (`api.githubcopilot.com/mcp/`) or the `gh` CLI.
  - **`gitlab`** — `/gl-mr-review`, `/gl-mr-create`, `/gl-issues`, `/gl-pipeline` via GitLab's official MCP server (OAuth) or the `glab` CLI.
  - **`huggingface`** — `/hf-model-search`, `/hf-dataset-search`, `/hf-model-card`, `/hf-download` via the official Hugging Face MCP server or the `hf` CLI.
  - **`word`** — `/docx-new`, `/docx-from-md`, `/docx-review`, `/docx-edit` via the Office Word MCP server (`uvx`) or a pandoc / python-docx fallback.
  - **`powerpoint`** — `/pptx-new`, `/pptx-from-md`, `/pptx-review`, `/pptx-theme` via the Office PowerPoint MCP server (`uvx`) or a python-pptx fallback.
  - **`miro`** — `/miro-board`, `/miro-diagram`, `/miro-stickies`, `/miro-export` via Miro's official MCP server (OAuth) or the REST API.
- Each manifest wires its MCP server through `userConfig`, so tokens are prompted at enable time and stored in secure storage (keychain / credentials file) — never in plaintext settings or prompt content.

### Verified
- All seven manifests validate against the plugin schema (mcpServers transport, `userConfig` identifiers, `${user_config}` resolution); 36 command/skill frontmatter blocks parse as strict YAML; no secret keys are referenced in prompt content; and there are no slash-command name collisions across the marketplace.

## 1.8.0

### Added
- **`/create-skill` command.** Scaffold a new skill without leaving the REPL: `/create-skill <name> [: <description>] [--project]` writes a ready-to-edit `SKILL.md` (with frontmatter) to `~/.ur/skills/<name>/` — or `.ur/skills/` with `--project` — refuses to clobber an existing skill, and clears caches so it shows up immediately (alias `/new-skill`).
- **Game Designer mode.** A new built-in output style (`/output-style`) that makes UR reason like a game designer — core loops, player fantasy, game feel, and tunable balance constants — while it writes working code.
- **Thinking toggle in the model picker.** `/model` now lets you toggle extended thinking with `t` (alongside `← →` effort cycling) for models that support it. The choice applies to the session and persists via `alwaysThinkingEnabled`.

### Fixed
- **`/update-config` no longer crashes** with `Undefined cannot be represented in JSON Schema`. The settings-schema generator now tolerates Zod types with no JSON Schema equivalent (e.g. the `enabledPlugins` union) instead of throwing.

## 1.7.0

### Added
- **Adaptive model routing (Ollama).** The agent auto-selects the best installed model per tier — the strongest coder model for the main loop, the smallest fast model for light internal work (titles, classification, session search, hooks). Honors `OLLAMA_MODEL` / `OLLAMA_SMALL_FAST_MODEL`; gated by `UR_OLLAMA_AUTO_ROUTE`.
- **Per-model context auto-tuning.** Each request sets `num_ctx` from the model's real context window and the prompt size (floored at 32K for agent work, bucketed so the KV cache stays warm), fixing silent truncation at Ollama's 4096 default. Override with `UR_OLLAMA_NUM_CTX`.
- **Keep-alive for faster responses.** Requests set `keep_alive` (default 30m) to keep the active model warm between turns and cut first-token latency. Override with `UR_OLLAMA_KEEP_ALIVE`.
- **Smarter model listing.** `/model` shows each model's tier (coder/fast) and context window; `/ur-doctor` reports the routing picks and recommends pulling a coder model when none is installed.

### Verified
- New unit tests for routing, context tuning, and keep-alive (including an end-to-end request-body assertion); full suite green.

## 1.6.0

### Added
- **Proactive clarification & planning prompts.** The agent now uses the `AskUserQuestion` multiple-choice popup before significant or ambiguous work and at key planning decisions. Options are navigated with arrow keys and submitted; the last "Other" entry always lets you type a custom answer.
- **Smarter prompt handling.** New always-on guidance makes the agent resolve ambiguity before acting, work in verifiable steps and check each step's output against the request before continuing, verify work actually runs before reporting done, report outcomes faithfully, and keep changes precisely scoped and professional.

### Changed
- **Fewer permission prompts (Balanced default).** When no permission mode is explicitly configured, sessions now start in `acceptEdits`: in-project file edits and safe filesystem/read-only commands are auto-approved, while risky or out-of-project actions still prompt. Override anytime with `permissions.defaultMode` or `--permission-mode`.
- **Elegant breathing spinner.** The house glyph (`⌂`) and bar now pulse smoothly between dim and bright instead of hard-blinking.
