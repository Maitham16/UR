# 05 — Providers & Models

Source of truth: `src/services/providers/providerRegistry.ts`, `src/utils/model/*`,
`src/services/agents/{modelPool,modelRouter,escalation}.ts`, `src/commands/{model,provider,connect,effort,fast}`.

## Provider registry (`PROVIDERS` in providerRegistry.ts)

| Provider id | Display name | Access | Credential | Status |
|---|---|---|---|---|
| `ollama` | Ollama | local runtime | none (localhost:11434) | **default local backend** |
| `llama.cpp` | llama.cpp | local/server | OpenAI-compatible endpoint (localhost:8080/v1) | enabled |
| `vllm` | vLLM | server | OpenAI-compatible endpoint (localhost:8000/v1) | enabled |
| `unsloth` | Unsloth | local/server | authenticated OpenAI-compatible endpoint (localhost:8888/v1) | provider-only inference |
| `openai-compatible` | OpenAI-compatible | server/api | any base URL + optional `OPENAI_COMPATIBLE_API_KEY` | enabled |
| `openai-api` | OpenAI API | api | `OPENAI_API_KEY` | enabled |
| `anthropic-api` | Claude API | api | `ANTHROPIC_API_KEY`; optional `ANTHROPIC_WORKSPACE_ID` for identity-linked keys | enabled |
| `gemini-api` | Gemini API | api | `GEMINI_API_KEY` | enabled |
| `openrouter` | OpenRouter | api | `OPENROUTER_API_KEY` | enabled |
| `nvidia-nim` | NVIDIA Agentic | hosted/server API | `NVIDIA_API_KEY`; configurable `https://integrate.api.nvidia.com/v1` default | enabled |
| `nvidia-special` | NVIDIA Special | hosted focused-task API | shared `NVIDIA_API_KEY`; per-card HTTP/NVCF/gRPC contract | enabled |
| `subscription` | Subscription | subscription login | OAuth | placeholder |
| `codex-cli` | Codex CLI | subscription via official CLI | `codex login` | `disabled: true` in registry |
| `claude-code-cli` | Claude Code | subscription via official CLI | `claude auth login` | `disabled: true` |
| `gemini-cli` | Gemini CLI | subscription via official CLI (Code Assist Std/Ent only) | — | `disabled: true` |
| `antigravity-cli` | Antigravity | subscription via official CLI | — | `disabled: true` |
| `lmstudio` | LM Studio | local server | OpenAI-compatible (localhost:1234/v1) | enabled |

Provider aliases are accepted everywhere a provider is named (e.g. `chatgpt`, `codex`,
`openai codex` → `codex-cli`). Each definition declares capability metadata (native tool
calls, native streaming, safety boundary label) used by the runtime and `/provider` UI.

### Provider-scoped endpoints

`provider.baseUrls` stores an independent endpoint for every configurable provider. With
`ur config set base_url <url>`, the URL belongs to the active provider; the explicit form
`ur config set base_url <provider> <url>` updates a provider without switching to it. A
provider change restores that provider's saved URL instead of overwriting or reusing the
previous provider's address. The legacy singular `provider.baseUrl` is migrated to the
previously active provider on the first provider switch or scoped base-URL write. Discovery, doctor checks, and inference all
resolve the same scoped value; default vendor URLs are fallbacks, not hardcoded destinations.

Unsloth is an inference provider only. UR discovers and calls an authenticated, user-run
Unsloth Studio OpenAI-compatible endpoint, sends `enable_tools: false` on every inference request, and does not
start training, download models, or enable Unsloth's server-side tools.

