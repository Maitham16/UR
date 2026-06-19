import { spawnExec, type ExecFn } from "./exec.ts";
import { SECURITY_TOOLS } from "./policy.ts";

export interface ToolStatus {
  name: string;
  category: string;
  installed: boolean;
  path?: string;
  riskLevel: string;
  classification: string;
}

function binFor(name: string): string {
  if (name === "npm-audit") return "npm";
  if (name === "metasploit") return "msfconsole";
  return name;
}

/**
 * Detect availability of security tools. This NEVER executes a security tool —
 * it only checks whether the binary is on PATH (`command -v`).
 */
export async function detectSecurityTools(exec: ExecFn = spawnExec): Promise<ToolStatus[]> {
  const out: ToolStatus[] = [];
  for (const t of SECURITY_TOOLS) {
    let installed = false;
    let where: string | undefined;
    try {
      const r = await exec("bash", ["-lc", `command -v ${binFor(t.name)} 2>/dev/null || true`], { timeoutMs: 5000 });
      const line = (r.stdout || "").trim().split("\n")[0] ?? "";
      if (line) {
        installed = true;
        where = line;
      }
    } catch {
      /* detection failure = treat as not installed */
    }
    out.push({ name: t.name, category: t.category, installed, path: where, riskLevel: t.riskLevel, classification: t.classification });
  }
  return out;
}
