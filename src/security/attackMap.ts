import type { Finding } from "./types.ts";
import { MITRE } from "./mappings.ts";

const CATEGORY_TO_TECHNIQUE: Record<string, string> = {
  injection: "T1059",
  "command-injection": "T1059",
  "sql-injection": "T1190",
  xss: "T1190",
  deserialization: "T1190",
  tls: "T1190",
  cors: "T1190",
  misconfig: "T1190",
  secrets: "T1078",
  crypto: "T1078",
};

export interface AttackMapEntry {
  findingId: string;
  category: string;
  technique: string;
  name: string;
  tactic: string;
  detection: string;
  mitigation: string;
}

export function mapFindings(findings: Finding[]): AttackMapEntry[] {
  return findings.map((f) => {
    const tid = f.mitre ?? CATEGORY_TO_TECHNIQUE[f.category] ?? "T1190";
    const t = MITRE[tid] ?? MITRE.T1190!;
    return { findingId: f.id, category: f.category, technique: tid, name: t.name, tactic: t.tactic, detection: t.detection, mitigation: t.mitigation };
  });
}

export function coverage(findings: Finding[]): string {
  const byTech = new Map<string, number>();
  for (const e of mapFindings(findings)) byTech.set(e.technique, (byTech.get(e.technique) ?? 0) + 1);
  const lines = [...byTech.entries()].map(([t, c]) => `${t} ${MITRE[t]?.name ?? ""}: ${c}`);
  return lines.length ? lines.join("\n") : "(no findings to map)";
}
