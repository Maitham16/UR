import * as fs from "node:fs";
import * as path from "node:path";
import type { Finding, Severity } from "./types.ts";

interface Rule {
  title: string;
  re: RegExp;
  severity: Severity;
  fix: string;
}

const DOCKER_RULES: Rule[] = [
  { title: "Base image pinned to :latest", re: /^\s*FROM\s+\S+:latest/im, severity: "low", fix: "Pin to a specific tag or digest." },
  { title: "Container runs as root", re: /^\s*USER\s+root\b/im, severity: "medium", fix: "Add a dedicated non-root USER." },
  { title: "ADD with a remote URL", re: /^\s*ADD\s+https?:\/\//im, severity: "medium", fix: "Use COPY or a verified download." },
  { title: "Possible secret in ENV/ARG", re: /^\s*(ENV|ARG)\s+\w*(PASSWORD|SECRET|TOKEN|KEY)\w*\s*=/im, severity: "high", fix: "Use build/runtime secrets, not image layers." },
  { title: "Pipe curl|bash during build", re: /curl[^\n]*\|\s*(bash|sh)\b/i, severity: "medium", fix: "Download, verify a checksum, then execute." },
];

const K8S_RULES: Rule[] = [
  { title: "Privileged container", re: /privileged:\s*true/i, severity: "high", fix: "Remove privileged; drop unneeded capabilities." },
  { title: "hostNetwork enabled", re: /hostNetwork:\s*true/i, severity: "medium", fix: "Avoid hostNetwork unless strictly required." },
  { title: "runAsNonRoot disabled", re: /runAsNonRoot:\s*false/i, severity: "medium", fix: "Set runAsNonRoot: true." },
];

const TF_RULES: Rule[] = [
  { title: "Ingress open to 0.0.0.0/0", re: /0\.0\.0\.0\/0/, severity: "high", fix: "Restrict CIDR ranges to known sources." },
  { title: "Public-read ACL", re: /acl\s*=\s*"public-read/i, severity: "high", fix: "Use a private ACL with an explicit policy." },
];

function apply(rules: Rule[], text: string, asset: string, category: string): Finding[] {
  const out: Finding[] = [];
  for (const r of rules) {
    if (r.re.test(text)) {
      out.push({
        id: `SEC-IAC-${out.length + 1}`,
        title: r.title,
        severity: r.severity,
        confidence: "medium",
        asset,
        category,
        cwe: "CWE-1188",
        owasp: "A05:2021",
        evidence: r.title,
        risk: `insecure ${category} configuration`,
        fix: r.fix,
        verification: "Re-scan after remediation.",
        status: "open",
      });
    }
  }
  return out;
}

export function auditDockerfile(text: string, asset: string): Finding[] {
  return apply(DOCKER_RULES, text, asset, "container");
}
export function auditK8s(text: string, asset: string): Finding[] {
  return apply(K8S_RULES, text, asset, "kubernetes");
}
export function auditTerraform(text: string, asset: string): Finding[] {
  return apply(TF_RULES, text, asset, "iac");
}

const SKIP = new Set(["node_modules", ".git", "dist", "coverage", ".309"]);

export function auditIaC(root: string): Finding[] {
  const out: Finding[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const f = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(f);
        continue;
      }
      let text = "";
      try {
        text = fs.readFileSync(f, "utf8");
      } catch {
        continue;
      }
      const rel = path.relative(root, f);
      if (e.name === "Dockerfile" || e.name.endsWith(".dockerfile")) out.push(...auditDockerfile(text, rel));
      else if (/\.ya?ml$/.test(e.name) && /(apiVersion:|kind:)/.test(text)) out.push(...auditK8s(text, rel));
      else if (e.name.endsWith(".tf")) out.push(...auditTerraform(text, rel));
    }
  };
  walk(root);
  return out;
}
