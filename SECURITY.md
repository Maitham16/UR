# Security Policy

Report security issues privately to the maintainer before opening a public
issue.

## Supported release

Only the latest stable UR release is supported for security fixes, distributed
as native applications on GitHub Releases and as `ur-agent` on npm.

## Dependency security status

UR's release gate audits the locked dependency graph and verifies the code in
the packed and native CLIs. The current node-forge RSA fix is an explicitly
reviewed backport; the upstream registry advisory remains present, including
in npm's unpatched dependency tree. See the
[backport record](patches/README.md) for exact scope, behavior checks, upstream
status, and review deadline. This record must be updated or removed when an
upstream fixed release becomes available.

## Handling secrets

Do not commit API keys, tokens, private URLs, credentials, local `.ur/` run
state, shell history, or generated logs. Run the repository secret scan before
release:

```bash
bun run secrets:scan
```

UR-Nexus can execute commands and load plugins. Treat plugins as trusted code,
review MCP server configuration before enabling it, and use permission modes or
sandboxes for risky workflows.
