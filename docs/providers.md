# UR-Nexus providers

UR-Nexus integrates official model access paths only. API-key providers, local
runtimes, and OpenAI-compatible servers are UR-native backends: UR owns the
conversation loop, native tool-call parsing, streaming, errors, and UR-run tool
execution. Subscription CLI providers (Codex CLI, Claude Code, Gemini CLI,
Antigravity) are external app bridges: they are first-class in `/model` and
dispatch each turn through the vendor's official CLI using your subscription
login. They are optional, never required dependencies, and never used as a
silent fallback.

## Legal auth policy

UR-Nexus never:

- scrapes browser cookies or browser sessions
- extracts, copies, or reuses OAuth refresh tokens
- reads hidden provider auth files directly
- bypasses subscription, quota, region, product, or organization restrictions
- proxies a consumer web session as an API
- claims provider support unless the official CLI/API path works

UR-Nexus stores only safe config: provider name, model name, base URL, fallback
preference, and non-secret preferences. API keys stay out of plaintext settings
and are read from the OS keychain after `ur connect` or from environment
variables when the user explicitly selects API mode.

## Provider matrix

Concise capability matrix — provider kind, native tool calls, native streaming,
multimodal input, external CLI boundary, and sandbox scope:

| Provider | Access type | Provider kind | External CLI | Native tools | Native streaming | Multimodal input | Sandbox scope | Runtime backend | Legal path |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Subscription | subscription | subscription-placeholder | no | no | no | n/a | n/a (no runtime) | `subscription:unconfigured` | independent subscription runtime only |
| OpenAI API | API | UR-native | no | yes | yes | yes | UR Bash/File sandbox | `api:openai` | `OPENAI_API_KEY` |
| Claude API | API | UR-native | no | yes | yes | yes | UR Bash/File sandbox | `api:anthropic` | `ANTHROPIC_API_KEY` |
| Gemini API | API | UR-native | no | yes | yes | yes | UR Bash/File sandbox | `api:gemini` | `GEMINI_API_KEY` |
| OpenRouter | API/router | UR-native | no | yes | yes | yes | UR Bash/File sandbox | `api:openrouter` | `OPENROUTER_API_KEY` |
| NVIDIA NIM | hosted/server API | UR-native | no | yes | yes | model-dependent | UR Bash/File sandbox | `api:nvidia-nim` | `NVIDIA_API_KEY`; configurable NIM endpoint |
| OpenAI-compatible | server/API | UR-native | no | yes | yes | endpoint-dependent | UR Bash/File sandbox | `openai-compatible` | optional `OPENAI_COMPATIBLE_API_KEY`; never reuses `OPENAI_API_KEY` |
| Ollama | local/server | UR-native | no | yes | yes | yes* | UR Bash/File sandbox | `ollama` | configured local, LAN, or hosted endpoint; optional `OLLAMA_API_KEY` |
| LM Studio | local/server | UR-native | no | yes | yes | yes | UR Bash/File sandbox | `openai-compatible:lmstudio` | configured endpoint; optional `LMSTUDIO_API_KEY` |
| llama.cpp | local/server | UR-native | no | yes | yes | yes | UR Bash/File sandbox | `openai-compatible:llama.cpp` | configured endpoint; optional `LLAMA_CPP_API_KEY` |
| vLLM | local/server | UR-native | no | yes | yes | yes | UR Bash/File sandbox | `openai-compatible:vllm` | configured endpoint; optional `VLLM_API_KEY` |
| Unsloth | local/server | UR-native | no | yes | yes | model-dependent | UR Bash/File sandbox | `openai-compatible:unsloth` | authenticated user-run Unsloth Studio endpoint (`UNSLOTH_API_KEY`) |
| Codex CLI | subscription | subscription-cli | yes | no | no | no† | UR-run tools/output only† | `subscription-cli:codex` | official Codex CLI login |
| Claude Code | subscription | subscription-cli | yes | no | no | no† | UR-run tools/output only† | `subscription-cli:claude-code` | official Claude Code CLI login |
| Gemini CLI | subscription | subscription-cli | yes | no | no | no† | UR-run tools/output only† | `subscription-cli:gemini` | official Gemini Code Assist login |
| Antigravity | subscription | subscription-cli | yes | no | no | no† | UR-run tools/output only† | `subscription-cli:antigravity` | official Antigravity CLI login, where supported |

\* Ollama forwards images only to models that advertise vision support;
a model whose advertised capabilities omit `vision` gets a text placeholder
instead. A model that advertises nothing at all is treated as *unknown*, not
unsupported: the image is still sent, and the note says support could not be
confirmed rather than asserting the model is blind. That distinction matters —
`/api/show` returns no capabilities for several cloud-suffixed models, and
reporting that as "no vision support" sends you to change models for no
reason. Resolution lives in `src/utils/model/visionCapability.ts` and is shared
by the adapter, `ur model-doctor` and the model router. This applies to
images returned by tools as well as images you paste: a `Computer` screenshot or
any other image-bearing tool result is extracted from the tool message and sent
as `images` on the following user message, because Ollama renders `images`
reliably there but only template-dependently on a `tool` message. On a text-only
model the placeholder names the model and points at `/model`, so the agent tells
you why it cannot see rather than guessing. Check a model with `ur model-doctor`
or `ollama show <model>`.

