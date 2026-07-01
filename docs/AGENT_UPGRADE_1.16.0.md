# UR-AGENT 1.16.0 Upgrade Notes

UR 1.16.0 adds local-network Ollama discovery. The agent can now find Ollama
servers on your LAN, let you pick one at startup, and remember the choice for
future sessions. The endpoint is no longer hardcoded to `localhost:11434`; it
can be set via settings, environment, or a CLI flag.

## Network Ollama Discovery

### One-time discovery at startup

```sh
ur --discover-ollama
```

UR scans the active local subnets (wired Ethernet and Wi-Fi/WLAN) for hosts
listening on port `11434`, verifies each one by fetching `/api/tags`, then shows
a picker with:

- `This computer` — your local `ollama serve` at `http://localhost:11434`
- every discovered LAN host and the number of models it advertises

Select a host and UR uses it for that session only. The choice is **not**
persisted, so plain `ur` continues to use `localhost:11434`.

### Enable discovery on every startup

Add to `~/.ur/settings.json`:

```json
{
  "ollama": {
    "lanDiscovery": true
  }
}
```

The picker appears on every startup. The choice is still session-only and is
not written to settings.

### Point to a specific host without scanning

```sh
ur --ollama-host http://192.168.1.50:11434
```

This is session-only and does not write settings. It takes precedence over
settings and `OLLAMA_HOST`.

### Persistent host via settings

```json
{
  "ollama": {
    "host": "http://192.168.1.50:11434"
  }
}
```

When `ollama.host` is set, UR uses it automatically. Precedence is:

1. `--ollama-host <url>` CLI flag
2. `OLLAMA_HOST` environment variable
3. `ollama.host` in user settings
4. fallback `http://localhost:11434`

## What Uses the Chosen Host

The resolved host is used everywhere UR talks to Ollama:

- interactive chat requests (`/api/chat`)
- installed-model listing (`/api/tags`)
- model metadata refresh (`/api/show`)
- local embeddings (`/api/embed`)
- `ur model-doctor`
- `ur doctor` / `ur sysinfo`
- startup preflight connectivity check

## Security Notes

LAN scanning is opt-in only. It never runs automatically unless you pass
`--discover-ollama` or set `ollama.lanDiscovery: true`. The scan is limited to
active local IPv4 interfaces and ignores loopback and link-local addresses. It
uses bounded concurrency and short timeouts so it finishes in a few seconds on a
/24 subnet.

## Release Verification

Run these before publishing:

```sh
bun test test/ollamaDiscovery.test.ts test/ollamaModels.test.ts test/ollamaTimeout.test.ts
bun run typecheck
npm pack --dry-run
```

Optional local smoke checks:

```sh
bun src/entrypoints/cli.tsx --discover-ollama --help
bun src/entrypoints/cli.tsx --ollama-host http://localhost:11434 -p "hello"
```
