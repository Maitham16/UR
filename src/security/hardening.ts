import { spawnExec, type ExecFn } from "./exec.ts";
import type { Finding, Severity } from "./types.ts";

/** Read-only host hardening checks. Never modifies the system. */
export async function hardeningChecks(exec: ExecFn = spawnExec): Promise<Finding[]> {
  const findings: Finding[] = [];
  let n = 0;
  const add = (title: string, severity: Severity, evidence: string, fix: string) => {
    findings.push({
      id: `SEC-HARD-${++n}`,
      title,
      severity,
      confidence: "medium",
      asset: "localhost",
      category: "hardening",
      cwe: "CWE-16",
      owasp: "A05:2021",
      evidence: evidence.slice(0, 200),
      risk: "weak system hardening",
      fix,
      verification: "Re-run hardening checks after applying the change.",
      status: "open",
    });
  };

  const ssh = await exec("bash", ["-lc", "grep -iE '^[[:space:]]*PermitRootLogin' /etc/ssh/sshd_config 2>/dev/null || true"], { timeoutMs: 5000 });
  if (/PermitRootLogin\s+yes/i.test(ssh.stdout)) add("SSH permits root login", "high", ssh.stdout.trim(), "Set `PermitRootLogin no` in sshd_config.");

  const fw = await exec("bash", ["-lc", "(ufw status 2>/dev/null || firewall-cmd --state 2>/dev/null) || echo none"], { timeoutMs: 5000 });
  if (/inactive|not running|^none$/im.test(fw.stdout.trim())) add("Host firewall inactive", "medium", fw.stdout.trim() || "(no firewall)", "Enable ufw or firewalld with a default-deny policy.");

  const ww = await exec("bash", ["-lc", "find . -maxdepth 2 -type f -perm -0002 2>/dev/null | head -5 || true"], { timeoutMs: 6000 });
  if (ww.stdout.trim()) add("World-writable files present", "medium", ww.stdout.trim().split("\n").slice(0, 3).join(", "), "Remove world-write permission (chmod o-w).");

  return findings;
}
