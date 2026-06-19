import * as fsp from "node:fs/promises";
import * as fs from "node:fs";
import * as path from "node:path";
import { ScopeStore } from "./scope.ts";
import { FindingStore, formatFinding } from "./findings.ts";
import { classifyRequest } from "./classify.ts";
import { evaluate } from "./containment.ts";
import { auditText } from "./codeAudit.ts";
import { scanSecrets } from "./secrets.ts";
import { scanWorkspace } from "./attackSurface.ts";
import { toCsv, toJson, toMarkdown, toSarif } from "./reports.ts";
import { detectSecurityTools } from "./doctor.ts";
import { SECURITY_BOUNDARY, SECURITY_MODES, securityPrompt } from "./prompt.ts";
import { MITRE, OWASP_TOP10_2021 } from "./mappings.ts";
import { networkSnapshot } from "./network.ts";
import { hardeningChecks } from "./hardening.ts";
import { collect as irCollect, containmentPlan } from "./incident.ts";
import { threatModel, toMarkdown as threatModelMarkdown } from "./threatModel.ts";
import { coverage as attackCoverage, mapFindings } from "./attackMap.ts";
import { complianceReport } from "./compliance.ts";
import { auditDependencies } from "./vulnIntel.ts";
import { auditIaC } from "./cloudAudit.ts";
import { auditWeb } from "./webAudit.ts";
import { createLab } from "./lab.ts";
import { listPlaybooks, showPlaybook } from "./playbooks.ts";
import { secureApi, secureCi, secureDeploy, secureDesign, secureDocker } from "./coach.ts";
import type { Finding, Intensity, SecurityMode, TargetType } from "./types.ts";

const SKIP = new Set(["node_modules", ".git", "dist", "coverage", ".309"]);

function resolveInside(cwd: string, p: string): string | null {
  const root = path.resolve(cwd);
  const r = path.resolve(root, p);
  return r === root || r.startsWith(root + path.sep) ? r : null;
}

function collect(target: string, exts: RegExp): string[] {
  const out: string[] = [];
  let st: fs.Stats;
  try {
    st = fs.statSync(target);
  } catch {
    return out;
  }
  if (st.isFile()) return [target];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (exts.test(e.name)) out.push(f);
    }
  };
  walk(target);
  return out;
}

const HELP = `309 security commands:
  /mode <security|audit|blue-team|purple-team|pentest-lab|hardening|incident-response|secure-code>
  /scope show | set local | set <type> <target> | add-target <host> | allow-port <n> | deny-target <host> | intensity <level> | approve | clear
  /security status | rules | classify <text> | safe-alternative <text>
  /security scan | code <path> | secrets <path> | attack-surface | dependencies
  /security report [markdown|json|sarif|csv] | findings
  /security doctor | tools | owasp | mitre <Txxxx>
Active/destructive tools (nmap, sqlmap, hydra, metasploit, ...) are detected and policy-gated: they require an approved, in-scope, owned/lab target and are never run silently or destructively.`;

function readMode(cwd: string): SecurityMode {
  try {
    const m = fs.readFileSync(path.join(cwd, ".309", "security", "mode"), "utf8").trim();
    if ((SECURITY_MODES as string[]).includes(m)) return m as SecurityMode;
  } catch {
    /* default */
  }
  return "security";
}

function writeMode(cwd: string, m: SecurityMode): void {
  fs.mkdirSync(path.join(cwd, ".309", "security"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".309", "security", "mode"), m);
}

