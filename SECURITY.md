# Security Policy

Report security issues privately to the maintainer before opening a public
issue.

## Supported release

Only the latest stable UR release is supported for security fixes, distributed
as native applications on GitHub Releases, through the Homebrew tap, and through
the `ur-agent` npm launcher.

## Dependency security status

UR's release gate audits the locked dependency graph and verifies the code in
the packed and native CLIs. The node-forge RSA fix and legacy Zod collection-size fix are explicitly
reviewed backports; their registry advisories remain present in the source
dependency audit. UR's root Zod uses the upstream-fixed 4.6.7 release. The published npm launcher has no npm dependencies or install
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

## Optional execution boundaries and evidence

Permission mode remains the user's choice. `ur safety init --preset sandboxed`
generates a separate settings file for explicit use with
`ur --settings .ur/sandboxed.settings.json`; generation does not enable it.
The preset requests a required OS sandbox with no unsandboxed fallback and
scoped shell network/credential access. Review its merged exceptions and scope
in the [sandbox guide](technical/12-security-sandbox-stability.md#opt-in-sandboxed-preset).
Trusted credential/strict-egress controls are ignored from repository-local
settings. Plugins, MCP servers, hooks and external provider CLI internals are
separate trust boundaries; a UR shell sandbox does not contain all of them.

`ur safety audit --json` exposes attack detections and benign false positives
for a small versioned offline regression suite. Those results do not establish
model attack resistance. Real OS enforcement is qualified separately with
fake credentials, private files and local HTTP fixtures; an unavailable
environment is reported as unavailable. Neither report changes permissions
or introduces an additional mandatory approval.

Spec/kernel verification requires successful executions bound to the current
run, exact command/cwd and unchanged source state. Old or stale PASS records
cannot establish current verification. Source observations do not establish
correctness of outside files, external services, concurrent writers, or a
trusted custom runner's assertions. `ur doctor --readiness` reports these
limits, recorded costs and recovery state without generating model output or
starting configured MCP servers. Reported usage can be unknown, especially for
external subscription CLIs; unknown cost must not be interpreted as zero.