NVIDIA is exposed as two UR-native providers backed by one credential.
`nvidia-nim` (NVIDIA Agentic) owns multi-turn tool loops. On NVIDIA's public
Build endpoint its 13-model catalog is generated from current Free Endpoint
cards that explicitly advertise agent/tool use. The account `/v1/models` feed
is not treated as an allowlist, so key entitlement and transient function
errors cannot hide or remove a documented model. A scoped custom endpoint still
supports an enterprise or self-hosted NIM and uses that gateway's own live
`/models` feed. Download-only cards and focused utility, media, embedding, and
guard contracts are never promoted to agent models. NVIDIA's documented
`nvidia/nemotron-3.5-lightning-30b-a3b` endpoint is preferred first because
NVIDIA identifies it as its fastest 30B agent model. Its model-scoped
`chat_template_kwargs.enable_thinking` contract powers the real on/off picker
control; no other NVIDIA model inherits that boolean field.
`nvidia-special` (NVIDIA Special) is the focused execution surface. Its models
are not eligible for `provider.model`, startup selection, or the ongoing
OpenAI-compatible loop. Enter stores only `AppState.nvidiaTaskModel`; the
current agent/provider pair is unchanged.

`scripts/update-nvidia-hosted-catalog.mjs` crawls the live Build index and
matches each Free Endpoint card to that same card's embedded inference
artifact before generating `nvidiaHostedCatalog.generated.ts`. The artifact
records the exact endpoint, HTTP or RPC method, function ID, request and
response schemas, purpose, input/output hints, documentation, Build card,
availability flag, and executability. The current audit covers 100 visible
cards and preserves all 36 Free Endpoint entries: 13 Agentic and 23 Special.
Thirty-five are executable; 22 of the 23 Special entries publish a complete
contract. `nvidia/nemotron-voicechat` remains visible with `unpublished`
transport because NVIDIA currently publishes no request/response protocol for
that card. UR does not invent one.

HTTP tasks use their per-card `integrate.api.nvidia.com`, `ai.api.nvidia.com`,
or direct `{function-id}.invocation.api.nvcf.nvidia.com` path. Maxine/Riva cards
use the exact public service/method on `grpc.nvcf.nvidia.com:443` with Bearer
metadata and their card-specific function ID. The `NvidiaSpecial` tool's
`describe` action exposes the complete contract; `run` supports convenience
text/media inputs or exact `payload_json` plus JSON-pointer `file_inputs`.
Large inputs use NVIDIA Assets, accepted async jobs are polled, and returned
image/video/audio/binary/JSON artifacts are saved under
`.ur/artifacts/nvidia/` unless an output path is supplied. A card availability
flag or invocation error is reported but never mutates either catalog.

All tasks reuse `NVIDIA_API_KEY`. Files too large for inline preview contracts
and UUID/reference inputs are uploaded through NVIDIA's documented Asset API
and removed after completion. If NVIDIA returns `202`, UR follows `Location`
or `NVCF-REQID` with cancellation support. JSON is returned directly when
compact; generated/binary and large JSON results are written under
`.ur/artifacts/nvidia/` (or an explicit output path). Provider-facing tool
results contain text/path metadata rather than embedded binary content.

The provider doctor applies the same live-catalog filter to the selected model. A
hosted 404 whose detail says an internal function is missing for an account is
classified as catalog churn: request-visible and retained error text is
redacted, and the rejected model is removed from that endpoint's in-memory
catalog until an explicit refresh. This invalidation is endpoint-scoped, so a
different saved NIM gateway remains unaffected.

### How to use

```
/provider                 # interactive picker
/provider ollama          # switch provider
/connect status           # show all provider connection states
/connect openrouter --key sk-or-…    # store an API key (keychain-backed)
/connect nvidia-nim --key nvapi-…    # shared NVIDIA Agentic/Special key
/connect openai-compatible --key …   # optional compatible-gateway key
/connect logout openrouter
ur provider models openrouter        # list models a provider serves
ur provider doctor ollama            # diagnose connectivity
```

## Ollama Cloud and the deployment enum

**Authentication.** The Ollama client sends `Authorization: Bearer` when
`OLLAMA_API_KEY` is set, and nothing otherwise. A local daemon needs no
credential — it holds the account itself, which is how `:cloud` model suffixes
resolve locally. A direct connection to the hosted API does need one, which is
why CI (with no signed-in daemon) previously could not use Ollama at all. The
key is trimmed, so a pasted trailing newline cannot corrupt the header, and
read per request so a rotated key applies without restarting.

