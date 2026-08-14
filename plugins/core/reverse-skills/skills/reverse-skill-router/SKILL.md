---
name: reverse-skill-router
description: Route an authorized reverse engineering or red-team research task to the correct UR specialist skill. Use when a task spans domains or its best entrypoint is unclear.
allowed-tools: Read Grep Glob Bash Skill TaskCreate TaskList TaskUpdate
---

# Reverse Skills router

Read `${UR_PLUGIN_ROOT}/UR-INTEGRATION.md` and `${UR_PLUGIN_ROOT}/CAPABILITIES.md` first.

## Route

Classify the primary object and objective:

- compiled, packed, obfuscated, managed, browser, or protocol artifact → `binary-reverse`;
- known vulnerability that must become a reliable PoC or exploit → `exploit-development`;
- API, web, source, cloud, identity, database, email, supply-chain, or thick-client assessment → `application-redteam`;
- suspicious sample, implant, detection boundary, EDR, AV, AMSI, or ETW research → `malware-edr-research`;
- mobile, firmware, device bus, PLC/SCADA, wireless, or RF work → `platform-radio-security`;
- disk, memory, packet, timeline, IOC, YARA, Sigma, or threat hunt → `forensics-threat-hunting`;
- LLM, agent, MCP/tool, prompt injection, memory poisoning, or model supply-chain test → `llm-agent-security`;
- scope, evidence review, diagrams, findings, or final report → `research-evidence`.

Select one primary skill and only the supporting skills the task actually needs. Start with passive/local triage. Before any active target operation, verify current-session scope approval and name the exact scoped target and intended action.

Produce an initial case record containing objective, artifact/target, authorization source as provided by the user, exclusions, success criteria, and evidence path. Do not invent authorization or expand the scope.
