# Basic chat

```bash
ur                 # starts the interactive TUI (big UR banner)
```

- Pick a model at startup, or switch any time with `/model`.
- `/models` lists installed Ollama models (or reports a clean error if Ollama is offline).
- Type normally to chat with the selected model. Streaming is live; press `Esc` to interrupt.
- `Ctrl+V` pastes an image from the clipboard for the model to analyze.
- `/usage` shows token usage; `/status` shows model, workspace, git, OS.
