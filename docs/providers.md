# UR-AGENT providers

UR-AGENT integrates official model access paths only. API-key providers, local
runtimes, and OpenAI-compatible servers are UR-native backends: UR owns the
conversation loop, tool loop, streaming, errors, and output. Subscription CLI
integrations are external app bridges, not required dependencies. They stay
diagnosable, but normal runtime selection blocks them unless
`UR_ENABLE_EXTERNAL_APP_PROVIDERS=1` is set.

## Legal auth policy

UR-AGENT never:

- scrapes browser cookies or browser sessions
- extracts, copies, or reuses OAuth refresh tokens
- reads hidden provider auth files directly
- bypasses subscription, quota, region, product, or organization restrictions
- proxies a consumer web session as an API
- claims provider support unless the official CLI/API path works

UR-AGENT stores only safe config: provider name, model name, base URL, fallback
preference, and non-secret preferences. API keys are read from environment
variables only when the user explicitly selects API mode.

## Provider matrix

| Provider | Access type | Runtime kind | Runtime backend | Legal path |
| --- | --- | --- | --- | --- |
| OpenAI API | API | UR-native | `api:openai` | `OPENAI_API_KEY` |
| Claude API | API | UR-native | `api:anthropic` | `ANTHROPIC_API_KEY` |
| Gemini API | API | UR-native | `api:gemini` | `GEMINI_API_KEY` |
| OpenRouter | API/router | UR-native | `api:openrouter` | `OPENROUTER_API_KEY` |
| Ollama | local | UR-native | `ollama` | localhost Ollama runtime |
| LM Studio | local/server | UR-native | `openai-compatible:lmstudio` | local OpenAI-compatible server |
| llama.cpp | local/server | UR-native | `openai-compatible:llama.cpp` | local OpenAI-compatible server |
| vLLM | local/server | UR-native | `openai-compatible:vllm` | OpenAI-compatible server |
| Codex CLI | subscription | external app bridge | `subscription-cli:codex` | official Codex CLI login |
| Claude Code | subscription | external app bridge | `subscription-cli:claude-code` | official Claude Code login |
| Gemini CLI | subscription | external app bridge | `subscription-cli:gemini` | official Gemini Code Assist login |
| Antigravity | subscription | external app bridge | `subscription-cli:antigravity` | official Antigravity login, where supported |

## Commands

```sh
ur provider list
ur provider status
ur provider doctor
ur provider doctor codex-cli
ur provider doctor agy
# Optional external app bridge diagnostics:
ur auth chatgpt
ur config set provider ollama
ur config set provider openai-api
ur config set provider anthropic-api
ur config set provider gemini-api
ur config set provider openrouter
ur config set provider openai-compatible
ur config set model <model>
ur config set base_url <url>
ur config set provider.fallback ollama
```

## Provider-scoped model selection

UR-AGENT shows providers first, then only models available for the selected provider. This prevents incompatible model/provider pairs and keeps API-key, local/server, and external app bridge model lists separate.

## Runtime provider routing

When you select a UR-native provider and model, every agent request is routed
through that provider's backend:

- **API providers** make direct HTTP calls in each provider's native wire format: Anthropic uses `x-api-key` + `anthropic-version` against `/v1/messages`; OpenAI uses `Authorization: Bearer` against `/v1/chat/completions`; Gemini uses `x-goog-api-key` against `…:generateContent`; OpenRouter uses its OpenAI-compatible chat endpoint.
- **Local/server providers** connect to the configured local or OpenAI-compatible endpoint (`/v1/chat/completions` for LM Studio, llama.cpp and vLLM; the native tags/chat API for Ollama)
- **External app bridges** for subscription CLIs are blocked by default because
  they delegate turns to another agent app. If deliberately enabled with
  `UR_ENABLE_EXTERNAL_APP_PROVIDERS=1`, failures still remain provider-scoped
  and never fall back to Ollama.

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

**Step 2: Model Selection**

After selecting a provider:
- Only models from that provider are shown
- Each model shows its description
- Model source is displayed: `live` (dynamic discovery), `cache` (fallback), or `static` (predefined)
- Press Esc to go back and change provider

**Confirmation**

After selecting a model, the confirmation shows:
- Selected provider and access type
- Selected model name
- Model source (live/cache/static)
- Runtime backend
- Effort level (if applicable)
- Thinking status (if enabled)

**Example:**
```
/model
→ Step 1: Select provider
  Ollama · local · local-runtime · localhost reachable
  OpenAI API · api · OPENAI_API_KEY found
  
→ Select: Ollama

→ Step 2: Select model
  llama3 · discovered from Ollama · live
  qwen3-coder:480b-cloud · discovered from Ollama · live
  
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
ur config set model gpt-5.5

# 4. Switch to a different provider - model list updates automatically
ur config set provider anthropic-api
# Now /model shows only Claude API models, not OpenAI API or Ollama models
```

### Model discovery behavior

