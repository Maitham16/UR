# Usage Guide

UR is a terminal agent. Running `ur` opens an interactive session in the current directory, while `ur -p` runs one non-interactive prompt and exits.

## Interactive Mode

```sh
ur
```

Use interactive mode for iterative coding, debugging, research, and repository exploration. The session can read project instructions, use tools, call slash commands, and keep resumable conversation history.

Useful options:

```sh
ur --model qwen2.5-coder:latest
ur --add-dir ../other-project
ur --permission-mode ask
ur --continue
ur --resume
```

## Print Mode

Print mode is useful for scripts and shell pipelines:

```sh
ur -p "write a changelog entry for the current diff"
```

Output formats:

```sh
ur -p --output-format text "explain src/main.tsx"
ur -p --output-format json "return a JSON summary of this repo"
ur -p --output-format stream-json "stream progress while answering"
```

Structured output can be validated with a JSON schema:

```sh
ur -p \
  --output-format json \
  --json-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}' \
  "summarize this project"
```

## Models

The wrapper in `bin/ur.js` sets `OLLAMA_MODEL` from:

1. `OLLAMA_MODEL`
2. `UR_MODEL`
3. `llama3.2`

You can also choose the model for a single session:

```sh
ur --model llama3.2
ur --model qwen2.5-coder:latest
```

UR talks to a local Ollama instance at the fixed endpoint `http://localhost:11434/api`. The endpoint cannot be changed, and Ollama Cloud, remote endpoints, and model API keys are not supported.

## Project Instructions

Add a `UR.md` file to the repository root for team-shared instructions. UR loads it as project context.

Use `UR.local.md` for private local instructions. It is ignored by `.gitignore`.

Project `.ur/` assets can hold settings, skills, agents, MCP config, and local runtime state. Commit only shared files. Keep local memory, generated indexes, logs, and local settings untracked.

## Commands

UR includes slash commands and CLI subcommands for common workflows:

- `/help` or `ur --help` for command discovery
- `ur mcp ...` to configure MCP servers
- `ur plugin ...` to manage plugins and marketplaces
- `ur agents` to list configured agents
- `ur doctor` to inspect CLI health
- `ur update` or `ur upgrade` to check for updates

Run each command with `--help` for exact flags.

## Permissions

By default, UR asks before sensitive tool actions. For automation, use explicit allow and deny lists:

```sh
ur -p \
  --allowed-tools "Read,Edit,Bash(git:*)" \
  --disallowed-tools "Bash(rm:*)" \
  "inspect the current diff"
```

Avoid `--dangerously-skip-permissions` unless the session is inside a disposable sandbox.
