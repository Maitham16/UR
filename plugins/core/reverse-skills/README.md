# Reverse Skills for UR

This first-party plugin adapts the methodology of `zhaoxuya520/reverse-skill` into UR-native research skills. It is intentionally unavailable until the user activates `/mode redteam` and acknowledges UR's risk warning.

The integration is UR-only:

- manifests, paths, commands, scope records, and instructions use UR conventions;
- it never installs itself into Claude, Codex, Cursor, Cline, or another client;
- it does not auto-download tools or write third-party client configuration;
- active tooling remains gated by the current session's `/scope` approval, normal tool permissions, sandboxing, and audit controls;
- the selected model/provider may still enforce its own policy.

Start with `/reverse-skills:start <task>` (or invoke the `reverse-skills:reverse-skill-router` skill directly). The router selects one or more specialist skills covering binary reverse engineering, exploitation, application testing, malware/EDR research, platform and radio security, forensics, LLM security, and evidence/reporting.

## Provenance

The adaptation is based on upstream commit `289c24b1617411a16b1e8d3032cce0f2fe52911d` (MIT). UR excludes the upstream GPL CTF orchestrator, external AGPL services, client-specific bootstrap scripts, field journals, and machine-specific configuration. See `NOTICE` and `UPSTREAM-LICENSE`.
