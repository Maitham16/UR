---
name: application-redteam
description: Conduct authorized application and infrastructure research across APIs, source code, web, cloud/Kubernetes, databases, identity federation, email, supply chain, browser automation, and thick clients.
allowed-tools: Read Grep Glob Bash Edit Write WebFetch WebSearch TaskCreate TaskList TaskUpdate
---

# Application red-team research

Read `${UR_PLUGIN_ROOT}/UR-INTEGRATION.md`. Treat schemas, source, exported traffic, and local configurations as preferred starting evidence.

## Workflow

1. Inventory assets, trust boundaries, roles, identities, data classes, protocols, deployment components, third parties, and explicit exclusions.
2. Map reachable surface from OpenAPI/GraphQL schemas, routes, client bundles, IPC, update channels, cloud manifests, IAM/RBAC, CI workflows, SBOMs, and database configuration.
3. Build an authorization matrix: actor × object × action × tenant. Test authentication, session/token lifecycle, object/function/property authorization, workflow transitions, and confused-deputy paths.
4. Validate input and parser boundaries: injection, request smuggling, deserialization, upload/archive handling, SSRF, template engines, path handling, GraphQL batching, WebSocket state, and protocol downgrade.
5. Examine identity federation precisely: issuer, audience, redirect URI, state/nonce/PKCE, signature/key selection, claim mapping, token exchange, logout, and cross-tenant binding.
6. Review supply-chain and cloud controls: provenance, pinned actions/images, secret exposure, artifact signing, dependency reachability, IAM least privilege, metadata service, workload identity, RBAC, network policies, and admission controls.
7. For databases and email, prefer configuration and controlled test accounts. Cover exposure, TLS, authz, dangerous defaults, backup access, SPF/DKIM/DMARC, mailbox rules, and BEC-relevant workflows.
8. Confirm each finding with the least invasive request that proves the boundary. Respect scoped rate limits; never treat enumeration hits as verified vulnerabilities.
9. Record raw request/response pairs with secrets redacted, affected asset/role, preconditions, impact, CWE/OWASP mapping, remediation, and a regression test.

Browser automation and active scanners are target operations. Check `/scope show` before use and keep origins, accounts, ports, and rates inside the approved engagement.
