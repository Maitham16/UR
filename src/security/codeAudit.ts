import type { Finding, Severity } from "./types.ts";

interface Rule {
  id: string;
  title: string;
  re: RegExp;
  severity: Severity;
  category: string;
  cwe?: string;
  owasp?: string;
  fix: string;
}

const RULES: Rule[] = [
  { id: "eval", title: "Dynamic code execution (eval/Function)", re: /\b(eval|new Function)\s*\(/, severity: "high", category: "injection", cwe: "CWE-95", owasp: "A03:2021", fix: "Avoid dynamic code execution; parse data explicitly." },
  { id: "shell", title: "Shell execution with interpolation", re: /\b(execSync|exec)\s*\(\s*[`'"][^`'"]*\$\{|child_process|os\.system\s*\(|subprocess\.(call|run|Popen)\s*\([^)]*shell\s*=\s*True/, severity: "high", category: "command-injection", cwe: "CWE-78", owasp: "A03:2021", fix: "Use argument arrays without a shell and validate inputs." },
  { id: "sqli", title: "SQL built by concatenation/interpolation", re: /\b(query|execute)\s*\(\s*[`'"][^`'"]*\$\{|("|')\s*(SELECT|INSERT|UPDATE|DELETE)\b[^"']*\2\s*\+/i, severity: "high", category: "sql-injection", cwe: "CWE-89", owasp: "A03:2021", fix: "Use parameterized queries / prepared statements." },
  { id: "xss", title: "Raw HTML sink (XSS)", re: /dangerouslySetInnerHTML|\.innerHTML\s*=|\bv-html\b/, severity: "medium", category: "xss", cwe: "CWE-79", owasp: "A03:2021", fix: "Escape or sanitize output; avoid raw HTML sinks." },
  { id: "weak_hash", title: "Weak hash algorithm", re: /\b(md5|sha1)\b/i, severity: "medium", category: "crypto", cwe: "CWE-327", owasp: "A02:2021", fix: "Use SHA-256+ / bcrypt / argon2 as appropriate." },
  { id: "rand", title: "Insecure randomness", re: /Math\.random\s*\(\)/, severity: "low", category: "crypto", cwe: "CWE-330", owasp: "A02:2021", fix: "Use a CSPRNG (crypto.randomBytes / WebCrypto)." },
  { id: "tls_off", title: "TLS verification disabled", re: /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true/, severity: "high", category: "tls", cwe: "CWE-295", owasp: "A02:2021", fix: "Enable certificate verification." },
  { id: "deser", title: "Insecure deserialization", re: /\b(pickle\.loads|yaml\.load\s*\(|Marshal\.load|readObject\s*\()/, severity: "high", category: "deserialization", cwe: "CWE-502", owasp: "A08:2021", fix: "Use safe loaders / validated schemas." },
  { id: "cors", title: "Permissive CORS", re: /Allow-Origin['"]?\s*[:,]\s*['"]\*|cors\(\s*\)/i, severity: "medium", category: "cors", cwe: "CWE-942", owasp: "A05:2021", fix: "Restrict allowed origins to a known list." },
  { id: "debug", title: "Debug mode enabled", re: /\bdebug\s*[=:]\s*(true|True)\b/, severity: "low", category: "misconfig", cwe: "CWE-489", owasp: "A05:2021", fix: "Disable debug in production builds." },
];

export function auditText(text: string, asset: string): Finding[] {
  const findings: Finding[] = [];
  text.split("\n").forEach((line, i) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("*")) return;
    for (const r of RULES) {
      if (r.re.test(line)) {
        findings.push({
          id: `SEC-CODE-${findings.length + 1}`,
          title: r.title,
          severity: r.severity,
          confidence: "medium",
          asset: `${asset}:${i + 1}`,
          category: r.category,
          cwe: r.cwe,
          owasp: r.owasp,
          evidence: line.trim().slice(0, 160),
          risk: `${r.category} weakness (${r.cwe ?? "n/a"}).`,
          fix: r.fix,
          verification: "Re-run the audit after remediation and add a regression test.",
          status: "open",
        });
      }
    }
  });
  return findings;
}
