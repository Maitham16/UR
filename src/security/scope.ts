import * as fs from "node:fs";
import { join } from "node:path";
import type { Intensity, Scope, TargetType } from "./types.ts";

const LAB_TYPES: TargetType[] = ["lab-vm", "owned-server", "owned-network", "ctf-lab", "third-party-authorized"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.trim().toLowerCase());
}

export function isLabOrOwned(t: TargetType): boolean {
  return LAB_TYPES.includes(t);
}

function emptyScope(cwd: string): Scope {
  return {
    target: "",
    targetType: "local-workspace",
    allowedHosts: [],
    disallowedHosts: [],
    allowedPorts: [],
    allowedTools: [],
    intensity: "passive",
    rateLimitPerMin: 30,
    evidencePath: join(cwd, ".309", "security", "evidence"),
    approved: false,
    createdAt: new Date().toISOString(),
  };
}

/** Persistent engagement scope + authorization. Active tests require this. */
export class ScopeStore {
  private readonly file: string;
  private readonly cwd: string;
  private scope: Scope | null = null;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.file = join(cwd, ".309", "security", "scope.json");
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.file)) this.scope = JSON.parse(fs.readFileSync(this.file, "utf8")) as Scope;
    } catch {
      this.scope = null;
    }
  }

  private persist(): void {
    if (!this.scope) return;
    fs.mkdirSync(join(this.cwd, ".309", "security"), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.scope, null, 2));
  }

  get(): Scope | null {
    return this.scope;
  }

  setLocal(): Scope {
    this.scope = { ...emptyScope(this.cwd), target: "local-workspace", targetType: "local-workspace", allowedHosts: ["localhost", "127.0.0.1"] };
    this.persist();
    return this.scope;
  }

  setTarget(target: string, targetType: TargetType): Scope {
    this.scope = { ...emptyScope(this.cwd), target, targetType };
    this.persist();
    return this.scope;
  }

  addTarget(host: string): void {
    if (!this.scope) this.scope = emptyScope(this.cwd);
    if (!this.scope.allowedHosts.includes(host)) this.scope.allowedHosts.push(host);
    this.persist();
  }

  denyTarget(host: string): void {
    if (!this.scope) return;
    if (!this.scope.disallowedHosts.includes(host)) this.scope.disallowedHosts.push(host);
    this.persist();
  }

  allowPort(port: number): void {
    if (!this.scope) return;
    if (!this.scope.allowedPorts.includes(port)) this.scope.allowedPorts.push(port);
    this.persist();
  }

  setIntensity(intensity: Intensity): void {
    if (!this.scope) return;
    this.scope.intensity = intensity;
    this.persist();
  }

  approve(note?: string): void {
    if (!this.scope) return;
    this.scope.approved = true;
    this.scope.approvalNote = note ?? "approved by operator";
    this.persist();
  }

  clear(): void {
    this.scope = null;
    try {
      if (fs.existsSync(this.file)) fs.rmSync(this.file);
    } catch {
      /* ignore */
    }
  }

  inScope(host: string): boolean {
    if (isLocalHost(host)) return true;
    const s = this.scope;
    if (!s) return false;
    if (s.disallowedHosts.includes(host)) return false;
    return s.allowedHosts.includes(host) || s.target === host;
  }
}
