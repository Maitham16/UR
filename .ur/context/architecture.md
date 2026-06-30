# Project Architecture Context

Generated: 2026-06-30T04:20:55.438Z
Project: ur-agent

# Project DNA
- Languages: JavaScript/TypeScript
- Package managers: bun
- Build: bun run typecheck
- Test: bun run test
- Lint: —
- Run: bun run start, bun run dev
- Key folders: src, test
- Ignored folders: —
- README: README.md
- Git: yes

## Architecture Rules
- Prefer package scripts and project manifests before inventing commands.
- Treat AGENTS.md and UR.md as shared architecture instructions when present.
- Use .ur/verify.json and .ur/safety-policy.json as executable project constraints.
- Keep generated runtime state under .ur/ unless a command documents another path.

## Constraints
- Default safety policy applies until .ur/safety-policy.json is written.
- No project verify gate file detected.
- Do not expose secret-like files or environment values in command output.

## Manifests
- package.json
- bunfig.toml
- tsconfig.json
