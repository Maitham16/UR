# Security Policy

Report security issues privately to the maintainer before opening a public
issue.

## Supported release

Only the latest stable UR release is supported for security fixes, distributed
as native applications on GitHub Releases, through the Homebrew tap, and through
the `ur-agent` npm launcher.

## Dependency security status

UR's release gate audits the locked dependency graph and verifies the code in
the packed and native CLIs. The current node-forge RSA fix is an explicitly
reviewed backport; the upstream registry advisory remains present in the source
dependency audit. The published npm launcher has no npm dependencies or install
scripts; it verifies and runs the same patched native application. Installing
the source checkout with npm does not apply Bun's dependency patches. See the
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
