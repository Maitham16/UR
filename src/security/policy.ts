import type { SecurityMode, SecurityToolPolicy } from "./types.ts";

const ALL: SecurityMode[] = ["security", "audit", "blue-team", "purple-team", "pentest-lab", "hardening", "incident-response", "secure-code"];
const LAB: SecurityMode[] = ["pentest-lab", "purple-team"];

/**
 * Catalog of security tools with safety policy. Passive tools run inside the
 * workspace without approval; active tools require a defined scope; destructive
 * tools require an approved lab/owned scope. This drives detection (doctor),
 * planning, and the containment firewall.
 */
export const SECURITY_TOOLS: SecurityToolPolicy[] = [
  // Discovery / enumeration
  p("nmap", "discovery", "active", true, true, ALL, "high", "version/script scans require approval; localhost allowed"),
  p("rustscan", "discovery", "active", true, true, ALL, "high"),
  p("masscan", "discovery", "active", true, true, LAB, "high", "mass scanning is lab/owned only"),
  p("dnsrecon", "discovery", "active", true, true, ALL, "medium"),
  p("dnsenum", "discovery", "active", true, true, ALL, "medium"),
  p("whois", "discovery", "passive", false, false, ALL, "low"),
  p("dig", "discovery", "passive", false, false, ALL, "low"),
  p("enum4linux-ng", "discovery", "active", true, true, ALL, "medium", "authorized SMB enumeration only"),
  // Network analysis
  p("tcpdump", "network", "active", true, true, ALL, "medium", "capture requires approval"),
  p("tshark", "network", "active", true, true, ALL, "medium"),
  p("wireshark", "network", "active", true, true, ALL, "medium"),
  p("zeek", "network", "passive", false, false, ALL, "low"),
  p("suricata", "network", "passive", false, false, ALL, "low"),
  // Web app security
  p("nikto", "web", "active", true, true, ALL, "medium"),
  p("whatweb", "web", "active", true, false, ALL, "low"),
  p("wafw00f", "web", "active", true, false, ALL, "low"),
  p("ffuf", "web", "active", true, true, ALL, "medium", "strict rate limit + scope"),
  p("gobuster", "web", "active", true, true, ALL, "medium"),
  p("nuclei", "web", "active", true, true, ALL, "medium", "safe templates only"),
  p("sqlmap", "web", "destructive", true, true, LAB, "critical", "authorized/lab only; no destructive options"),
  p("dalfox", "web", "active", true, true, LAB, "high"),
  // Password / offline audit
  p("john", "password", "passive", false, true, ALL, "high", "offline audit of user-owned hashes only"),
  p("hashcat", "password", "passive", false, true, ALL, "high", "offline audit of user-owned hashes only"),
  p("hydra", "password", "destructive", true, true, LAB, "critical", "lab/owned explicit authorization only"),
  // Wireless (lab/owned only)
  p("aircrack-ng", "wireless", "destructive", true, true, LAB, "critical", "owned/lab networks only"),
  p("kismet", "wireless", "active", true, true, LAB, "high", "authorized monitoring only"),
  // Exploit validation
  p("metasploit", "exploit", "destructive", true, true, LAB, "critical", "research/explain ok; execution lab/owned + approval"),
  p("searchsploit", "exploit", "passive", false, false, ALL, "low", "research / patch awareness"),
  // Forensics / IR
  p("volatility", "forensics", "passive", false, false, ALL, "low"),
  p("binwalk", "forensics", "passive", false, false, ALL, "low"),
  p("yara", "forensics", "passive", false, false, ALL, "low"),
  p("clamav", "forensics", "passive", false, false, ALL, "low"),
  p("rkhunter", "forensics", "passive", false, false, ALL, "low"),
  // Reverse engineering
  p("radare2", "re", "passive", false, false, ALL, "low"),
  p("ghidra", "re", "passive", false, false, ALL, "low"),
  p("checksec", "re", "passive", false, false, ALL, "low"),
  // Secure code / SCA (passive, workspace-safe)
  p("semgrep", "sast", "passive", false, false, ALL, "low", "no network by default"),
  p("bandit", "sast", "passive", false, false, ALL, "low"),
  p("gosec", "sast", "passive", false, false, ALL, "low"),
  p("brakeman", "sast", "passive", false, false, ALL, "low"),
  p("pip-audit", "sca", "passive", false, false, ALL, "low"),
  p("safety", "sca", "passive", false, false, ALL, "low"),
  p("npm-audit", "sca", "passive", false, false, ALL, "low"),
  p("osv-scanner", "sca", "passive", false, false, ALL, "low"),
  p("trivy", "sca", "passive", false, false, ALL, "low"),
  p("grype", "sca", "passive", false, false, ALL, "low"),
  p("syft", "sca", "passive", false, false, ALL, "low"),
  p("secret-scan", "secrets", "passive", false, false, ALL, "low", "redact output"),
  p("trufflehog", "secrets", "passive", false, false, ALL, "low", "local repos unless approved"),
  p("detect-secrets", "secrets", "passive", false, false, ALL, "low"),
  // Cloud / container / IaC
  p("checkov", "iac", "passive", false, false, ALL, "low"),
  p("hadolint", "iac", "passive", false, false, ALL, "low"),
  p("kube-bench", "iac", "passive", false, false, ALL, "low"),
  p("kube-hunter", "iac", "active", true, true, LAB, "high", "owned cluster only"),
  p("tfsec", "iac", "passive", false, false, ALL, "low"),
  // System hardening
  p("lynis", "hardening", "passive", false, false, ALL, "low"),
  p("chkrootkit", "hardening", "passive", false, false, ALL, "low"),
];

function p(
  name: string,
  category: string,
  classification: SecurityToolPolicy["classification"],
  requiresScope: boolean,
  requiresApproval: boolean,
  allowedModes: SecurityMode[],
  riskLevel: SecurityToolPolicy["riskLevel"],
  notes?: string,
): SecurityToolPolicy {
  return { name, category, classification, requiresScope, requiresApproval, allowedModes, riskLevel, notes };
}

const BY_NAME = new Map(SECURITY_TOOLS.map((t) => [t.name, t]));

export function toolPolicy(name: string): SecurityToolPolicy | undefined {
  return BY_NAME.get(name);
}

export function toolsByCategory(): Record<string, SecurityToolPolicy[]> {
  const out: Record<string, SecurityToolPolicy[]> = {};
  for (const t of SECURITY_TOOLS) (out[t.category] ??= []).push(t);
  return out;
}
