# Provider and model selection

Check what is connected, pick a provider, then pick a model scoped to it.

```sh
ur provider list          # all providers with access type and status
ur connect status         # connection state for every provider
ur provider doctor        # detailed checks for the selected provider
```

Local (default, no account needed — requires a running Ollama app):

```sh
ur config set provider ollama
ur --model qwen2.5-coder:latest
```

API key (stored securely in the OS keychain):

```sh
ur connect openai-api --key <KEY>   # or: echo "$OPENAI_API_KEY" | ur connect openai-api
ur config set provider openai-api
ur config set model gpt-5.5
```

Local OpenAI-compatible server (LM Studio, llama.cpp, vLLM):

```sh
ur config set provider lmstudio
ur config set base_url http://localhost:1234/v1
```

Subscription CLI (uses the vendor's official CLI and your subscription):

```sh
ur auth chatgpt           # official Codex CLI login
ur config set provider codex-cli
```

Inside a session, `/model` gives the same flow interactively: provider first,
then only that provider's models. Verify the active pair any time:

```sh
ur provider status
```
