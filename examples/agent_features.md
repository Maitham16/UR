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

Use the local memory, evidence, and browser QA helpers:

```sh
ur semantic-memory build
ur semantic-memory search "release checks"
ur claim-ledger add --claim "Release checks include typecheck" --source file:package.json
ur claim-ledger validate
ur browser-qa validate
```

Run the opt-in A2A server on loopback:

```sh
ur a2a serve --dry-run
curl http://127.0.0.1:8765/healthz
```
