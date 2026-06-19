import type { Finding } from "./types.ts";
import { formatFinding } from "./findings.ts";

export interface ReportMeta {
  title?: string;
  scope?: string;
  tools?: string[];
}

function countBySeverity(f: Finding[]) {
  return {
    critical: f.filter((x) => x.severity === "critical").length,
    high: f.filter((x) => x.severity === "high").length,
    medium: f.filter((x) => x.severity === "medium").length,
    low: f.filter((x) => x.severity === "low").length,
    info: f.filter((x) => x.severity === "info").length,
  };
}

export function toMarkdown(findings: Finding[], meta: ReportMeta = {}): string {
  const c = countBySeverity(findings);
  const head = [
    `# ${meta.title ?? "Security Assessment Report"}`,
    "",
    `Scope: ${meta.scope ?? "local workspace"}`,
    meta.tools?.length ? `Tools: ${meta.tools.join(", ")}` : undefined,
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Severity summary",
    "",
    `critical ${c.critical} · high ${c.high} · medium ${c.medium} · low ${c.low} · info ${c.info}`,
    "",
    "## Findings",
    "",
  ]
    .filter(Boolean)
    .join("\n");
  const body = findings.length ? findings.map((f) => "```\n" + formatFinding(f) + "\n```").join("\n\n") : "_No findings._";
  return `${head}\n${body}\n`;
}

export function toJson(findings: Finding[], meta: ReportMeta = {}): string {
  return JSON.stringify({ meta, generated: new Date().toISOString(), findings }, null, 2);
}

export function toCsv(findings: Finding[]): string {
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [["id", "severity", "confidence", "asset", "category", "cwe", "owasp", "title", "status"].join(",")];
  for (const f of findings) {
    rows.push([f.id, f.severity, f.confidence, f.asset, f.category, f.cwe ?? "", f.owasp ?? "", f.title, f.status].map(esc).join(","));
  }
  return rows.join("\n") + "\n";
}

export function toSarif(findings: Finding[]): string {
  const rules = [...new Map(findings.map((f) => [f.category, { id: f.category, name: f.category }])).values()];
  const results = findings.map((f) => ({
    ruleId: f.category,
    level: f.severity === "critical" || f.severity === "high" ? "error" : f.severity === "medium" ? "warning" : "note",
    message: { text: `${f.title} — ${f.risk}` },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: f.asset.split(":")[0] },
          region: { startLine: Number(f.asset.split(":")[1] ?? 1) },
        },
      },
    ],
  }));
  return JSON.stringify(
    { version: "2.1.0", $schema: "https://json.schemastore.org/sarif-2.1.0.json", runs: [{ tool: { driver: { name: "309-code", rules } }, results }] },
    null,
    2,
  );
}
