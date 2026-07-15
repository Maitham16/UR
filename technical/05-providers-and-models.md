# 05 — Providers & Models

Source of truth: `src/services/providers/providerRegistry.ts`, `src/utils/model/*`,
`src/services/agents/{modelPool,modelRouter,escalation}.ts`, `src/commands/{model,provider,connect,effort,fast}`.

## Provider registry (`PROVIDERS` in providerRegistry.ts)

| Provider id | Display name | Access | Credential | Status |
|---|---|---|---|---|
| `ollama` | Ollama | local runtime | none (localhost:11434) | **default local backend** |
| `llama.cpp` | llama.cpp | local/server | OpenAI-compatible endpoint (localhost:8080/v1) | enabled |
| `vllm` | vLLM | server | OpenAI-compatible endpoint (localhost:8000/v1) | enabled |
| `openai-compatible` | OpenAI-compatible | server/api | any base URL + optional `OPENAI_COMPATIBLE_API_KEY` | enabled |
| `openai-api` | OpenAI API | api | `OPENAI_API_KEY` | enabled |
| `anthropic-api` | Claude API | api | `ANTHROPIC_API_KEY` | enabled |
| `gemini-api` | Gemini API | api | `GEMINI_API_KEY` | enabled |
| `openrouter` | OpenRouter | api | `OPENROUTER_API_KEY` | enabled |
| `subscription` | Subscription | subscription login | OAuth | placeholder |
| `codex-cli` | Codex CLI | subscription via official CLI | `codex login` | `disabled: true` in registry |
| `claude-code-cli` | Claude Code | subscription via official CLI | `claude auth login` | `disabled: true` |
| `gemini-cli` | Gemini CLI | subscription via official CLI (Code Assist Std/Ent only) | — | `disabled: true` |
| `antigravity-cli` | Antigravity | subscription via official CLI | — | `disabled: true` |
| `lmstudio` | LM Studio | local server | OpenAI-compatible (localhost:1234/v1) | `disabled: true` |

Provider aliases are accepted everywhere a provider is named (e.g. `chatgpt`, `codex`,
`openai codex` → `codex-cli`). Each definition declares capability metadata (native tool
calls, native streaming, safety boundary label) used by the runtime and `/provider` UI.

### How to use

```
/provider                 # interactive picker
/provider ollama          # switch provider
/connect status           # show all provider connection states
/connect openrouter --key sk-or-…    # store an API key (keychain-backed)
/connect logout openrouter
ur provider models openrouter        # list models a provider serves
ur provider doctor ollama            # diagnose connectivity
```

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
- `settings.json → model`, `provider.active`, `provider.availableModels`,
  `provider.modelOverrides` persist choices per scope.
- `src/utils/model/aliases.ts` maps friendly aliases; `validateModel.ts` checks against the
  provider's discovered list; `ollamaTuning.ts` adjusts context/params for local models.
- Deprecation warnings and 1M-context upgrade checks live in `deprecation.ts` /
  `check1mAccess.ts`.
- Ollama remains the default provider endpoint, but no model is silently chosen
  for a fresh workspace. Configured Ollama base URLs are honored consistently.
- OpenAI-compatible endpoints use a dedicated credential key so an OpenAI API
  key is never forwarded to an arbitrary compatible base URL. Provider switches
  clear stale endpoint/command overrides.
- Request adapters preserve system prompts, tools, images, stops, sampling,
  reasoning, metadata, and structured-output settings supported by each
  provider. Provider error payloads, empty responses, and truncated streams fail
  instead of becoming synthetic empty successes.
- OpenAI API keeps Chat Completions as the default. Setting
  `provider.openaiTransport` through
  `ur config set openai_transport responses` selects the native Responses
  adapter with `store=false` by default, semantic SSE, background
  retrieve/poll/cancel, WebSocket continuation, compaction, deferred tool
  search, and bounded private cursor state. Compacted context persistence
  requires a 32-byte `UR_OPENAI_RESPONSES_STATE_KEY`.
- `ollama.ts` selects timeouts from explicit request options, then
  `API_TIMEOUT_MS`, then runtime defaults. `:cloud` models and remote sessions
  use 120 seconds; local models use 300 seconds. The same model-aware value is
  applied while waiting for `/api/chat` response headers and as the absolute
  deadline in `readOllamaChunks`.
- `ur.ts` identifies an Ollama Cloud runtime from both the selected provider and
  the `:cloud` suffix. It disables shared automatic request retries for that
  route, applies the same 120-second bound to any permitted non-streaming
  fallback, and skips fallback entirely when the Ollama stream deadline itself
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

## Session behavior knobs

| Feature | Command | Notes |
|---|---|---|
| Effort level | `/effort low·medium·high·max·auto` | persisted as `effortLevel` setting |
| Fast mode | `/fast on` | `fastMode` / `fastModePerSessionOptIn` settings |
| Advisor model | `/advisor <model>` / `/advisor off` | secondary model that critiques answers (`advisorModel` setting) |
| Always thinking | `alwaysThinkingEnabled` setting | force extended thinking |
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
