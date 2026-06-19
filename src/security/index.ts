// UR security module — ported from the 309 Stability-Aware agent.
// Self-contained: only Node builtins + files within this directory.
// The model-tool registration (tools.ts) is intentionally omitted; UR exposes
// these capabilities through the `/security` slash command instead.
export * from "./types.ts";
export { classifyRequest, type Classification } from "./classify.ts";
export { ScopeStore, isLabOrOwned, isLocalHost } from "./scope.ts";
export { evaluate as containmentEvaluate } from "./containment.ts";
export { SECURITY_TOOLS, toolPolicy, toolsByCategory } from "./policy.ts";
export { scanSecrets, redact } from "./secrets.ts";
export { auditText } from "./codeAudit.ts";
export { scanWorkspace, type AttackSurface } from "./attackSurface.ts";
export { FindingStore, formatFinding, severityRank } from "./findings.ts";
export { toMarkdown, toJson, toCsv, toSarif } from "./reports.ts";
export { detectSecurityTools, type ToolStatus } from "./doctor.ts";
export { securityPrompt, SECURITY_BOUNDARY, SECURITY_MODES } from "./prompt.ts";
export { handleSecurityCommand } from "./commands.ts";
