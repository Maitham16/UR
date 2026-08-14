# Capability routing map

This map preserves the upstream capability surface in a smaller UR-native set of composable skills.

| UR skill | Adapted upstream areas |
|---|---|
| `reverse-skill-router` | master routing, attack-chain routing, case intake |
| `binary-reverse` | reverse-engineering, IDA, Ghidra, radare2, binary diff, .NET, Go/Rust, macOS, JS, browser extensions, DSL/VM, protocol reverse |
| `exploit-development` | pwn-chain, patch-diff exploit, attack-chain, pentest tools |
| `application-redteam` | API, code audit, database, identity federation, email, supply chain, cloud/K8s, thick client, browser automation |
| `malware-edr-research` | malware analysis, anti-analysis, EDR/AV reverse engineering and validation |
| `platform-radio-security` | APK/mobile, firmware, hardware, OT/ICS, Wi-Fi, SDR/radio |
| `forensics-threat-hunting` | digital forensics, threat hunting, incident evidence, detection engineering |
| `llm-agent-security` | LLM/agent security, prompt injection, tool abuse, memory and supply-chain tests |
| `research-evidence` | case review, documentation, diagrams, evidence-to-finding traceability |

The upstream CTF Sandbox Orchestrator is not included because it is separately GPL-licensed. Pentest Swarm and other external services are not bundled or automatically invoked.
