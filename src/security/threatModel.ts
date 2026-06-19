import { scanWorkspace } from "./attackSurface.ts";

export interface StrideItem {
  category: string;
  threat: string;
  mitigation: string;
}

export interface ThreatModel {
  assets: string[];
  entryPoints: string[];
  trustBoundaries: string[];
  stride: StrideItem[];
  abuseCases: string[];
  mermaid: string;
}

const STRIDE: StrideItem[] = [
  { category: "Spoofing", threat: "An attacker impersonates a user or service", mitigation: "Strong auth, MFA, mTLS" },
  { category: "Tampering", threat: "Unauthorized modification of data or code", mitigation: "Integrity checks, signing, access control" },
  { category: "Repudiation", threat: "Actions cannot be attributed", mitigation: "Audit logging, signed/append-only logs" },
  { category: "Information Disclosure", threat: "Sensitive data is exposed", mitigation: "Encryption, least privilege, secrets management" },
  { category: "Denial of Service", threat: "Resource exhaustion or outage", mitigation: "Rate limiting, quotas, autoscaling" },
  { category: "Elevation of Privilege", threat: "Gaining higher privileges", mitigation: "Least privilege, input validation, sandboxing" },
];

export function threatModel(cwd: string): ThreatModel {
  const s = scanWorkspace(cwd);
  const entryPoints = [...s.routes.slice(0, 10), ...s.fileUploads.slice(0, 5)];
  const assets = ["source code", ...(s.dependencies.length ? [`${s.dependencies.length} dependencies`] : []), ...(s.envSecrets.length ? ["environment secrets/config"] : [])];
  const trustBoundaries = ["client ↔ application", ...(s.subprocess.length ? ["application ↔ OS (subprocess)"] : []), ...(s.dockerfiles.length ? ["container ↔ host"] : [])];
  const abuseCases = [
    s.dynamicEval.length ? "Inject code through an eval/Function sink" : "",
    s.subprocess.length ? "Inject OS commands through a subprocess call" : "",
    s.fileUploads.length ? "Upload a malicious file" : "",
    s.routes.length ? "Reach a sensitive route without authorization" : "",
  ].filter(Boolean);
  const mermaid = ["flowchart LR", "  user[User] --> app[Application]", s.subprocess.length ? "  app --> os[OS / subprocess]" : "", s.dependencies.length ? "  app --> deps[Dependencies]" : "", s.dockerfiles.length ? "  app --> host[Container host]" : ""]
    .filter(Boolean)
    .join("\n");
  return { assets, entryPoints, trustBoundaries, stride: STRIDE, abuseCases, mermaid };
}

export function toMarkdown(tm: ThreatModel): string {
  return [
    "# Threat Model",
    "",
    "## Assets",
    ...tm.assets.map((a) => `- ${a}`),
    "",
    "## Entry points",
    ...(tm.entryPoints.length ? tm.entryPoints.map((e) => `- ${e}`) : ["- (none detected)"]),
    "",
    "## Trust boundaries",
    ...tm.trustBoundaries.map((b) => `- ${b}`),
    "",
    "## STRIDE",
    ...tm.stride.map((s) => `- **${s.category}**: ${s.threat} — _${s.mitigation}_`),
    "",
    "## Abuse cases",
    ...(tm.abuseCases.length ? tm.abuseCases.map((a) => `- ${a}`) : ["- (none detected)"]),
    "",
    "## Data flow",
    "```mermaid",
    tm.mermaid,
    "```",
    "",
  ].join("\n");
}
