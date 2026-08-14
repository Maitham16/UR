---
name: research-evidence
description: Establish scope, review case integrity, preserve evidence-to-finding traceability, generate security diagrams, and produce reproducible technical reports.
allowed-tools: Read Grep Glob Bash Edit Write TaskCreate TaskList TaskUpdate
---

# Research evidence and reporting

Read `${UR_PLUGIN_ROOT}/UR-INTEGRATION.md`.

## Case review

Verify that:

- every active action is covered by a current-session approved UR scope;
- target, time, account, port, tool, intensity, and exclusions are consistent across scope, timeline, commands, and evidence;
- originals and derived artifacts have hashes and provenance;
- every finding links to raw evidence and a reproducible validation path;
- observations, inferences, confidence, and unresolved questions are labeled;
- secrets and personal data are minimized/redacted without destroying evidentiary value;
- cleanup/recovery actions and residual changes are recorded.

## Finding format

For each finding include identifier, title, affected asset/version, severity and rationale, confidence, prerequisites, description, evidence references, exact reproduction, demonstrated impact, likely root cause, CWE/OWASP/ATT&CK mapping where relevant, remediation, regression verification, and limitations.

## Diagrams

Use Mermaid, Graphviz, or PlantUML only when topology or sequence adds clarity. Useful views include trust/data flow, attack path, protocol/state machine, process tree, call graph, evidence lineage, and incident timeline. Keep node identifiers stable and link diagram claims to evidence IDs.

## Report

Produce an executive summary, authorization/scope, methodology, environment and tools, findings ordered by risk, attack/evidence narrative, remediation priorities, validation plan, limitations, artifact index with hashes, and timeline. Never claim exploitation or control that the evidence did not verify.
