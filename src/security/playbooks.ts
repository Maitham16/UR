export interface Playbook {
  name: string;
  objective: string;
  scope: string;
  tools: string[];
  passiveSteps: string[];
  activeSteps: string[];
  approvals: string;
  evidence: string[];
  safety: string[];
}

const pb = (
  name: string,
  objective: string,
  scope: string,
  tools: string[],
  passiveSteps: string[],
  activeSteps: string[],
  approvals: string,
  evidence: string[],
  safety: string[],
): Playbook => ({ name, objective, scope, tools, passiveSteps, activeSteps, approvals, evidence, safety });

const SAFE = ["enforce scope", "rate-limited", "non-destructive", "log every command", "rollback/cleanup defined"];

export const PLAYBOOKS: Record<string, Playbook> = {
  web_app_audit: pb("web_app_audit", "Assess a web app's security posture", "owned/authorized web target", ["whatweb", "nikto", "nuclei"], ["fetch headers + security headers", "map routes/forms", "review TLS"], ["nuclei safe templates", "nikto"], "active steps require approved scope", ["headers", "findings", "report"], SAFE),
  api_audit: pb("api_audit", "Review an API for authz/validation flaws", "owned/authorized API", ["curl", "httpie"], ["enumerate documented endpoints", "check authn/authz", "schema validation review"], ["fuzz inputs within scope"], "active steps require approved scope", ["responses", "findings"], SAFE),
  local_linux_audit: pb("local_linux_audit", "Harden a local Linux host", "localhost", ["lynis"], ["sshd_config review", "firewall status", "permissions audit", "sysctl review"], [], "none (read-only)", ["hardening findings"], SAFE),
  dependency_audit: pb("dependency_audit", "Find vulnerable dependencies", "local repo", ["osv-scanner", "npm-audit"], ["inventory dependencies", "OSV/CVE lookup", "prioritize by severity"], [], "none (read-only)", ["SBOM", "vuln list", "fix plan"], SAFE),
  secrets_audit: pb("secrets_audit", "Find hardcoded secrets", "local repo", ["secret-scan", "detect-secrets"], ["scan files", "redact matches", "check git history"], [], "none (read-only)", ["redacted matches"], SAFE),
  docker_audit: pb("docker_audit", "Audit container build/config", "local Dockerfiles", ["hadolint", "trivy"], ["Dockerfile static checks", "image scan"], [], "none (read-only)", ["IaC findings"], SAFE),
  kubernetes_audit: pb("kubernetes_audit", "Audit k8s manifests/cluster", "owned cluster / manifests", ["kube-bench", "checkov"], ["manifest static checks", "RBAC review"], ["kube-bench on owned cluster"], "cluster checks require approval", ["manifest findings"], SAFE),
  incident_triage: pb("incident_triage", "Triage a suspected incident", "localhost", ["volatility", "yara"], ["collect processes/connections/services", "review logins/persistence", "build timeline"], [], "no delete/quarantine without approval", ["timeline", "artifacts (hashes)"], SAFE),
  network_baseline: pb("network_baseline", "Baseline local network state", "localhost", ["ss", "ip"], ["interfaces", "listening ports", "connections"], [], "capture requires approval", ["baseline snapshot"], SAFE),
  wifi_lab_audit: pb("wifi_lab_audit", "Wireless audit in a lab", "owned/lab wireless only", ["kismet", "aircrack-ng"], ["passive survey of owned network"], ["lab-only active tests"], "owned/lab + explicit approval", ["capture (owned)"], SAFE),
  ctf_lab: pb("ctf_lab", "Practice in a CTF/lab", "ctf/lab target", ["nmap", "ffuf"], ["enumerate the lab target"], ["lab exploitation within rules"], "lab scope + approval", ["notes", "flags"], SAFE),
  secure_code_review: pb("secure_code_review", "Security review of source", "local repo", ["semgrep", "bandit"], ["static analysis", "manual review of sinks", "map to OWASP/CWE"], [], "none (read-only)", ["findings", "fix plan"], SAFE),
};

export function listPlaybooks(): string[] {
  return Object.keys(PLAYBOOKS);
}

export function showPlaybook(name: string): string {
  const p = PLAYBOOKS[name];
  if (!p) return `unknown playbook. available: ${listPlaybooks().join(", ")}`;
  return [
    `# ${p.name}`,
    `objective: ${p.objective}`,
    `scope: ${p.scope}`,
    `tools: ${p.tools.join(", ")}`,
    `passive steps: ${p.passiveSteps.join("; ")}`,
    `active steps (require approval): ${p.activeSteps.length ? p.activeSteps.join("; ") : "none"}`,
    `approvals: ${p.approvals}`,
    `evidence: ${p.evidence.join(", ")}`,
    `safety: ${p.safety.join("; ")}`,
  ].join("\n");
}