Base-URL precedence: session override → scoped `provider.baseUrls.ollama` (or the
legacy active-provider URL) → `OLLAMA_HOST` / `OLLAMA_BASE_URL` → `ollama.host`
setting → `https://ollama.com` when a key is set with no host →
`http://localhost:11434`. Any explicit configured host wins, so self-hosted
gateways that require a key are unaffected.

`OLLAMA_API_KEY` is on the Agentic CI provider-credential allowlist, so it
reaches the isolated agent while platform write tokens do not.

**`APIProvider` is not the provider registry.** It is a deployment enum for
request shaping, narrowed to `'foundry' | 'ollama'` — the only values
`getAPIProvider()` can return. Comparisons against `'firstParty'`, `'bedrock'`
or `'vertex'` were silently false and disabled advertised features; the
typechecker now rejects them. Where such a branch is genuinely wanted, use the
named predicates `isFirstPartyRuntime()`, `isBedrockRuntime()` and
`isVertexRuntime()` (all currently `false`) so the intent stays greppable.
`DeploymentKey` widens the type for legacy per-deployment lookup tables in
`configs.ts`, `deprecation.ts` and `modelStrings.ts`, which carry rows for
deployments this build cannot select.

## Model selection

```
/model                    # interactive model picker for current provider
/model qwen2.5-coder:7b
ur --model llama3.3       # per-session
ur --ollama-host http://gpu-box:11434    # remote Ollama server
ur --discover-ollama      # scan the LAN for Ollama servers (ollamaDiscovery.ts)
```

- `startupModelSelection.ts` distinguishes deliberate model sources from
  silent defaults. With no project/local/flag/managed, CLI/environment, agent,
  or restored-session model, interactive startup requires
  `ProviderFirstModelPicker`; headless startup exits before model execution.
- The startup picker validates the provider/model pair through the provider
  registry and persists it to `.ur/settings.local.json`. User-global model
  settings are intentionally insufficient for a new workspace.
- NVIDIA Special is omitted from startup setup because focused tasks cannot own
  an agent session. In normal `/model`, every entry shows purpose, input, and
  output before selection and never replaces the active agent/provider pair.
- Top-level `model`, `availableModels`, and `modelOverrides`, plus `provider.active`,
  `provider.model`, and provider-scoped `provider.baseUrls`, persist choices per scope. A
  switch preserves the independently saved Ollama, LM Studio, llama.cpp, vLLM, Unsloth, NVIDIA Agentic,
  `openai-compatible`, and direct-API addresses.
- `src/utils/model/aliases.ts` maps friendly aliases; `validateModel.ts` checks against the
  provider's discovered list; `ollamaTuning.ts` adjusts context/params for local models.
- Deprecation warnings and 1M-context upgrade checks live in `deprecation.ts` /
  `check1mAccess.ts`.
- Ollama remains the default provider endpoint, but no model is silently chosen
  for a fresh workspace. Configured Ollama base URLs are honored consistently.
- OpenAI-compatible endpoints use a dedicated credential key so an OpenAI API
  key is never forwarded to an arbitrary compatible base URL. Provider switches
  restore the selected provider's endpoint and clear incompatible command overrides.
- Request adapters preserve system prompts, tools, images, stops, sampling,
  reasoning, metadata, and structured-output settings supported by each
  provider. Provider error payloads, empty responses, and truncated streams fail
  instead of becoming synthetic empty successes.
- Image-bearing tool output follows each provider family's legal wire shape:
  Anthropic keeps native rich `tool_result` blocks, OpenAI Responses uses rich
  function output, Gemini nests `inlineData` in its function response,
  Ollama moves images to its next native user message, and Chat-Completions
  providers (OpenAI, OpenRouter, NVIDIA Agentic, LM Studio, llama.cpp, vLLM, Unsloth, generic)
  preserve textual tool pairing before an adjacent multimodal user message.
  `test/providerMultimodal.test.ts`, `test/openaiResponses.test.ts`, and
  `test/ollamaToolResultImages.test.ts` enforce the complete UR-native matrix.
