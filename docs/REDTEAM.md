# Redteam mode

`redteam` is UR's explicit, session-scoped mode for authorized security researchers. It changes UR's own prompt policy so UR does not refuse a topic solely because it involves exploit development, malware modification, payloads, persistence, credential testing, phishing simulation, detection evasion, or other dual-use research.

It does not change the policy of the selected model or provider. Local models, API providers, and subscription CLI bridges keep their own behavior. UR reports provider refusals as provider behavior rather than claiming that redteam mode overrides them.

## Activate

The first activation displays a mandatory risk warning and does not enable the mode:

```text
/mode redteam
```

After reading it, acknowledge the current warning version:

```text
/mode redteam --accept-risk
```

The acknowledgement is stored in user settings, but activation is never persisted. Every new session starts in its normal mode. Later sessions can activate with `/mode redteam`; `/mode redteam off` or selecting another working mode disables it.

## What remains enforced

Redteam removes UR topic-level restrictions, not operational controls:

- normal tool permissions and explicit deny rules;
- OS sandbox and workspace boundaries;
- current-session engagement scope and target/port/tool/intensity limits;
- action-specific approval prompts;
- secrets handling, evidence, and audit records.

Before active target testing:

```text
/scope set local
/scope allow-tool nmap
/scope allow-port 443
/scope rate 10
/scope approve
/scope show
```

For a non-local engagement, use `/scope set <target-type> <target>`, add any additional hosts and allowed ports, then approve it in the current session. Scope approval expires when the session changes. Bash and PowerShell block recognized active security tools outside that scope even in permissive permission modes. Offline artifact analysis and local research code authoring do not require a remote target scope.

Owned IPv4 networks can be scoped with CIDR (for example,
`/scope set owned-network 10.20.30.0/24`). Active commands must expose an
explicit host, URL, or IP/CIDR so UR can verify it; unresolved shell variables
and indirect target files fail closed. Wildcard subdomains require an explicit
`*.example.com` scope entry.

Scope, findings, evidence, and security memory are stored under the gitignored `.ur/security/`. Existing `.309/security/` records are read and migrated when encountered.

## Reverse Skills

The bundled `reverse-skills` plugin is UR-exclusive and declares `requiredMode: "redteam"`. Its skills are hidden/disabled outside redteam and recheck the mode on invocation. The plugin adapts the MIT-licensed `zhaoxuya520/reverse-skill` methodology into UR-native workflows without installing cross-client configuration or bundling separately licensed components.

Install/enable it from the official marketplace if it is not already enabled, activate redteam, then start with:

```text
/reverse-skills:start <research task>
```

The command preflights UR's visible task lifecycle for multi-outcome or
workspace-changing work. It creates an actionable board before Bash, edits,
writes, or delegation, so `tasks.requireBeforeChanges` remains enabled without
surfacing a failed-first `TaskListRequired` tool call. Direct specialist-skill
invocations follow the same contract.

Review [the plugin README](../plugins/core/reverse-skills/README.md) for its capability map and provenance.
