import * as fs from "node:fs";
import { dirname, join } from "node:path";
import type { Finding, Severity } from "./types.ts";

const ORDER: Severity[] = ["info", "low", "medium", "high", "critical"];
export function severityRank(s: Severity): number {
  return ORDER.indexOf(s);
}

export class FindingStore {
  private readonly file: string;
  private findings: Finding[] = [];

  constructor(cwd: string) {
    this.file = join(cwd, ".309", "security", "findings.json");
    try {
      if (fs.existsSync(this.file)) this.findings = JSON.parse(fs.readFileSync(this.file, "utf8")) as Finding[];
    } catch {
      this.findings = [];
    }
  }

  private persist(): void {
    fs.mkdirSync(dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.findings, null, 2));
  }

  add(items: Finding[]): Finding[] {
    for (const f of items) {
      f.id = `F-${String(this.findings.length + 1).padStart(4, "0")}`;
      this.findings.push(f);
    }
    this.persist();
    return items;
  }

  all(): Finding[] {
    return [...this.findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  }

  byId(id: string): Finding | undefined {
    return this.findings.find((f) => f.id === id);
  }

  setStatus(id: string, status: Finding["status"]): boolean {
    const f = this.byId(id);
    if (!f) return false;
    f.status = status;
    this.persist();
    return true;
  }

  clear(): void {
    this.findings = [];
    this.persist();
  }
}

export function formatFinding(f: Finding): string {
  return [
    `FINDING-ID: ${f.id}`,
    `Title: ${f.title}`,
    `Severity: ${f.severity}`,
    `Confidence: ${f.confidence}`,
    `Asset: ${f.asset}`,
    `Evidence: ${f.evidence}`,
    `Risk: ${f.risk}`,
    f.rootCause ? `Root Cause: ${f.rootCause}` : undefined,
    `OWASP/CWE/MITRE: ${[f.owasp, f.cwe, f.mitre].filter(Boolean).join(" / ") || "n/a"}`,
    `Fix: ${f.fix}`,
    `Verification: ${f.verification}`,
    `Status: ${f.status}`,
  ]
    .filter(Boolean)
    .join("\n");
}
