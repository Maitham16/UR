# UR Gap Analysis — 2026-08-11 Implemented Release Audit

Baseline audited: `ur-agent@1.79.1`, commit `6faed11`. Implemented in
`1.80.0`; stale-feature cleanup completed in `1.80.1`.
Primary references were rechecked before implementation: Claude Code
2.1.221–2.1.224, the final Model Context Protocol specification dated
2026-07-28, and the Agent2Agent 1.0 release.

## Result

All recommended gaps that strengthen UR without weakening its operator trust
boundary are implemented. “Approve all”/`autoApprove` remains available and
unchanged. UR does not add automated approval delegation.

| Area | Release result |
|---|---|
| Credential-safe sandboxing | Added the official sandbox runtime, trusted-source-only `sandbox.credentials`, file/environment masking, regex extraction, JWT claim masking, AWS credential pairs, SigV4 rewriting, and `network.tlsTerminate`. |
| Strict egress | Added trusted `sandbox.network.strictAllowlist`; non-allowlisted destinations are denied instead of prompting. |
| Filesystem deny regression | Verified canonical path normalization handles both `~/.aws` and `~/.aws/`; regression tests cover both forms. |
| Parameter-aware permissions | Added `Tool(parameter:value)` matching with wildcards, including rules such as `Agent(model:opus)` and `Bash(timeout:*)`. |
| Shell approval hardening | Added tree-sitter enforcement for production Bash, zsh `[[ ... ]]` command-substitution detection, visible rendering for tabs/control/zero-width/bidirectional characters, and PowerShell quote-path validation. |
| Session containment | Added a 200-search default WebSearch session budget (`UR_MAX_WEB_SEARCHES_PER_SESSION`) and a non-fatal subagent-spawn advisory (`UR_SUBAGENT_SPAWN_ADVISORY_PER_SESSION`). |
| Headless subagents | Added `--forward-subagent-text` for nested assistant output in `stream-json`, correlated to the spawning tool-use ID. |
| Model Context Protocol | Added final `input_required` results and codes while retaining older elicitation compatibility. Existing roots support now includes all added directories plus `notifications/roots/list_changed`. |
| Agent-to-Agent cards | Audit disproved the reported mismatch: `protocolVersion: 0.3.0` belongs to the deliberately retained legacy card; the negotiated modern card is produced separately and signed correctly. No false version change was made. |
| Accessibility | Added `--screen-reader`, `screenReaderMode`, append-only plain-text rendering, edit announcements, and reduced animation. |
| In-session configuration | Added `/config key=value`, including thinking, screen reader, reduced motion, verbose output, auto-compaction, editor mode, and Vim escape sequence. |
| Directory automation | Added the `DirectoryAdded` hook and roots-change notification after `/add-dir`. |
| Session lifecycle | Added `/session status|list|archive|unarchive` and `ur session list|archive|unarchive`. Archived sessions cannot appear in resume/fork discovery until restored. |
| Vim input | Added `vimEscape=<sequence>`; for example, `/config editor=vim vimEscape=jj`. |
| Telemetry | Added privacy-safe `assistant_response` events, message/request/tool correlation, and workflow name/run identifiers. |
| Command quality | Removed the no-op `/output-style` command and dormant `/ultraplan` registration, renamed `/debug-v2` to `/fix-bug`, removed duplicate 3D aliases, expanded protocol names in help, and added registry checks against public version jargon. |

## Corrected findings and deliberate omissions

- `roots/list` was not absent. UR already served the initial working directory;
  this release extends it to added directories and change notifications.
- Retracted finding: the old and modern Agent-to-Agent cards are separate,
  negotiated compatibility representations selected by `a2aServer.ts`. The
  legacy card’s `protocolVersion: 0.3.0` is truthful; the v1 card is produced
  separately by `a2aV1.ts` and signed independently. No code fix was required.
- gRPC transport and AP2 payments are optional integrations, not correctness
  requirements for UR’s local coding-agent surface. Shipping either without a
  real transport consumer, payment policy, credential model, and end-to-end
  conformance suite would add attack surface without useful capability, so they
  are deliberately omitted.
- Anthropic removed `ultraplan` in Claude Code 2.1.222. UR’s command was already
  unregistered and permanently disabled, so 1.80.1 removes its unreachable
  command, task state, pills, metadata, polling, and UI. The active
  `ultrareview` workflow remains available with its own keyword helper.
- `EndConversation`, managed-gateway spend UX, `/dataviz`, and automated
  approval delegation remain intentionally omitted. They either duplicate
  existing controls, are content rather than capability, or weaken the explicit
  operator trust boundary.

## Primary sources

- [Claude Code 2.1.221](https://github.com/anthropics/claude-code/releases/tag/v2.1.221)
- [Claude Code 2.1.222](https://github.com/anthropics/claude-code/releases/tag/v2.1.222)
- [Claude Code 2.1.223](https://github.com/anthropics/claude-code/releases/tag/v2.1.223)
- [Claude Code 2.1.224](https://github.com/anthropics/claude-code/releases/tag/v2.1.224)
- [Anthropic sandboxing documentation](https://code.claude.com/docs/en/sandboxing)
- [Model Context Protocol 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [Model Context Protocol final schema](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts)
- [Agent2Agent 1.0 changes](https://a2a-protocol.org/latest/whats-new-v1/)
- [Agent2Agent 1.0 specification](https://a2a-protocol.org/latest/specification/)
- [Agent Payments Protocol reference repository](https://github.com/google-agentic-commerce/AP2)
- [OpenTelemetry generative-AI attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)
