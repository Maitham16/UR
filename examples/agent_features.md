# Agent Features

Use these commands to install and exercise the expanded agent feature surfaces.

```sh
ur agent-features
ur agent-features init
```

Install reusable project agents:

```sh
ur agent-templates list
ur agent-templates install reviewer test-runner browser-debugger
```

Create and dry-run a recurring project automation:

```sh
ur automation create nightly --schedule "0 9 * * 1-5" --prompt "Review open tasks and suggest the next action"
ur automation run nightly --dry-run
ur automation run-due --dry-run
```

Inspect task and PR handoff state:

```sh
ur agent-task status
ur agent-task diff
ur agent-task pr --create --dry-run
```

Plan and apply reliable repo edits:

```sh
ur repo-edit index
ur repo-edit search checkoutTotal
ur repo-edit plan rename oldName --to newName
ur repo-edit preview rename oldName --to newName
ur repo-edit apply rename oldName --to newName --check "bun test"
```

Run stack-aware command evidence and install after-edit gates:

```sh
ur test-first detect
ur test-first --dry-run
ur test-first install
```

Preview command safety and preserve project context:

```sh
ur safety status
ur safety check --command "rm -rf build"
ur context-pack scan
ur context-pack remember --decision "Use package scripts before ad hoc commands"
ur context-pack remember --constraint "Never expose secret values"
ur context-pack memory verify
ur context-pack compress
```

Use the local memory, evidence, and browser QA helpers:

```sh
ur semantic-memory build
ur semantic-memory search "release checks"
ur claim-ledger add --claim "Release checks include typecheck" --source file:package.json
ur claim-ledger validate
ur browser-qa validate
```

Run the v1.13.9 spec, escalation, judging, CI, and artifact flows:

```sh
ur spec init demo --goal "1. add a utils.add function 2. add a test"
ur spec status demo
ur spec run demo --all --dry-run
ur escalate plan "debug the scheduler race"
ur escalate run "refactor the cache layer" --force-oracle --dry-run
ur arena "implement a debounce helper" --agents 2 --dry-run
ur test-first --dry-run
ur ci-loop --command "bun test" --dry-run
ur artifacts capture-diff
ur artifacts capture-tests --command "bun test"
```

Run the opt-in A2A server on loopback:

```sh
ur a2a serve --dry-run
curl http://127.0.0.1:8765/healthz
```

Inspect signed skills and the stateless MCP adapter:

```sh
ur skill verify <name-or-directory>
ur mcp serve-http --help
```

Inspect the provider-free AG-UI surface and cross-client skill discovery:

```sh
ur ag-ui serve --help
ur skill verify <name-or-directory>
```

Portable skills may be placed in `.agents/skills/<name>/SKILL.md`; project
skills override user skills, and native `.ur/skills/` wins at the same scope.