† External vendor CLI boundary (see below): UR passes prompt text only to the
official CLI, so image blocks are not forwarded, and UR-native tool/streaming/
sandbox guarantees stop at UR-run tools and final UR output.

All UR-native adapters preserve images returned by tools without putting image
content into a wire field that rejects it. Anthropic keeps the image inside its
native `tool_result`; OpenAI Responses uses rich function-call output; Gemini
nests `inlineData` in the matching function response; Ollama uses the
following native user message; and OpenAI Chat Completions, OpenRouter, NVIDIA
NIM, LM Studio, llama.cpp, vLLM, Unsloth, and generic compatible endpoints emit the
required textual `role: tool` message followed immediately by a multimodal
`role: user` message. This preserves tool-call ordering and every image byte.
It does not turn a text-only model into a vision model: select a model whose
live provider metadata or runtime supports image input.

Tool search (deferred tool loading) is disabled on every provider above. It
depends on `tool_reference` content blocks being expanded into tool definitions
by the API, which is a URHQ-native beta feature with no equivalent on a local
runtime or a vendor CLI. UR therefore sends every tool schema on every request,
and `ToolSearch` is not offered to the model. Enabling it against a runtime that
cannot expand references would leave deferred tools permanently unreachable.

Native tools and native streaming mean UR's own request/response loop parses
tool calls and streams tokens for that provider. Multimodal input means UR
preserves image content blocks (resized/normalized with `sharp`) into that
provider's wire format instead of stripping them. Sandbox scope states what
UR's OS-level sandbox (macOS `sandbox-exec`, Linux `bwrap`) actually covers
for that provider — see [Sandbox](CONFIGURATION.md#sandbox) for mode
details.

## Runtime boundary

UR-native providers use UR's provider adapters and tool loop. For those
providers, UR owns request shaping (including multimodal image-block mapping),
native tool-call parsing, native streaming, and the UR-run Bash/File tool
permission, sandbox, and verifier flow.

Subscription CLI providers use a different boundary:

> External vendor CLI boundary: UR passes prompt text to the official CLI and
> receives final text output. UR-native tool calling, UR Bash/File tool
> execution, UR-native streaming, local command permissions, sandbox guarantees,
> and verifier/done-gate checks apply to UR-run tools/final UR output, not to
> actions the external CLI performs internally.

That means the external CLI may have its own tool use, streaming, filesystem
access, network access, permissions, and safety behavior. UR reports CLI
failures as provider-scoped errors and does not fabricate assistant text or
silently switch to another provider.

## Commands

```sh
ur provider list
ur provider status
ur provider doctor
ur provider doctor codex-cli
ur provider doctor agy
ur provider models [provider] --json
# Subscription CLI logins (official vendor CLIs):
ur auth chatgpt
ur auth claude
ur auth gemini
ur auth antigravity
ur config set provider ollama
ur config set provider openai-api
ur config set provider anthropic-api
ur config set provider gemini-api
ur config set provider openrouter
ur config set provider openai-compatible
ur config set provider unsloth
ur config set model <model>
ur provider select-model <provider> <model> --json
ur config set base_url <url>
ur config set base_url <provider> <url>
ur config set provider.fallback ollama
ur config set openai_transport responses
ur config set responses.store false
ur config set responses.compact_threshold 20000
ur config set responses.tool_search hosted
```

The fallback setting is a recovery hint for `ur provider doctor`; it does not
route a failed request to another provider. Review the failure and use
`ur config set provider <id>` to switch explicitly.

With only a URL, `base_url` is stored for the active provider. The explicit
form `ur config set base_url <provider> <url>` configures a named provider
without switching first, and the confirmation names that provider. Each
provider retains its own address across `/provider`, `/model`, and CLI
switches. The legacy single `provider.baseUrl` field remains readable and is
migrated to the previously active provider on the first provider switch or
scoped base-URL write.

The override is not limited to local runtimes. OpenAI API, Anthropic API,
Gemini API, OpenRouter, and NVIDIA NIM can each target a separate compatible gateway using
the same command. Their official URLs are defaults, not hardcoded dispatch
destinations; model discovery and inference use the selected provider's saved
URL. Subscription CLI providers remain vendor-managed and do not accept a base
URL.

OpenAI API uses Chat Completions by default. `openai_transport responses` is an
explicit opt-in to the native Responses adapter; it defaults to `store=false`
and supports semantic streaming, background polling/cancellation, WebSocket
continuation, server compaction, and deferred tool search. It does not change
OpenAI-compatible, OpenRouter, local, or subscription-CLI providers.

## Provider-scoped model selection

UR-Nexus shows providers first, then only models available for the selected provider. This prevents incompatible model/provider pairs and keeps API-key, local/server, subscription, and external app bridge model lists separate. The generic `subscription` entry has no models unless a real independent subscription runtime is configured; UR does not list fake subscription models.

The interactive selection is also the authority for the current session: the
next main, compact, or web-search request uses the provider/model pair captured
in live app state while the same validated pair is persisted once to local
settings. A stale settings snapshot cannot combine a newly selected model with
the previous provider.

### Reasoning effort

Use `/effort minimal|low|medium|high|xhigh|max|ultra|auto` inside UR. UR builds a
capability-backed selector set from the native graded levels advertised for the active
provider/model pair. `max` is provider-neutral and means the selected model's
highest supported non-Ultra tier: it displays and sends the matching native
value (commonly `max`, `xhigh`, or `high`) according to that model's contract.
For OpenRouter, UR preserves the live `/models` reasoning metadata and sends
the unified `reasoning.effort` request. OpenAI-compatible servers receive the
resolved value as `reasoning_effort`. The command confirmation, status
indicator, active-work spinner, SDK settings response, and provider request all
use the same resolved value. If a provider advertises thinking without a
model-specific graded ladder and its runtime has a real native on/off mapping,
UR does not invent a graded effort
selector. Use `/thinking on|off` directly;
in `/model`, Left selects off, Right selects on, and `t` toggles. A graded
`/effort` request on that model enables boolean thinking while clearly reporting
that the requested level was not sent.
Generic OpenAI-compatible endpoints have no universal boolean thinking field,
so metadata alone does not make this toggle appear and UR sends no invented parameter.
`ultra` is UR's visible beyond-high ceiling selector. It is selectable only
when the provider/model advertises `ultra`, `max`, `xhigh`, or an explicit
provider-authored equivalent. UR shows the native mapping (for example,
`ultra→max`) and sends that exact wire value; it never enables Ultra for a model
whose graded ladder tops out at `high`, lacks an advertised beyond-high value,
or has unknown capability metadata. Arbitrary
labels such as `deep` still require an explicit provider alias because UR
cannot infer their rank.

NVIDIA NIM is live-discovery first. UR enriches a discovered model only when
NVIDIA's current model API reference documents that exact model's
`reasoning_effort` values. Documented `none` appears as Minimal and `max`
appears as Ultra while the request preserves NVIDIA's wire values. An unknown
NIM model never inherits an invented graded ladder.

For an unknown or newly released model, UR waits for provider-authored model
metadata or a supported model-scoped probe before adding thinking parameters.
If the provider does not establish support, thinking stays off for request
shaping; UR does not optimistically send an unknown parameter and treat an API
error as capability discovery. Boolean thinking metadata enables the thinking
toggle only and never invents a graded effort ladder. On OpenRouter, UR sends
the provider-default `reasoning.enabled` control, or the exact token budget when
the model advertises `supports_max_tokens`.

For Ollama, UR lazily reads the focused model's `/api/show` capabilities and
sends the resolved control through native `think`. A generic `thinking`
capability proves thinking support but does not identify a model-specific
graded ladder; UR therefore exposes the verified native on/off control without
claiming that the model cannot also support levels. GPT-OSS uses Ollama's documented
`low|medium|high` ladder and does not expose Ultra. Other graded ladders and
Ultra aliases are used only when the endpoint explicitly returns them in model
reasoning metadata.

For vLLM, UR lazily reads the non-generating
`/server_info?config_format=json` endpoint for the focused model. A configured
reasoning parser establishes vLLM's documented Chat Completions contract:
`none|low|medium|high`, displayed as `minimal→none|low|medium|high` and sent
through `reasoning_effort`. This discovery never launches a completion and
does not add Ultra. A richer provider-authored model record can add exact
levels or aliases. For llama.cpp, `/props` can establish that the active chat
template consumes reasoning effort, but the current capability flag does not
publish its finite accepted values; UR does not fabricate a ladder from that
boolean. Direct OpenAI,
Anthropic, and Gemini models use curated model-specific ladders from their
official documentation; live discovery rows are merged with those contracts.
See [Ollama thinking](https://docs.ollama.com/capabilities/thinking),
[OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model),
[Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort),
[Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking), and
[vLLM reasoning outputs](https://docs.vllm.ai/en/latest/features/reasoning_outputs/).

The provider-first `/model` picker supports the same control directly: use
Left/Right to move through the capability-backed selectors UR can map to a
graded model's native levels, or to choose off/on for a boolean-thinking model
when its runtime has a native two-state mapping, then Enter to apply the model
and reasoning control together. OpenRouter's live catalog
shows pricing tier, context size, tool capability, reasoning capability, and
the full, untruncated model ID immediately below the focused entry. Opening the
OpenRouter catalog reuses its endpoint-scoped five-minute cache; Ctrl+R forces
the current `/models` endpoint and never substitutes a cached list when that
forced refresh fails. Tool requests preserve OpenRouter Auto Exacto so its live
throughput, tool-call reliability, and benchmark signals choose the route;
non-tool requests default to throughput sorting rather than TTFT-only latency
sorting. UR promotes its stable session ID for prompt-cache affinity while
retaining router fallback. Explicit request preferences, the `openrouter.*`
configuration controls, and the `:nitro`, `:floor`, and `:exacto` model variants
remain authoritative. See OpenRouter's
[provider routing](https://openrouter.ai/docs/guides/routing/provider-selection),
[Auto Exacto](https://openrouter.ai/docs/guides/routing/auto-exacto), and
[prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching).
API-key entry for
OpenAI, Claude, Gemini, OpenRouter, NVIDIA NIM, and authenticated compatible
endpoints is a single aligned masked row; the key is stored in the OS keychain
flow and is never written to settings. On the model screen, `K` adds or
replaces the selected HTTP provider's key and `E` edits its endpoint. Generic
OpenAI-compatible endpoints may remain anonymous.

### Token counting

UR uses each provider's non-generating count endpoint when one covers the full
request: OpenAI Responses input tokens, Anthropic Messages token counting,
Gemini `countTokens`, llama.cpp chat input tokens, and vLLM/NVIDIA NIM Messages
token counting. Ollama, OpenRouter, LM Studio, Unsloth, and subscription CLIs use a
provider-wire local estimate because those runtimes do not share a dependable
preflight tokenizer for complete chat history plus tools. UR never launches a
hidden completion for token counting. If a native count call is unavailable,
file and MCP size checks retain the local estimate rather than disabling their
limits.

For llama.cpp, `/v1/models` metadata is preserved when the server supplies it.
UR also resolves the model currently under the Up/Down cursor through
`/props?model=<id>`. `supports_reasoning_effort` establishes template support,
but current llama.cpp does not expose the accepted value set through that flag,
so it does not by itself enable Left/Right. Exact effort metadata from the
model endpoint still enables the corresponding selectors and is sent unchanged
as `reasoning_effort`. This works with llama.cpp router/cluster mode and does
not assume that port 8080 limits UR to one worker.

### Provider-aware research calls

WebFetch summarization and WebSearch use the active session provider/model pair
unless `URHQ_SMALL_FAST_MODEL` explicitly selects a secondary model. This
prevents an OpenRouter session from dispatching auxiliary research through an
unavailable internal alias or a stale Ollama model. On OpenRouter, WebSearch is
sent as the native `openrouter:web_search` server tool and the provider's
reported search count is preserved. A response that performs no search is an
error, not a successful `Did 0 searches` result.

## Runtime provider routing

When you select a UR-native provider and model, every agent request is routed
through that provider's backend:

- **API providers** make direct HTTP calls in each provider's native wire format: Anthropic uses `x-api-key` + `anthropic-version` against `/v1/messages`; OpenAI uses `Authorization: Bearer` against `/v1/chat/completions` by default or `/v1/responses` when explicitly selected; Gemini uses `x-goog-api-key` against `…:generateContent`; OpenRouter and NVIDIA NIM use their OpenAI-compatible chat endpoints.
- **Local/server providers** connect to the configured local or OpenAI-compatible endpoint (`/v1/chat/completions` for LM Studio, llama.cpp and vLLM; the native tags/chat API for Ollama)
- **Subscription CLI providers** (Codex CLI, Claude Code, Gemini CLI,
  Antigravity) dispatch the turn through the vendor's official CLI using your
  subscription login. They do not use UR-native tool calling, UR-native
  streaming, or UR Bash/File tool execution inside the external CLI. Failures
  remain provider-scoped and never fall back to Ollama or any other provider.
- The generic **`subscription`** entry is an internal placeholder with no
  models and no backend; it is hidden from listings. Choose a specific
  subscription CLI, API, or local/server provider instead.

The selected provider determines:
- Which backend receives your requests
- Which models are available
- How authentication works
- What error messages you see

**Important:** Ollama is only used when `ollama` is the selected provider.
Selecting another provider routes requests through that provider's backend. If
runtime dispatch fails, UR reports the selected provider, selected model, and
runtime backend instead of switching to Ollama.

### `/model` command flow

When you run `/model` in the interactive agent, you get a **two-step provider-first selection**:

**Step 1: Provider Selection**

You see all configured providers with:
- Provider name (e.g., "Codex CLI", "OpenAI API", "Ollama")
- Access type: `subscription`, `api`, `local`, or `server`
- Connection status: `connected`, `missing`, `unavailable`, or `unknown`
- Credential type: `cli-login`, `api-key`, `local-runtime`, or `openai-compatible-endpoint`
- Short status message (e.g., "OPENAI_API_KEY found", "CLI not found", "localhost reachable")
- Runtime kind: `UR-native` or `external app bridge`
- Provider kind and boundary: `ur-native`, `subscription-cli`, or
  `subscription-placeholder`

**Step 2: Model Selection**

After selecting a provider:
- Only models from that provider are shown
- Each model shows its concise capabilities; OpenRouter includes pricing,
  context size, tool support, and reasoning support. Its list uses compact
  model names; focus an entry to see the exact provider/model ID
- Model source is displayed: `live` (dynamic discovery), `cache` (recent endpoint result), or `static` (predefined)
- OpenRouter reuses an endpoint-scoped `/models` result for five minutes; Ctrl+R
  forces a live refresh, and a failed forced refresh never substitutes stale data
- Up/Down changes the focused model and immediately switches to that model's
  capability-backed effort selectors; Left/Right cycles only values UR can map
  to provider-native levels, and Enter confirms both
- Press Esc to go back and change provider

**Confirmation**

After selecting a model, the confirmation shows:
- Selected provider and access type
- Selected model name
- Model source (live/cache/static)
- Runtime backend
- Provider status and doctor output also show provider kind, whether an
  external CLI is used, whether UR-native tool calls/streaming are supported,
  and the exact safety boundary.
- Effort level (if applicable)
- Thinking status (if enabled)

**Example:**
```
/model
→ Step 1: Select provider
  Ollama · local/server · local-runtime · endpoint configured
  OpenAI API · api · OPENAI_API_KEY found
  
→ Select: Ollama

→ Step 2: Select model
  llama3 · discovered from Ollama · live
  qwen2.5-coder:7b · discovered from Ollama · live
  
→ Select: llama3

→ Confirmation:
  Selected provider: Ollama (local)
  Selected model: llama3
  Model source: live
  Runtime backend: ollama
```

### CLI workflow

```sh
# 1. Select a provider
ur config set provider openai-api

# 2. View available models for that provider (in model picker)
/model

# 3. Select a model from the filtered list
ur config set model gpt-5.6-sol

# 4. Switch to a different provider - model list updates automatically
ur config set provider anthropic-api
# Now /model shows only Claude API models, not OpenAI API or Ollama models
```

### Model discovery behavior

| Provider type | Model discovery | Source label |
| --- | --- | --- |
| API providers (openai-api, anthropic-api, gemini-api) | Live discovery from the provider's `/models` endpoint using your connected key (curated fallback until connected) | live |
| OpenRouter | Live `/models` discovery with an endpoint-scoped five-minute cache; Ctrl+R forces a fresh request with no stale fallback | live/cache |
| NVIDIA NIM | Hosted: live `/models` intersected with the connected account's ACTIVE NVCF functions, then restricted to agent/chat endpoints. Configured NIM gateway: its own live `/models` catalog | live |
| Local/server providers (ollama, lmstudio, llama.cpp, vllm, unsloth) | Dynamic discovery from the selected provider endpoint | live |
| OpenAI-compatible | Dynamic discovery from configured endpoint | live |
| Subscription CLIs (codex-cli, claude-code-cli, gemini-cli, antigravity-cli) | Curated list (the official CLIs expose no models API); first-class in `/model`, dispatched via the official CLI. External CLI behavior depends on the vendor CLI. Log in with `ur auth <provider>` | static |

The current curated API fallbacks include GPT-5.6 Sol, Terra, and Luna;
Claude Sonnet 5, Opus 5, and Fable 5; and Gemini 3.7 Flash and 3.6 Flash.
GPT-5.6 defaults to `medium` across its documented
`none|low|medium|high|xhigh|max` wire ladder (`none` appears as UR's
`minimal` selector); Gemini 3.7 Flash exposes
`low|medium|high`, while Gemini 3.6 Flash also exposes `minimal`. Deprecated
OpenAI `o1` and `o3-mini` are no longer baked into UR's fallback catalog. A
provider's successful live catalog remains authoritative for that account.

### API vs Subscription distinction

**Subscription CLI providers** require the vendor's official CLI login:
- `codex-cli` — Codex CLI subscription via `codex login`
- `claude-code-cli` — Claude Code subscription via `claude auth login`
- `gemini-cli` — Gemini Code Assist enterprise login
- `antigravity-cli` — Antigravity subscription login

**API providers** require environment variable with API key:
- `openai-api` — requires `OPENAI_API_KEY`
- `anthropic-api` — requires `ANTHROPIC_API_KEY`
- `gemini-api` — requires `GEMINI_API_KEY`
- `openrouter` — requires `OPENROUTER_API_KEY`
- `nvidia-nim` — requires `NVIDIA_API_KEY` for build.nvidia.com; endpoint is configurable

**Local/server providers** require local runtime or endpoint:
- `ollama` — configurable local, LAN, or hosted Ollama server
- `lmstudio` — LM Studio OpenAI-compatible server
- `llama.cpp` — llama.cpp server mode
- `vllm` — vLLM server
- `unsloth` — authenticated Unsloth Studio server; UR uses it for inference only

**Important:**
- A ChatGPT/Claude/Gemini subscription does NOT give API access
- An API key does NOT give subscription CLI access
- UR does not require Codex CLI, Claude Code, Gemini CLI, or Antigravity to use
  API, Ollama, or OpenAI-compatible providers
- OpenAI API and Codex CLI are separate providers
- Claude API and Claude Code are separate providers
- Gemini API and Gemini CLI are separate providers

### Connecting accounts (`ur connect` / `/connect`)

Connect a provider once from inside UR (or a terminal). The connection persists,
so you do not repeat it each session:

```sh
ur connect status                      # connection state for every provider
ur connect codex-cli                   # subscription: launches the official login (Codex/Claude/Gemini)
echo "$OPENAI_API_KEY" | ur connect openai-api   # API: store a key (from stdin, not shell history)
ur connect openai-api --key <KEY>      # API: store a key explicitly
ur connect logout openai-api           # clear a stored key
```

- **Subscription providers** (`codex-cli`, `claude-code-cli`, `gemini-cli`,
  `antigravity-cli`) connect through their official CLI login using your own
  account; the session is persisted by that CLI. UR never scrapes or copies
  those tokens. UR-native tools, sandbox guarantees, local command permissions,
  and verifier/done-gate checks apply to UR-run tools/final UR output, not to
  internal actions performed by the external CLI.
- **API providers** (`openai-api`, `anthropic-api`, `gemini-api`, `openrouter`)
  store the key in your OS keychain (macOS Keychain, with an encrypted file
  fallback) — the same secure store UR uses for its own credentials. At runtime
  a stored key is used first, then the provider's environment variable, so
  setting the env var still works and never gets overwritten.

If you select a provider that is not connected, UR shows a connect prompt in
`/model` and the runtime fails clearly with the exact `ur connect <provider>`
command instead of silently switching providers.

### Validation

When you set a model that is incompatible with the current provider, UR-Nexus shows an error:

```
Invalid model for current provider:
  Selected provider: openai-api
  Selected model: claude-sonnet-5
  Valid models for openai-api: gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna, gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-4o, gpt-4o-mini
  Suggested action: Run /model and choose a model from openai-api, or run: ur config set model gpt-5.6-sol
  Error: Model "claude-sonnet-5" is not available for provider "openai-api".
```

When you change providers, UR-Nexus warns if the current model is incompatible:

```
Warning: Current model "gpt-5.5" is not available for provider "anthropic-api" and will be cleared.
  Valid models for anthropic-api: claude-sonnet-5, claude-opus-5, claude-fable-5, claude-opus-4-8, claude-opus-4-7
  After changing provider, run /model or: ur config set model claude-sonnet-5
```

For subscription CLI providers, UR stores provider-scoped model IDs such as
`claude-code/sonnet`, and runtime dispatch validates the pair against the
provider's curated list before spawning the official CLI.

### Troubleshooting

**Check active provider and model:**
```sh
# Show selected provider, model, access type, credential, readiness, and backend
ur provider status
```

**Subscription CLI provider is not working:**
- Run `ur provider doctor <provider>` to check CLI presence and login status
- Install the vendor's official CLI if it is missing, then log in with
  `ur auth <chatgpt|claude|gemini|antigravity>`
- Remember these run through the external vendor CLI; UR-native tool calls,
  UR-native streaming, Bash/File tool semantics, sandbox guarantees, and local
  command permissions do not apply to what the external CLI does internally

**Provider shows "unavailable":**
- Check API key: `echo $OPENAI_API_KEY`
- Check local server: `curl http://localhost:11434/api/tags`
- Run: `ur provider doctor <provider>` for detailed diagnostics

**Model not in list:**
- Verify provider is correct: `/provider`
- Check model belongs to provider (API models ≠ CLI models)
- For local providers, ensure server is running and model is pulled

**Requests going to wrong backend:**
- Verify selected provider and runtime backend: `ur provider status`
- Change provider: `ur config set provider <provider-id>`
- Choose a scoped model: `/model`
- The selected provider determines which backend receives requests
- Ollama is only used when `ollama` is the selected provider
- Runtime dispatch validates the provider/model pair before sending a request

**Dynamic discovery fails:**
- Local/server providers: check server is running at configured URL
- OpenAI-compatible: verify base_url and API key (if required)
- Fallback only to same provider's cached models (never other providers)

**Saved local/server model rejected after restart:**
- A model saved via `/model` for a live-discovery provider (`ollama`, `lmstudio`, `llama.cpp`, `vllm`, `openai-compatible`) is accepted on a fresh process even before discovery has repopulated the in-memory model cache. The endpoint is the source of truth, so a saved model is not rejected pre-discovery. Static providers (API/subscription) remain strictly validated against their model list.

**Debug active runtime backend:**
```sh
ur provider status
```

`ur provider doctor` adds detailed diagnostics for the same selected provider.

Provider config and doctor commands accept canonical IDs and common aliases:

| Canonical ID | Accepted examples |
| --- | --- |
| `codex-cli` | `chatgpt`, `codex`, `openai codex` |
| `claude-code-cli` | `claude`, `Claude Code`, `anthropic claude` |
| `gemini-cli` | `gemini`, `gemini cli`, `gemini code assist` |
| `antigravity-cli` | `antigravity`, `agy`, `ag`, `google antigravity` |
| `openai-api` | `openai`, `openai api` |
| `anthropic-api` | `anthropic`, `claude api` |
| `gemini-api` | `gemini api`, `google gemini api` |
| `openrouter` | `openrouter api` |
| `nvidia-nim` | `nvidia`, `NVIDIA Build`, `nvidia api`, `nim` |
| `openai-compatible` | `compatible`, `openai compatible` |
| `ollama` | `ollama local` |
| `lmstudio` | `LM Studio`, `lm-studio` |
| `llama.cpp` | `llama cpp`, `llamacpp`, `llama-cpp` |
| `vllm` | `vllm server` |
| `unsloth` | `Unsloth Studio`, `unsloth server`, `unsloth local` |

`ur provider doctor` checks the selected provider. It reports installed/missing
CLIs, official login status where available, API key presence for API providers,
local endpoint reachability, detectable model availability, unsupported account
type signals, and fallback configuration.

Fallback is never silent by default. If the selected provider fails, UR-Nexus
reports the selected provider, failure reason, suggested fix, and configured
fallback option.

## Subscription CLI providers

- `codex-cli`: detects `codex --version`, uses `codex login` or
  `codex login --device-auth`, and checks `codex login status`.
- `claude-code-cli`: detects `claude --version`, uses `claude auth login`, and
  checks `claude auth status` when available. If `ANTHROPIC_API_KEY` is set,
  doctor warns that API-key mode may override subscription auth.
- `gemini-cli`: launches only the official Gemini CLI flow. If the detected
  path is an unsupported personal-account path, UR-Nexus prints a clear error.
- `antigravity-cli`: detects official CLI commands including `agy --version`,
  `antigravity --version`, `google-antigravity --version`, or `ag --version`
  where installed. It launches only an installed official CLI command where
  supported; UR-Nexus does not invent flags.

## API and local/server providers

API providers require explicit user selection and environment keys:

```sh
OPENAI_API_KEY=...
OPENAI_COMPATIBLE_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...
NVIDIA_API_KEY=...
OLLAMA_API_KEY=...             # optional for authenticated Ollama gateways
LMSTUDIO_API_KEY=...           # optional when the endpoint requires it
LLAMA_CPP_API_KEY=...          # optional when the endpoint requires it
VLLM_API_KEY=...               # optional when the endpoint requires it
UNSLOTH_API_KEY=...
```

OpenAI-compatible endpoints can point at local or cloud endpoints:

```sh
ur config set provider openai-compatible
ur config set base_url http://localhost:1234/v1
ur config set model local-model-name
```

`OPENAI_COMPATIBLE_API_KEY` is intentionally separate from
`OPENAI_API_KEY`; selecting an arbitrary compatible base URL never forwards
the OpenAI credential to that host.

The compatible provider's key is optional and provider-scoped. Add or replace
it with `ur connect openai-compatible`, `/connect openai-compatible`, or `K`
in the `/model` model screen. Anonymous endpoints continue to work without it.

### NVIDIA NIM / build.nvidia.com

NVIDIA NIM is a UR-native, OpenAI-compatible provider with live discovery:

```sh
echo "$NVIDIA_API_KEY" | ur connect nvidia-nim
ur config set provider nvidia-nim
ur provider doctor nvidia-nim
# Optional self-hosted/enterprise gateway:
ur config set base_url nvidia-nim https://nim-gateway.example/v1
```

The default is `https://integrate.api.nvidia.com/v1`. NVIDIA's hosted
`/v1/models` response can be broader than the functions that the connected
account can actually invoke. UR therefore intersects it with the authenticated
NVCF `GET /v2/nvcf/functions` inventory, keeps only `ACTIVE` matches, and
removes embedding, guard, parser, translation, reward, and similar non-agent
endpoints. A custom enterprise or self-hosted NIM remains independent and uses
only that configured gateway's `/models` response.

UR calls `/models`, `/chat/completions`, and, when available, `/messages/count_tokens`; native
count failure falls back to a provider-wire estimate and never launches a
hidden completion. Streaming, standard tool calls, and image input use the
same OpenAI-compatible adapter. Vision and tools remain model-dependent. For
documented Nemotron coding-agent models, UR includes NVIDIA's
`force_nonempty_content` template option when tools are present. See NVIDIA's
[NIM LLM API reference](https://docs.api.nvidia.com/nim/reference/llm-apis)
and [NVCF API scope reference](https://docs.nvidia.com/nvcf/api#scope-reference).

`ur provider doctor nvidia-nim` verifies both the hosted catalog and the
selected model against the account-active inventory. If NVIDIA retires a
function after selection, UR redacts NVIDIA's internal function/account IDs,
removes that model from the current endpoint-scoped session catalog, and asks
the user to select an active model. `Ctrl+R` explicitly retries discovery.

Local/server providers use their normal endpoints:

- Ollama: `http://localhost:11434`
- LM Studio: `http://localhost:1234/v1`
- llama.cpp server mode: `http://localhost:8080/v1`
- vLLM server mode: `http://localhost:8000/v1`
- Unsloth Studio: `http://localhost:8888/v1`

### Unsloth provider-only mode

UR connects to a user-run Unsloth Studio inference server through its official
OpenAI-compatible API. It does not import the Unsloth Python package, launch or
update Studio, train or convert models, manage GPUs, or load a model. Start and
load Unsloth separately, then connect the generated Studio key:

```sh
ur config set provider unsloth
echo "$UNSLOTH_API_KEY" | ur connect unsloth
ur provider doctor unsloth
ur provider models unsloth --json
# choose one of the discovered model IDs with /model
```

The default endpoint is `http://localhost:8888/v1`; override it with
`ur config set base_url unsloth <url>`. Authentication is mandatory. Every Unsloth
inference request sets `enable_tools: false`, including streaming requests. The model may
still return standard OpenAI function calls; UR handles those through the same
native tool flow used by its other providers. This keeps Unsloth provider-only
and avoids running a second tool loop inside Studio. See the official
[Unsloth Studio announcement](https://github.com/unslothai/unsloth/discussions/5285)
and [Unsloth repository](https://github.com/unslothai/unsloth).

Ollama allows up to 15 minutes for response headers so a cold model load or
large prefill can begin. After headers, local and `:cloud` models use a
five-minute stream *inactivity* deadline that resets whenever bytes arrive;
remote/CCR sessions use two minutes. UR does not automatically replay a Cloud
request after that deadline, preventing a bounded failure from expanding into
the non-streaming fallback and retry chain; Cloud non-streaming fallback itself
remains bounded at two minutes. `UR_STREAM_IDLE_TIMEOUT_MS`, `API_TIMEOUT_MS`,
or an explicit request timeout can override the applicable default.

## Optional Live Provider Smoke

`bun run provider:smoke` runs optional live checks only for providers with the
required environment variables present. With no variables set it exits
successfully and reports every provider as skipped, so CI does not need secrets.

Configured providers run one short text request, a finite-timeout streaming
request, and, when `PROVIDER_SMOKE_TOOL_CALLS=1`, a forced tool-call request.

Required variables:

| Provider | Required env vars | Optional env vars |
| --- | --- | --- |
| OpenAI-compatible | `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_MODEL` | `OPENAI_COMPATIBLE_API_KEY` |
| Unsloth | `UNSLOTH_API_KEY`, `UNSLOTH_MODEL` | `UNSLOTH_BASE_URL` (defaults to `http://localhost:8888/v1`) |
| NVIDIA NIM | `NVIDIA_API_KEY`, `NVIDIA_MODEL` | `NVIDIA_BASE_URL` (defaults to `https://integrate.api.nvidia.com/v1`) |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` | `OPENAI_BASE_URL` |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | `OPENROUTER_BASE_URL` |
| Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | `ANTHROPIC_BASE_URL` |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` | `GEMINI_BASE_URL` |
| Ollama | `OLLAMA_MODEL` | `OLLAMA_BASE_URL` or `OLLAMA_HOST`; `OLLAMA_API_KEY` when required |
| LM Studio | `LMSTUDIO_BASE_URL`, `LMSTUDIO_MODEL` | `LMSTUDIO_API_KEY` |
| llama.cpp | `LLAMA_CPP_BASE_URL`, `LLAMA_CPP_MODEL` | `LLAMA_CPP_API_KEY` |
| vLLM | `VLLM_BASE_URL`, `VLLM_MODEL` | `VLLM_API_KEY` |

Common knobs:

```sh
PROVIDER_SMOKE_TIMEOUT_MS=30000
PROVIDER_SMOKE_MAX_RETRIES=0
PROVIDER_SMOKE_TOOL_CALLS=1
PROVIDER_SMOKE_OUTPUT=/tmp/ur-provider-smoke.json # --json only
```

Without `PROVIDER_SMOKE_OUTPUT`, `--json` also writes the latest report to
`diagnostics/provider-smoke/latest.json`.
