import type { Finding } from "./types.ts";

interface Pattern {
  id: string;
  title: string;
  re: RegExp;
}

const PATTERNS: Pattern[] = [
  { id: "aws_key", title: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "private_key", title: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { id: "gh_token", title: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: "slack_token", title: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: "google_api", title: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "jwt", title: "JSON Web Token", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\b/ },
  { id: "generic", title: "Hardcoded secret/password", re: /\b(?:password|passwd|secret|api[_-]?key|token)\s*[=:]\s*['"][^'"\n]{6,}['"]/i },
];

/** Redact a secret so it is never printed in full. */
export function redact(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 3)}…${value.slice(-2)} [${value.length} chars]`;
}

export function scanSecrets(text: string, asset: string): Finding[] {
  const findings: Finding[] = [];
  text.split("\n").forEach((line, i) => {
    for (const pat of PATTERNS) {
      const m = pat.re.exec(line);
      if (m) {
        findings.push({
          id: `SEC-SECRET-${findings.length + 1}`,
          title: pat.title,
          severity: "high",
          confidence: "medium",
          asset: `${asset}:${i + 1}`,
          category: "secrets",
          cwe: "CWE-798",
          owasp: "A07:2021",
          evidence: `match: ${redact(m[0])}`,
          risk: "Hardcoded credentials can be extracted from source control and reused.",
          fix: "Move the value to an environment variable or secrets manager and rotate the exposed secret.",
          verification: "Re-scan after removal and confirm it is purged from git history.",
          status: "open",
        });
      }
    }
  });
  return findings;
}
