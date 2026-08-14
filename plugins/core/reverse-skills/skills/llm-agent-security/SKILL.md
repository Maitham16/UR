---
name: llm-agent-security
description: Test LLM and agent systems for prompt injection, tool abuse, memory poisoning, data leakage, unsafe autonomy, identity failures, and model or skill supply-chain risks.
allowed-tools: Read Grep Glob Bash Edit Write WebFetch WebSearch TaskCreate TaskList TaskUpdate
---

# LLM and agent security

Read `${UR_PLUGIN_ROOT}/UR-INTEGRATION.md`. Define which agent, environment, accounts, tools, data, and external targets are authorized before active testing.

## Workflow

1. Model the system: instruction hierarchy, models/providers, retrieval, memory, tools/MCP servers, identities, secrets, sandboxes, approval paths, subagents, channels, plugins/skills, and data egress.
2. Define assets and invariants: instruction integrity, confidentiality boundaries, tool authorization, target scope, tenant separation, provenance, auditability, and recoverability.
3. Build a test matrix for direct/indirect prompt injection, encoded/multimodal input, retrieval poisoning, tool-output injection, confused deputy, excessive agency, argument injection, approval bypass, memory persistence, cross-session leakage, and denial/cost exhaustion.
4. Use synthetic secrets and canary assets. Never use real credentials when a test token proves the path.
5. Evaluate at the action boundary: what instructions reached the model, what tool arguments were proposed, which policy/permission gate decided, what actually executed, and what audit evidence remained.
6. Test plugin/model/data supply chains: provenance, signatures/hashes, pinned versions, transitive tools, install scripts, configuration writes, remote content, and update behavior.
7. Measure repeatability across phrasing, placement, roles, models, and sessions. Record both successful and blocked attempts so control efficacy is visible.
8. Remediate with least-privilege tools, typed schemas, target constraints, provenance labels, untrusted-content isolation, confirmation at consequential actions, scoped credentials, memory boundaries, and regression evals.

Do not treat disclosure of a system prompt alone as equivalent to tool compromise. Report the concrete violated invariant and demonstrated impact.