- OpenRouter model discovery uses an endpoint-scoped five-minute cache. Opening the picker
  reuses a fresh entry; Ctrl+R invalidates it and requires a live response instead of
  silently substituting stale results. Tool turns preserve OpenRouter Auto Exacto rather
  than sending an explicit sort that disables it; non-tool turns sort by end-to-end
  throughput. Stable `session_id` affinity keeps prompt caches warm and retains automatic
  fallback. `provider.openrouter` exposes routing, fallback, strict-parameter, rolling
  throughput/latency preference, service-tier, and supported fast-mode controls. Explicit
  request preferences and the `:nitro`, `:floor`, and `:exacto` variants remain authoritative,
  and virtual variants inherit discovery metadata from their base model.
- Direct Anthropic request translation retains valid `cache_control`
  breakpoints on system, message, tool-result, and tool-schema blocks after
  removing URHQ-only fields. Streaming user tools receive Anthropic's native
  `eager_input_streaming: true`, so tool input deltas are available without
  server buffering. `provider.anthropic.speed=fast` is an explicit premium
  opt-in: the adapter adds `speed: fast` plus the
  `fast-mode-2026-02-01` beta only for exact Opus 5/4.8 model IDs and preserves
  the provider-reported `usage.speed`. No other Claude model inherits it.
  Identity-linked keys use the validated non-secret
  `provider.anthropic.workspaceId`/`ANTHROPIC_WORKSPACE_ID` value on discovery,
  doctor, Messages inference/streaming, and token counting. Model-cache keys
  include the workspace so two workspaces cannot share a discovered catalog.
  Missing-workspace 400 payloads remain intact and include an actionable
  `anthropic.workspace_id` fix.
- OpenAI Responses already provides native SSE/WebSocket continuation and
  Gemini 2.5+ receives Google's automatic implicit caching. Gemini Priority is
  an Interactions-API service tier, not a legal `generateContent` field;
  NVIDIA Agentic and local OpenAI-compatible servers likewise expose no universal
  OpenRouter-style routing switch. UR does not synthesize those controls.
- OpenAI API keeps Chat Completions as the default. Setting
  `provider.openaiTransport` through
  `ur config set openai_transport responses` selects the native Responses
  adapter with `store=false` by default, semantic SSE, background
  retrieve/poll/cancel, WebSocket continuation, compaction, deferred tool
  search, and bounded private cursor state. Compacted context persistence
  requires a 32-byte `UR_OPENAI_RESPONSES_STATE_KEY`.
- Provider HTTP retries inspect bounded structured error bodies, including
  Axios streaming error bodies. True rate-limit 429s remain retryable;
  permanent billing, quota, or account machine codes stop after the first
  response and preserve the provider message. This prevents an inactive
  OpenAI project from appearing as a minute-long model latency problem.
- `ollama.ts` allows 900 seconds for `/api/chat` response headers so cold loads
  and large prefills can start. Once headers arrive, `readOllamaChunks` applies
  a rearmed inactivity deadline: 300 seconds for local and `:cloud` models,
  120 seconds in remote/CCR sessions. Explicit request options win, followed
  by `UR_STREAM_IDLE_TIMEOUT_MS`, then `API_TIMEOUT_MS`.
- `ur.ts` identifies an Ollama Cloud runtime from both the selected provider and
  the `:cloud` suffix. It disables shared automatic request retries for that
  route, applies a 120-second bound to any permitted non-streaming fallback,
  and skips fallback entirely when the Ollama stream inactivity deadline itself
  caused the failure. Explicit `API_TIMEOUT_MS` remains authoritative.

## Capability-aware routing

### Model pools (`src/services/agents/modelPool.ts`)
Pools named `cheap` / `strong` / `default`, loaded in priority order:
1. `.ur/model-pool.json` in the repo — e.g. `{"cheap":["gemma2:2b"],"strong":["gpt-5.5"]}`
2. Env: `UR_MODEL_POOL_CHEAP`, `UR_MODEL_POOL_STRONG`, `UR_MODEL_POOL_DEFAULT` (comma lists)
3. Defaults: cheap `qwen2.5-coder:1.5b, gemma2:2b`; strong `qwen2.5-coder:32b, codex,
   claude-3-5-sonnet, gpt-4o`; default `qwen2.5-coder`.

