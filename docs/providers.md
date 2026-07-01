# UR-AGENT providers

UR-AGENT integrates official model access paths only. It supports subscription
CLI login flows, explicit API-key providers, and local OpenAI-compatible
runtimes. It does not implement hidden or unofficial authentication.

## Legal auth policy

UR-AGENT never:

- scrapes browser cookies or browser sessions
- extracts, copies, or reuses OAuth refresh tokens
- reads hidden provider auth files directly
- bypasses subscription, quota, region, product, or organization restrictions
- proxies a consumer web session as an API
- claims provider support unless the official CLI/API path works

UR-AGENT stores only safe config: provider name, model name, base URL, command
path, fallback preference, and non-secret preferences. API keys are read from
environment variables only when the user explicitly selects API mode.

## Provider matrix

| Provider | Access type | Legal path |
| --- | --- | --- |
| ChatGPT/Codex | subscription | official Codex CLI login |
| Claude Code | subscription | official Claude Code login |
| Gemini CLI | subscription | official Gemini Code Assist login |
| Antigravity | subscription | official Antigravity login, where supported |
| OpenAI | API | `OPENAI_API_KEY` |
| Anthropic Claude | API | `ANTHROPIC_API_KEY` |
| Gemini | API | `GEMINI_API_KEY` |
| OpenRouter | API/router | `OPENROUTER_API_KEY` |
| Ollama | local | localhost Ollama runtime |
| LM Studio | local | local OpenAI-compatible server |
| llama.cpp | local | local OpenAI-compatible server |
| vLLM | local/server | OpenAI-compatible server |

## Commands

```sh
ur provider list
ur provider status
ur provider doctor
ur provider doctor codex-cli
ur auth chatgpt
ur auth claude
ur auth gemini
ur auth antigravity
ur config set provider codex-cli
ur config set provider claude
ur config set provider "Claude Code"
ur config set provider antigravity
ur provider doctor agy
ur config set provider ollama
ur config set provider openai-compatible
ur config set model <model>
ur config set base_url <url>
ur config set provider.fallback ollama
```

## Provider-scoped model selection

UR-AGENT shows only models available for the selected provider. This prevents selecting incompatible model/provider combinations.

## Runtime provider routing

When you select a provider and model, all agent requests are routed through that provider's backend:

- **Subscription providers** spawn the official CLI command
- **API providers** make direct HTTP API calls with your API key
- **Local providers** connect to the configured local endpoint

The selected provider determines:
- Which backend receives your requests
- Which models are available
- How authentication works
- What error messages you see

**Important:** Ollama is only used when `ollama` is the selected provider. Selecting another provider routes all requests through that provider's backend.

### `/model` command flow

When you run `/model` in the interactive agent, you get a **two-step provider-first selection**:

**Step 1: Provider Selection**

You see all configured providers with:
- Provider name (e.g., "ChatGPT/Codex", "OpenAI API", "Ollama")
- Access type: `subscription`, `api`, `local`, or `server`
- Connection status: `connected`, `missing`, `unavailable`, or `unknown`
- Credential type: `cli-login`, `api-key`, `local-runtime`, or `openai-compatible-endpoint`
- Short status message (e.g., "OPENAI_API_KEY found", "CLI not found", "localhost reachable")

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
- Effort level (if applicable)
- Thinking status (if enabled)

**Example:**
```
/model
→ Step 1: Select provider
  ChatGPT/Codex · subscription · connected
  OpenAI API · api · OPENAI_API_KEY found
  Ollama · local · localhost reachable
  
→ Select: ChatGPT/Codex

→ Step 2: Select model
  gpt-4o · Most capable GPT-4 model
  gpt-4o-mini · Fast and efficient variant
  o1 · Reasoning model
  
→ Select: gpt-4o

→ Confirmation:
  Provider: ChatGPT/Codex (subscription)
  Model: gpt-4o
  Source: static
```

### CLI workflow

```sh
# 1. Select a provider
ur config set provider openai-api

# 2. View available models for that provider (in model picker)
/model

# 3. Select a model from the filtered list
ur config set model gpt-4o

# 4. Switch to a different provider - model list updates automatically
ur config set provider anthropic-api
# Now /model shows only Claude models, not GPT models
```