| Provider type | Model discovery | Source label |
| --- | --- | --- |
| API providers (openai-api, anthropic-api, gemini-api, openrouter) | Static list of provider-specific models | static |
| Local/server providers (ollama, lmstudio, llama.cpp, vllm) | Dynamic discovery from the selected provider endpoint | live |
| OpenAI-compatible | Dynamic discovery from configured endpoint | live |
| External app bridges (codex-cli, claude-code-cli, gemini-cli, antigravity-cli) | Static bridge aliases; blocked by default for normal runtime | static |

### API vs Subscription distinction

**External app bridge providers** require official CLI login and explicit runtime opt-in:
- `codex-cli` — Codex CLI subscription via `codex login`
- `claude-code-cli` — Claude Code subscription via `claude auth login`
- `gemini-cli` — Gemini Code Assist enterprise login
- `antigravity-cli` — Antigravity subscription login

**API providers** require environment variable with API key:
- `openai-api` — requires `OPENAI_API_KEY`
- `anthropic-api` — requires `ANTHROPIC_API_KEY`
- `gemini-api` — requires `GEMINI_API_KEY`
- `openrouter` — requires `OPENROUTER_API_KEY`

**Local/server providers** require local runtime or endpoint:
- `ollama` — localhost Ollama server
- `lmstudio` — LM Studio OpenAI-compatible server
- `llama.cpp` — llama.cpp server mode
- `vllm` — vLLM server

**Important:**
- A ChatGPT/Claude/Gemini subscription does NOT give API access
- An API key does NOT give subscription CLI access
- UR does not require Codex CLI, Claude Code, Gemini CLI, or Antigravity to use
  API, Ollama, or OpenAI-compatible providers
- OpenAI API and Codex CLI are separate providers
- Claude API and Claude Code are separate providers
- Gemini API and Gemini CLI are separate providers

### Validation

When you set a model that is incompatible with the current provider, UR-AGENT shows an error:

```
Invalid model for current provider:
  Selected provider: openai-api
  Selected model: claude-sonnet-5
  Valid models for openai-api: gpt-5.5, gpt-5.4, gpt-5.4-mini, gpt-4o, gpt-4o-mini, o1, o3-mini
  Suggested action: Run /model and choose a model from openai-api, or run: ur config set model gpt-5.5
  Error: Model "claude-sonnet-5" is not available for provider "openai-api".
```

When you change providers, UR-AGENT warns if the current model is incompatible:

```
Warning: Current model "gpt-5.5" is not available for provider "anthropic-api" and will be cleared.
  Valid models for anthropic-api: claude-sonnet-5, claude-opus-4-8, claude-opus-4-7
  After changing provider, run /model or: ur config set model claude-sonnet-5
```

For external app bridges, UR stores scoped IDs such as `claude-code/sonnet`,
but normal runtime dispatch rejects the bridge before spawning the external app
unless `UR_ENABLE_EXTERNAL_APP_PROVIDERS=1` is set.

### Troubleshooting

**Check active provider and model:**
```sh
# Show selected provider, model, access type, credential, readiness, and backend
ur provider status
```

**Provider is an external app bridge:**
- Choose a UR-native API/local/server provider for normal UR interaction
- Run `ur provider doctor <provider>` only to inspect the external app bridge
- Set `UR_ENABLE_EXTERNAL_APP_PROVIDERS=1` only if you intentionally want UR to
  delegate turns to that external app

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
| `openai-compatible` | `compatible`, `openai compatible` |
| `ollama` | `ollama local` |
| `lmstudio` | `LM Studio`, `lm-studio` |
| `llama.cpp` | `llama cpp`, `llamacpp`, `llama-cpp` |
| `vllm` | `vllm server` |

`ur provider doctor` checks the selected provider. It reports installed/missing
CLIs, official login status where available, API key presence for API providers,
local endpoint reachability, detectable model availability, unsupported account
type signals, and fallback configuration.

Fallback is never silent by default. If the selected provider fails, UR-AGENT
reports the selected provider, failure reason, suggested fix, and configured
fallback option.

## Subscription CLI providers

- `codex-cli`: detects `codex --version`, uses `codex login` or
  `codex login --device-auth`, and checks `codex login status`.
- `claude-code-cli`: detects `claude --version`, uses `claude auth login`, and
  checks `claude auth status` when available. If `ANTHROPIC_API_KEY` is set,
  doctor warns that API-key mode may override subscription auth.
- `gemini-cli`: launches only the official Gemini CLI flow. If the detected
  path is an unsupported personal-account path, UR-AGENT prints a clear error.
- `antigravity-cli`: detects official CLI commands including `agy --version`,
  `antigravity --version`, `google-antigravity --version`, or `ag --version`
  where installed. It launches only an installed official CLI command where
  supported; UR-AGENT does not invent flags.

## API and local/server providers

API providers require explicit user selection and environment keys:

```sh
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=...
```

OpenAI-compatible endpoints can point at local or cloud endpoints:

```sh
ur config set provider openai-compatible
ur config set base_url http://localhost:1234/v1
ur config set model local-model-name
```

Local/server providers use their normal endpoints:

- Ollama: `http://localhost:11434`
- LM Studio: `http://localhost:1234/v1`
- llama.cpp server mode: `http://localhost:8080/v1`
- vLLM server mode: `http://localhost:8000/v1`
