# Security Policy

Report security issues privately to the maintainer before opening a public
issue.

## Supported release

Only the latest npm release of `ur-agent` is supported for security fixes.

## Handling secrets

Do not commit API keys, tokens, private URLs, credentials, local `.ur/` run
state, shell history, or generated logs. Run the repository secret scan before
release:

```bash
bun run secrets:scan
```

UR-AGENT can execute commands and load plugins. Treat plugins as trusted code,
review MCP server configuration before enabling it, and use permission modes or
sandboxes for risky workflows.