### `/model-route` (modelRouter.ts)
Classifies a task and recommends a model + strategy:
```
/model-route "port this service to Rust" --strategy strong
/model-route "rename a variable" --strategy auto --json
```

### `/escalate` (escalation.ts)
Run on a fast model, auto-escalate hard steps to an "oracle":
```
/escalate plan "design a consensus protocol"       # show the split
/escalate run "…" --fast qwen2.5-coder:7b --oracle gpt-5.5
/escalate policy                                    # view escalation policy
```

### `/model-doctor` (ollamaModels.ts + modelCapabilities.ts)
Probes an installed Ollama model: tool-call support, context length, speed class, and
reports "likely agent capabilities":
```
/model-doctor llama3.3 --json
```

### Automatic learning loop (learning.ts)
Every ci-loop, arena, escalation, and test-first run **automatically** records its
pass/fail outcome (per task category and model) into `.ur/learning/stats.json` — a pure
JSON fold, no model calls. The `auto` routing strategy and `/escalate`'s difficulty bias
consume this evidence: a model with ≥3 recorded runs and a ≥60% success rate for the
task's category is preferred when selectable; thin evidence falls back to the static
heuristics unchanged. The store is idempotent (outcome keys dedupe) and best-effort
(a broken store never fails a run). `/learn` remains for inspection and the optional
LLM reflection pass:
```
/learn stats            # view what the agent has learned
/learn run --reflect    # optional: distill failures into lessons (uses a model)
```
Disable automatic learning with `automaticLearningEnabled: false` or
`UR_CODE_DISABLE_AUTO_LEARNING=1`.

## Reasoning effort contract

UR's normalized selector ladder is
`minimal | low | medium | high | xhigh | max | ultra | auto`. The selectable rows are
computed for the active provider/model pair from normalized live metadata (including
snake_case and camelCase capability fields), curated official model contracts, or a
model-scoped local probe. Empty metadata or a thinking flag without explicit
level names does not create a graded selector.

- `max` is provider-neutral: it resolves to the selected model's highest supported
  non-Ultra tier, commonly `high`, `xhigh`, or `max`.
- `ultra` is UR's visible beyond-high ceiling selector. It appears only when the provider
  advertises native `ultra`, `max`, `xhigh`, or an explicit provider-authored alias. The UI
  exposes the translation (for example, `ultra→max`) and serialization sends that exact
  wire value. Models whose graded ladder tops out at `high`, models without an
  advertised beyond-high value, and
  unknown-capability models never get Ultra.
- In `/model`, Up/Down changes the focused model. For a graded model, Left/Right cycles only
  that model's capability-backed selectors. For a model with thinking but no
  advertised graded ladder on a runtime with a native two-state mapping, Left
  turns thinking off and Right turns it on; `t` also toggles it.
  Enter applies the model and selected control
  atomically. `/effort status`, the
  picker confirmation, status UI, SDK state, and outbound request share the same resolver.
- In the model step, `E` edits the provider-scoped endpoint and `K` securely
  adds or replaces the selected HTTP provider's key. The generic
  `openai-compatible` key remains optional: storage and request forwarding work
  when a gateway requires authentication, while anonymous endpoints are not
  reclassified as key-required.
- Direct OpenAI, Anthropic, Gemini, and NVIDIA Agentic use model-specific documented ladders. OpenRouter
  preserves live reasoning metadata. OpenAI-compatible servers receive
  `reasoning_effort`, including provider-authored aliases. Ollama uses native
  `think`: generic `thinking` capability metadata establishes thinking but not
  a finite ladder, so UR uses verified on/off control; GPT-OSS uses the
  documented `low|medium|high` ladder and therefore omits Ultra. vLLM is probed
  through non-generating `/server_info?config_format=json`; a configured
  reasoning parser exposes `minimal→none|low|medium|high`. llama.cpp is probed
  lazily through model-scoped `/props`, whose current boolean support flag does
  not identify accepted level names. Other ladders or aliases require explicit
  model metadata.

