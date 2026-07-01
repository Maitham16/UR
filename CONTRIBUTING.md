# Contributing to UR-AGENT

Use the project scripts before opening a pull request:

```bash
bun install
bun test
bun run typecheck
bun run lint
bun run build
```

Keep changes scoped and update documentation for public behavior. Do not commit
local runtime state, secrets, generated caches, or private `.ur/` data.

Plugin contributions should start in `plugins/community/` or from
`plugins/examples/command-template/`. First-party plugins that ship in releases
belong in `plugins/core/` and must be listed in `.ur-plugin/marketplace.json`.

Release work must follow `RELEASE.md` and must not claim success without command
evidence.
