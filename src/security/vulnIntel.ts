import * as fs from "node:fs";
import { join } from "node:path";

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface Dependency {
  ecosystem: string;
  name: string;
  version?: string;
}

export interface VulnHit {
  id: string;
  package: string;
  severity: string;
  summary: string;
  fixed?: string;
}

const defaultFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, init as RequestInit);
  return { ok: res.ok, status: res.status, json: () => res.json() };
};

/** Read the dependency inventory from a project (npm today; extensible). */
export function dependencyInventory(cwd: string): Dependency[] {
  const out: Dependency[] = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(join(cwd, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
      out.push({ ecosystem: "npm", name, version: String(version).replace(/^[^0-9]*/, "") || undefined });
    }
  } catch {
    /* no package.json */
  }
  return out;
}

/** Query the OSV.dev database for known vulnerabilities in a package version. */
export async function queryOSV(dep: Dependency, fetchImpl: FetchLike = defaultFetch): Promise<VulnHit[]> {
  try {
    const res = await fetchImpl("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package: { name: dep.name, ecosystem: ecosystemName(dep.ecosystem) }, version: dep.version }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { vulns?: Array<{ id: string; summary?: string; severity?: Array<{ score?: string }>; affected?: Array<{ ranges?: Array<{ events?: Array<{ fixed?: string }> }> }> }> };
    return (data.vulns ?? []).map((v) => ({
      id: v.id,
      package: `${dep.name}@${dep.version ?? "*"}`,
      severity: v.severity?.[0]?.score ?? "unknown",
      summary: v.summary ?? v.id,
      fixed: v.affected?.[0]?.ranges?.[0]?.events?.find((e) => e.fixed)?.fixed,
    }));
  } catch {
    return [];
  }
}

export async function auditDependencies(cwd: string, fetchImpl: FetchLike = defaultFetch, max = 100): Promise<VulnHit[]> {
  const deps = dependencyInventory(cwd).slice(0, max);
  const hits: VulnHit[] = [];
  for (const d of deps) hits.push(...(await queryOSV(d, fetchImpl)));
  return hits;
}

function ecosystemName(e: string): string {
  return e === "npm" ? "npm" : e === "pip" ? "PyPI" : e === "cargo" ? "crates.io" : e === "go" ? "Go" : e;
}