Unknown/future models are fail-closed for thinking request shaping: UR first consumes live
provider metadata, curated contracts, `/api/show` (Ollama), `/props` (llama.cpp),
or `/server_info` (vLLM). If none
of those sources establishes thinking support, UR omits the thinking field instead of sending
a speculative production request and interpreting a 400 response. Boolean thinking metadata
enables `/thinking on|off` and the picker's two-state control only when the selected runtime has
a real native mapping (for example, Ollama `think`); it never fabricates a generic
OpenAI-compatible wire field or graded effort
levels. A graded `/effort` request made while such a model is active is not sent as a level;
UR enables boolean thinking and explains the exact on/off contract instead. For OpenRouter, that
maps to its documented [`reasoning.enabled`](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens);
when the model instead advertises
`supports_max_tokens`, UR preserves the configured budget as `reasoning.max_tokens`.

## Provider-aware token accounting

Context analysis, file limits, and MCP-output truncation use the selected model's runtime
family. OpenAI calls `POST /responses/input_tokens`; Anthropic calls
`POST /messages/count_tokens`; Gemini calls `models.countTokens`; llama.cpp uses
`POST /v1/chat/completions/input_tokens`; and vLLM uses its Anthropic-compatible
`POST /v1/messages/count_tokens`. The same translated messages, system instructions, images,
and tool schemas used for inference are supplied to the count endpoint.

NVIDIA's hosted agent API documents chat completion and model-list endpoints but
does not expose a token-count route; attempting `/v1/messages/count_tokens`
returns 404 and adds latency. NVIDIA Agentic, Ollama, OpenRouter, LM Studio,
Unsloth, and subscription CLIs therefore use a provider-wire local estimate.
These runtimes do not expose one universal, non-generating preflight tokenizer
for the complete chat-and-tools request. Native count failure also falls back
to the same explicit estimate. UR never
runs a hidden one-token completion merely to obtain usage. The local estimate also remains the
fallback for MCP truncation, so a tokenizer outage cannot silently disable the output limit.

Primary contracts: [OpenAI input tokens](https://developers.openai.com/api/reference/typescript/resources/responses/subresources/input_tokens),
[Anthropic token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting),
[Gemini token counting](https://ai.google.dev/gemini-api/docs/generate-content/tokens),
[llama.cpp server API](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md),
and [vLLM online serving](https://docs.vllm.ai/en/latest/serving/openai_compatible_server/),
plus [NVIDIA NIM LLM APIs](https://docs.api.nvidia.com/nim/reference/llm-apis).

## Session behavior knobs

| Feature | Command | Notes |
|---|---|---|
| Effort level | `/effort minimal·low·medium·high·xhigh·max·ultra·auto` | capability-gated; provider-native wire value; persistable choices use `effortLevel` |
| Thinking | `/thinking on·off·toggle·status` | provider-native on/off control; persists through `alwaysThinkingEnabled` |
| Fast mode | `/fast on` | `fastMode` / `fastModePerSessionOptIn` settings |
| Advisor model | `/advisor <model>` / `/advisor off` | secondary model that critiques answers (`advisorModel` setting) |
| Always thinking | `alwaysThinkingEnabled` setting | durable backing setting for `/thinking` |
| Thinking summaries | `showThinkingSummaries` setting | UI display of thinking |
| Fallback model | `--fallback-model` (print mode) | on overload |

## Offline / local-first

- `ur --offline` or `offline` setting: no cloud APIs, telemetry, auto-update, remote control.
- Offline dispatch permits only loopback local/server endpoints; cloud,
  subscription, remote Ollama, and remote compatible endpoints are blocked.
- `/local-first` reports readiness for no-cloud/private/lab/edge deployment: which features
  degrade, which local deps (Ollama, ripgrep, playwright, ffmpeg…) are present.
- `--bare` forces the minimal local pipeline (`UR_CODE_SIMPLE=1`) and always uses Ollama.
- Ollama config: `ollama.host` and `ollama.lanDiscovery` settings; per-session
  `--ollama-host`; router in `ollamaRouter.ts` load-balances across discovered hosts.
