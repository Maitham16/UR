# Agent Feature Expansion

This page tracks the nine agent-platform additions that were prioritized after
comparing UR with current Codex, Claude Code, Copilot, and Jules-style agent
workflows.

## Commands

```sh
ur agent-features
ur agent-features init
ur agent-templates list
ur agent-templates install
ur agent-task status
ur agent-task diff
ur agent-task pr
ur agent-task pr --create --dry-run
ur automation list
ur automation create nightly --schedule "0 9 * * 1-5" --prompt "Review open tasks"
ur automation run nightly --dry-run
ur automation run-due
ur model-doctor
ur a2a serve --dry-run
ur semantic-memory build
ur semantic-memory search "release checks"
ur claim-ledger add --claim "..." --source web:https://example.com
ur claim-ledger validate
ur browser-qa validate
ur browser-qa run home-page-smoke --dry-run
```

## Nine Points

| Point | UR surface | What it adds |
| --- | --- | --- |
| Task-to-PR workflow | `ur agent-task status|diff|pr --create` | Summarizes task state, git changes, branch, and can create a GitHub PR through `gh` |
| Recurring automations | `ur automation` and `.ur/automations/` | Project-local automation specs with validation, next-run calculation, manual run, due-run, dry-run, and last-run state |
| Model capability report | `ur model-doctor` | Local Ollama model inventory with context length, advertised capabilities, and likely vision/code readiness |
| Reusable agent templates | `ur agent-templates install` | Project agents for review, tests, browser QA, docs research, security, release notes, PR fixes, and memory curation |
| GitHub agent runner | `.github/workflows/ur-agent.yml` scaffold | Opt-in CI entry point for manual prompts or `/ur` issue comments |
| A2A adapter handoff | `ur a2a serve` | Loopback Agent Card and token-gated task execution endpoint |
| Semantic memory index | `ur semantic-memory build|search` | Local memory index over durable memory, docs, README, and UR instructions |
| Claim provenance ledger | `ur claim-ledger add|list|validate` | Maps generated claims to web, file, MCP, tool, or user sources |
| Browser replay evals | `ur browser-qa list|validate|run` | Validates replay fixtures and performs lightweight target smoke checks |

## Design Notes

These additions keep network-facing behavior opt-in, but the local task, PR,
automation, model, and template surfaces are executable commands. UR already has
tasks, custom agents, memory files, browser workflows, evidence commands, A2A
Agent Card export, and local Ollama routing; these surfaces make those
capabilities easier to discover and reuse.

Network-facing behavior, such as a full A2A task server or a GitHub bot that can
push code, should remain explicitly opt-in because it changes the trust and
permission boundary.
