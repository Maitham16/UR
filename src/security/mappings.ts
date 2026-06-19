export const OWASP_TOP10_2021: Record<string, string> = {
  "A01:2021": "Broken Access Control",
  "A02:2021": "Cryptographic Failures",
  "A03:2021": "Injection",
  "A04:2021": "Insecure Design",
  "A05:2021": "Security Misconfiguration",
  "A06:2021": "Vulnerable and Outdated Components",
  "A07:2021": "Identification and Authentication Failures",
  "A08:2021": "Software and Data Integrity Failures",
  "A09:2021": "Security Logging and Monitoring Failures",
  "A10:2021": "Server-Side Request Forgery (SSRF)",
};

export const CWE: Record<string, string> = {
  "CWE-78": "OS Command Injection",
  "CWE-79": "Cross-site Scripting",
  "CWE-89": "SQL Injection",
  "CWE-95": "Eval Injection",
  "CWE-200": "Information Exposure",
  "CWE-295": "Improper Certificate Validation",
  "CWE-327": "Broken or Risky Cryptographic Algorithm",
  "CWE-330": "Insufficient Randomness",
  "CWE-489": "Active Debug Code",
  "CWE-502": "Deserialization of Untrusted Data",
  "CWE-798": "Use of Hardcoded Credentials",
  "CWE-918": "Server-Side Request Forgery",
  "CWE-942": "Permissive Cross-domain Policy",
};

// Small curated MITRE ATT&CK reference for defensive mapping (detection + mitigation).
export const MITRE: Record<string, { name: string; tactic: string; detection: string; mitigation: string }> = {
  T1190: { name: "Exploit Public-Facing Application", tactic: "Initial Access", detection: "WAF and application logs; anomalous request patterns", mitigation: "Patch, input validation, WAF, network segmentation" },
  T1110: { name: "Brute Force", tactic: "Credential Access", detection: "Authentication failure spikes; impossible travel", mitigation: "Account lockout, MFA, rate limiting" },
  T1059: { name: "Command and Scripting Interpreter", tactic: "Execution", detection: "Process/command-line telemetry", mitigation: "Least privilege, application allowlisting" },
  T1078: { name: "Valid Accounts", tactic: "Defense Evasion", detection: "Anomalous logins; new-device alerts", mitigation: "MFA, credential hygiene, session monitoring" },
  T1486: { name: "Data Encrypted for Impact", tactic: "Impact", detection: "Mass file-modification events", mitigation: "Backups, least privilege, EDR" },
};

export function owaspName(id?: string): string | undefined {
  return id ? OWASP_TOP10_2021[id] : undefined;
}
export function cweName(id?: string): string | undefined {
  return id ? CWE[id] : undefined;
}