export async function handleSecurityCommand(tokens: string[], cwd: string): Promise<string> {
  let head = tokens[0] ?? "";
  let sub = tokens[1] ?? "";
  let rest = tokens.slice(2);
  const STANDALONE: Record<string, string> = {
    net: "network", vuln: "vuln", ir: "incident", attack: "attack", "threat-model": "threat-model",
    compliance: "compliance", playbook: "playbook", playbooks: "playbooks", lab: "lab", doctor: "doctor", kali: "doctor",
    "secure-design": "secure-design", "secure-api": "secure-api", "secure-ci": "secure-ci", "secure-docker": "secure-docker", "secure-deploy": "secure-deploy",
  };
  if (head in STANDALONE) {
    sub = STANDALONE[head]!;
    rest = tokens.slice(1);
    head = "security";
  }
  const scope = new ScopeStore(cwd);
  const findings = new FindingStore(cwd);

  if (head === "mode") {
    if (!(SECURITY_MODES as string[]).includes(sub)) return "modes: " + SECURITY_MODES.join(", ");
    writeMode(cwd, sub as SecurityMode);
    return `security mode -> ${sub}\n${securityPrompt(sub as SecurityMode).split("\n").slice(1).join("\n")}`;
  }

  if (head === "scope") {
    const s = scope.get();
    switch (sub) {
      case "":
      case "show":
        return s ? JSON.stringify(s, null, 2) : "no scope set. Use `/scope set local` or `/scope set <type> <target>`.";
      case "set":
        if (rest[0] === "local") {
          scope.setLocal();
          return "scope = local workspace (localhost only)";
        }
        if (!rest[1]) return "usage: /scope set <type> <target>";
        scope.setTarget(rest[1], rest[0] as TargetType);
        return `scope target = ${rest[1]} (${rest[0]}). Not approved yet — run /scope approve.`;
      case "add-target":
        scope.addTarget(rest[0] ?? "");
        return `allowed host added: ${rest[0]}`;
      case "deny-target":
        scope.denyTarget(rest[0] ?? "");
        return `denied host: ${rest[0]}`;
      case "allow-port":
        scope.allowPort(Number(rest[0]));
        return `allowed port: ${rest[0]}`;
      case "intensity":
        scope.setIntensity((rest[0] as Intensity) ?? "passive");
        return `intensity = ${rest[0]}`;
      case "approve":
        if (!s) return "set a scope first";
        scope.approve(rest.join(" "));
        return "scope APPROVED for authorized testing";
      case "clear":
        scope.clear();
        return "scope cleared";
      default:
        return HELP;
    }
  }

  switch (sub) {
    case "":
    case "help":
      return HELP;
    case "status": {
      const s = scope.get();
      return `mode: ${readMode(cwd)}\nscope: ${s ? `${s.target || "local"} (${s.targetType}, ${s.approved ? "approved" : "NOT approved"}, intensity ${s.intensity})` : "none"}\nfindings: ${findings.all().length}`;
    }
    case "rules":
      return SECURITY_BOUNDARY;
    case "classify": {
      const c = classifyRequest(rest.join(" "));
      return `class: ${c.cls}${c.category ? ` (${c.category})` : ""}\nreasons: ${c.reasons.join("; ")}`;
    }
    case "safe-alternative": {
      const v = evaluate({ requestText: rest.join(" ") }, scope.get());
      return v.allow ? "Within safe/defensive bounds — proceed (define scope for any active test)." : `${v.reason}\nSafer path: ${v.alternative}`;
    }
    case "code": {
      const p = resolveInside(cwd, rest[0] ?? ".");
      if (!p) return "path escapes workspace";
      const found: Finding[] = [];
      for (const f of collect(p, /\.(ts|tsx|js|jsx|py|go|rb|java|php|c|cpp|cs)$/).slice(0, 500)) {
        try {
          found.push(...auditText(await fsp.readFile(f, "utf8"), path.relative(cwd, f)));
        } catch {
          /* skip */
        }
      }
      findings.add(found);
      return found.length ? `${found.length} finding(s):\n\n${found.slice(0, 15).map(formatFinding).join("\n\n")}` : "no code-security findings";
    }
    case "secrets": {
      const p = resolveInside(cwd, rest[0] ?? ".");
      if (!p) return "path escapes workspace";
      const found: Finding[] = [];
      for (const f of collect(p, /\.(ts|js|py|go|rb|java|php|env|json|ya?ml|toml|ini|sh|txt|md|cfg|conf)$/).slice(0, 500)) {
        try {
          found.push(...scanSecrets(await fsp.readFile(f, "utf8"), path.relative(cwd, f)));
        } catch {
          /* skip */
        }
      }
      findings.add(found);
      return found.length ? `${found.length} secret(s) (redacted):\n${found.map((f) => `- ${f.asset}: ${f.title} — ${f.evidence}`).join("\n")}` : "no secrets detected";
    }
    case "attack-surface":
      return scanWorkspace(cwd).summary;
    case "dependencies": {
      const deps = scanWorkspace(cwd).dependencies;
      return deps.length ? `dependencies (${deps.length}):\n${deps.join(", ")}` : "no dependencies found";
    }
    case "scan": {
      const code = await handleSecurityCommand(["security", "code", "."], cwd);
      const sec = await handleSecurityCommand(["security", "secrets", "."], cwd);
      return `attack surface: ${scanWorkspace(cwd).summary}\n\ncode review: ${code.split("\n")[0]}\nsecrets: ${sec.split("\n")[0]}\n\nRun /security report for the full report.`;
    }
    case "report": {
      const all = findings.all();
      const fmt = rest[0] ?? "markdown";
      return fmt === "json" ? toJson(all) : fmt === "sarif" ? toSarif(all) : fmt === "csv" ? toCsv(all) : toMarkdown(all);
    }
    case "findings": {
      const all = findings.all();
      return all.length ? all.map((f) => `${f.id} [${f.severity}] ${f.title} — ${f.asset} (${f.status})`).join("\n") : "no findings recorded";
    }
    case "doctor":
    case "kali":
    case "tools": {
      const tools = await detectSecurityTools();
      const installed = tools.filter((t) => t.installed).length;
      return `installed ${installed}/${tools.length}\n${tools.map((t) => `${t.installed ? "✓" : "·"} ${t.name} (${t.category}, ${t.classification}/${t.riskLevel})`).join("\n")}`;
    }
    case "owasp":
      return Object.entries(OWASP_TOP10_2021).map(([k, v]) => `${k}  ${v}`).join("\n");
    case "mitre": {
      const id = (rest[0] ?? "").toUpperCase();
      const t = MITRE[id];
      return t ? `${id} ${t.name}\ntactic: ${t.tactic}\ndetection: ${t.detection}\nmitigation: ${t.mitigation}` : `known techniques: ${Object.keys(MITRE).join(", ")}`;
    }
    case "harden":
    case "linux": {
      const f = await hardeningChecks();
      findings.add(f);
      return f.length ? `${f.length} hardening finding(s):\n${f.map(formatFinding).join("\n\n")}` : "no hardening issues detected (read-only checks)";
    }
    case "network": {
      const n = await networkSnapshot();
      return `interfaces:\n${n.interfaces}\n\nlistening ports:\n${n.listeningPorts}`;
    }
    case "incident": {
      if (rest[0] === "contain-plan") return containmentPlan().map((s) => `- ${s}`).join("\n");
      const ir = await irCollect();
      return `processes:\n${ir.processes.split("\n").slice(0, 8).join("\n")}\n\nconnections:\n${ir.connections.split("\n").slice(0, 8).join("\n")}\n\npersistence:\n${ir.persistence.split("\n").slice(0, 8).join("\n")}\n\n(read-only; nothing was modified)`;
    }
    case "attack": {
      const all = findings.all();
      if (rest[0] === "coverage") return attackCoverage(all);
      const m = mapFindings(all);
      return m.length ? m.map((e) => `${e.findingId} ${e.category} -> ${e.technique} ${e.name} (${e.tactic}); detect: ${e.detection}`).join("\n") : "no findings to map";
    }
    case "threat-model":
      return threatModelMarkdown(threatModel(cwd));
    case "compliance":
      return complianceReport(rest[0] ?? "owasp");
    case "vuln": {
      const hits = await auditDependencies(cwd);
      return hits.length ? hits.map((h) => `${h.package}: ${h.id} (${h.severity})${h.fixed ? ` -> fixed in ${h.fixed}` : ""}`).join("\n") : "no known vulnerabilities found (or registry unavailable offline)";
    }
    case "cloud":
    case "containers": {
      const f = auditIaC(cwd);
      findings.add(f);
      return f.length ? `${f.length} IaC/container finding(s):\n${f.map(formatFinding).join("\n\n")}` : "no container/IaC issues detected";
    }
    case "web": {
      const w = await auditWeb(rest[0] ?? "", { scope: scope.get() });
      if (w.blocked) return `blocked: ${w.blocked}`;
      const r = w.result!;
      return `web ${r.url} [${r.status}]\nmissing headers: ${r.missingHeaders.join(", ") || "none"}\ntech: ${r.tech.join(", ") || "n/a"}\n${r.notes.join("\n")}`;
    }
    case "playbooks":
      return `playbooks: ${listPlaybooks().join(", ")}`;
    case "playbook": {
      if (rest[0] === "show") return showPlaybook(rest[1] ?? "");
      if (rest[0] === "run") {
        const s = scope.get();
        return `${showPlaybook(rest[1] ?? "")}\n\nActive steps require an approved scope (current: ${s ? (s.approved ? "approved" : "NOT approved") : "none"}). Passive steps run now via the matching /security commands.`;
      }
      return showPlaybook(rest[0] ?? "");
    }
    case "lab": {
      if (rest[0] !== "create" || !rest[1]) return "usage: /lab create <web-vuln|api-vuln|linux-audit|pcap>";
      const res = createLab(rest[1], cwd);
      return `${res.warning}\ncreated:\n${res.created.join("\n")}`;
    }
    case "secure-design":
      return secureDesign(rest.join(" "));
    case "secure-api":
      return secureApi(rest.join(" "));
    case "secure-ci":
      return secureCi();
    case "secure-docker":
      return secureDocker();
    case "secure-deploy":
      return secureDeploy();
    case "fix": {
      const f = findings.byId(rest[0] ?? "");
      return f
        ? `${f.id} ${f.title}\nproposed fix: ${f.fix}\n(applying changes requires explicit approval; review, then apply in your editor or via an approved fix step)`
        : "usage: /security fix <finding-id>";
    }
    default:
      return `"/security ${sub}" is part of the security suite. Available now: status, rules, classify, safe-alternative, scan, code, secrets, attack-surface, dependencies, report, findings, doctor, owasp, mitre. Active tooling (web/network/cloud/kali/incident-response/lab) is policy-gated and needs an approved scope — see /security help.`;
  }
}
