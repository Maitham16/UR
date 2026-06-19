// Shared types for the Security Engineering Core.
// Everything here is defensive / authorized-only by design.

export type RequestClass = "defensive" | "dual_use" | "unsafe";

export type Intensity = "passive" | "safe" | "normal" | "aggressive-lab-only";

export type TargetType =
  | "local-workspace"
  | "local-machine"
  | "lab-vm"
  | "owned-server"
  | "owned-network"
  | "ctf-lab"
  | "third-party-authorized";

export type ToolClass = "passive" | "active" | "destructive";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type SecurityMode =
  | "security"
  | "audit"
  | "blue-team"
  | "purple-team"
  | "pentest-lab"
  | "hardening"
  | "incident-response"
  | "secure-code";

export interface Scope {
  target: string;
  targetType: TargetType;
  allowedHosts: string[];
  disallowedHosts: string[];
  allowedPorts: number[];
  allowedTools: string[];
  intensity: Intensity;
  rateLimitPerMin: number;
  evidencePath: string;
  approved: boolean;
  approvalNote?: string;
  createdAt: string;
}

export interface SecurityToolPolicy {
  name: string;
  category: string;
  classification: ToolClass;
  requiresScope: boolean;
  requiresApproval: boolean;
  /** Security modes in which the tool may be considered. */
  allowedModes: SecurityMode[];
  riskLevel: RiskLevel;
  notes?: string;
}

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  confidence: "low" | "medium" | "high";
  asset: string;
  category: string;
  cwe?: string;
  owasp?: string;
  mitre?: string;
  evidence: string;
  risk: string;
  rootCause?: string;
  fix: string;
  verification: string;
  status: "open" | "fixed" | "accepted" | "false-positive";
}

export interface ContainmentVerdict {
  allow: boolean;
  reason?: string;
  alternative?: string;
  requiresApproval?: boolean;
}

export interface SecurityAction {
  requestText?: string;
  tool?: string;
  toolClass?: ToolClass;
  destructive?: boolean;
  target?: string;
  port?: number;
  intensity?: Intensity;
  mode?: SecurityMode;
}
