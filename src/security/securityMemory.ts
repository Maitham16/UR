import * as fs from "node:fs";
import { join } from "node:path";

export const SECURITY_TABLES = [
  "security_scopes",
  "assets",
  "findings",
  "evidence",
  "tool_runs",
  "vulnerabilities",
  "mitigations",
  "reports",
  "attack_mappings",
  "incidents",
  "hardening_checks",
  "accepted_risks",
] as const;

export type SecurityTable = (typeof SECURITY_TABLES)[number];

/** JSON-backed security memory, one collection per table. */
export class SecurityMemory {
  private readonly dir: string;
  private readonly legacyDir: string;

  constructor(cwd: string) {
    this.dir = join(cwd, ".ur", "security", "db");
    this.legacyDir = join(cwd, ".309", "security", "db");
  }

  private file(t: SecurityTable): string {
    return join(this.dir, `${t}.json`);
  }

  all(t: SecurityTable): Array<Record<string, unknown>> {
    try {
      if (fs.existsSync(this.file(t))) return JSON.parse(fs.readFileSync(this.file(t), "utf8")) as Array<Record<string, unknown>>;
      const legacy = join(this.legacyDir, `${t}.json`);
      if (fs.existsSync(legacy)) return JSON.parse(fs.readFileSync(legacy, "utf8")) as Array<Record<string, unknown>>;
    } catch {
      /* ignore */
    }
    return [];
  }

  add(t: SecurityTable, row: Record<string, unknown>): void {
    const rows = this.all(t);
    rows.push({ ...row, _ts: new Date().toISOString() });
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file(t), JSON.stringify(rows, null, 2));
  }

  tables(): readonly string[] {
    return SECURITY_TABLES;
  }
}