### Model discovery behavior

| Provider type | Model discovery | Source label |
| --- | --- | --- |
| Subscription CLI (codex-cli, claude-code-cli, gemini-cli, antigravity-cli) | Static list of provider-specific models | static |
| API providers (openai-api, anthropic-api, gemini-api, openrouter) | Static list of provider-specific models | static |
| Local providers (ollama, lmstudio, llama.cpp, vllm) | Dynamic discovery from local server | live |
| OpenAI-compatible | Dynamic discovery from configured endpoint | live |

### API vs Subscription distinction

**Subscription providers** require official CLI login:
- `codex-cli` — ChatGPT/Codex subscription via `codex login`
- `claude-code-cli` — Claude Code subscription via `claude auth login`
- `gemini-cli` — Gemini Code Assist enterprise login
- `antigravity-cli` — Antigravity subscription login

**API providers** require environment variable with API key:
- `openai-api` — requires `OPENAI_API_KEY`
- `anthropic-api` — requires `ANTHROPIC_API_KEY`
- `gemini-api` — requires `GEMINI_API_KEY`
- `openrouter` — requires `OPENROUTER_API_KEY`

**Local providers** require local runtime:
- `ollama` — localhost Ollama server
- `lmstudio` — LM Studio OpenAI-compatible server
- `llama.cpp` — llama.cpp server mode
- `vllm` — vLLM server

**Important:**
- A ChatGPT/Claude/Gemini subscription does NOT give API access
- An API key does NOT give subscription CLI access
- OpenAI API and Codex CLI are separate providers
- Claude API and Claude Code are separate providers
- Gemini API and Gemini CLI are separate providers

### Validation

When you set a model that is incompatible with the current provider, UR-AGENT shows an error:

```
Invalid model for current provider:
  Selected provider: openai-api
  Selected model: claude-sonnet-4-20250514
  Error: Model "claude-sonnet-4-20250514" is not available for provider "openai-api".
  Valid models for openai-api: gpt-4o, gpt-4o-mini, o1, o3-mini, gpt-4-turbo
  Suggested: ur config set model gpt-4o
```

When you change providers, UR-AGENT warns if the current model is incompatible:

```
Warning: Current model "gpt-4o" is not available for provider "anthropic-api".
  Valid models for anthropic-api: claude-sonnet-4-20250514, claude-opus-4-20250514, claude-3-5-sonnet-20241022, claude-3-haiku-20240307
  After changing provider, run: ur config set model claude-sonnet-4-20250514
```

### Troubleshooting

**Check active provider and model:**
```sh
# Show current configuration
ur config get provider
ur config get model

# Or use the status command
ur provider status
```

**Provider shows "missing":**
- Install the official CLI: `brew install codex` or equivalent
- Run: `ur auth <provider>` to complete login

**Provider shows "unavailable":**
- Check API key: `echo $OPENAI_API_KEY`
- Check local server: `curl http://localhost:11434/api/tags`
- Run: `ur provider doctor <provider>` for detailed diagnostics

**Model not in list:**
- Verify provider is correct: `/provider`
- Check model belongs to provider (API models ≠ CLI models)
- For local providers, ensure server is running and model is pulled

**Requests going to wrong backend:**
- Verify selected provider: `ur config get provider`
- Change provider: `ur config set provider <provider-id>`
- The selected provider determines which backend receives requests
- Ollama is only used when `ollama` is the selected provider

**Dynamic discovery fails:**
- Local providers: check server is running at configured URL
- OpenAI-compatible: verify base_url and API key (if required)
- Fallback only to same provider's cached models (never other providers)

**Debug active runtime backend:**
```sh
# Show detailed provider status
ur provider doctor

# Check which backend will be used
# After selecting provider, all requests go through that provider's backend
```

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

## API and local providers

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

Local providers use their normal servers:

- Ollama: `http://localhost:11434`
- LM Studio: `http://localhost:1234/v1`
- llama.cpp server mode: `http://localhost:8080/v1`
- vLLM server mode: `http://localhost:8000/v1`
