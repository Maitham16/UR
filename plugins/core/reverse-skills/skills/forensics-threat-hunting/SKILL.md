---
name: forensics-threat-hunting
description: Perform disk, memory, packet, and log forensics; build timelines and IOCs; create YARA/Sigma detections; and conduct evidence-driven threat hunts.
allowed-tools: Read Grep Glob Bash Edit Write
---

# Forensics and threat hunting

Read `${UR_PLUGIN_ROOT}/UR-INTEGRATION.md`. Preserve chain of custody and distinguish collection facts, parsed observations, hypotheses, and conclusions.

## Workflow

1. Define questions, relevant time range/timezone, assets, evidence owners, collection authority, retention constraints, and known contamination.
2. Acquire or reference immutable images/exports. Record tool/version, source identifier, timestamps, cryptographic hashes, and transfer history.
3. Normalize time and identity. Build a cross-source timeline from filesystem, process, authentication, endpoint, cloud, DNS/proxy, network, registry/config, persistence, and application evidence.
4. Memory: enumerate processes, handles, modules, sockets, injected/executable regions, callbacks, credentials exposure, kernel anomalies, and relevant process artifacts without altering the source image.
5. Network: reconstruct flows/sessions, protocol metadata, DNS/TLS, transferred objects, beacon patterns, authentication, and lateral movement; retain packet references for every claim.
6. Hunt from falsifiable hypotheses mapped to behaviors and ATT&CK, not single brittle IOCs. State data prerequisites, query window, exclusions, expected false positives, and coverage gaps.
7. Convert stable observations to YARA/Sigma/EDR queries with fixtures and negative tests. Separate high-confidence indicators from contextual leads.
8. Produce an incident timeline, affected assets/accounts, confidence, impact, containment options, eradication/recovery considerations, and unresolved collection needs.

Do not delete, quarantine, reset accounts, or alter production telemetry without the relevant operational approval.
