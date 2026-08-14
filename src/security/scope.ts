import * as fs from "node:fs";
import { join } from "node:path";
import { getSessionId } from "../bootstrap/state.ts";
import type { Intensity, Scope, TargetType } from "./types.ts";

const LAB_TYPES: TargetType[] = ["lab-vm", "owned-server", "owned-network", "ctf-lab", "third-party-authorized"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.trim().toLowerCase());
}

export function isLabOrOwned(t: TargetType): boolean {
  return LAB_TYPES.includes(t);
}

function ipv4Value(host: string): number | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return octets.reduce((value, octet) => value * 256 + octet, 0) >>> 0;
}

function matchesScopeEntry(host: string, entry: string): boolean {
  const wanted = host.trim().toLowerCase().replace(/\.$/, '');
  let scoped = entry.trim().toLowerCase().replace(/\.$/, '');
  try {
    if (/^https?:\/\//.test(scoped)) scoped = new URL(scoped).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (scoped.startsWith('*.')) return wanted.endsWith(scoped.slice(1)) && wanted !== scoped.slice(2);
  const cidr = scoped.match(/^((?:\d{1,3}\.){3}\d{1,3})\/(\d{1,2})$/);
  if (cidr?.[1] && cidr[2]) {
    const network = ipv4Value(cidr[1]);
    const address = ipv4Value(wanted);
    const prefix = Number(cidr[2]);
    if (network === null || address === null || prefix < 0 || prefix > 32) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (network & mask) === (address & mask);
  }
  return wanted === scoped;
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
    evidencePath: join(cwd, ".ur", "security", "evidence"),
    approved: false,
    createdAt: new Date().toISOString(),
  };
}

/** Persistent engagement scope + authorization. Active tests require this. */
export class ScopeStore {
  private readonly file: string;
  private readonly legacyFile: string;
  private readonly cwd: string;
  private scope: Scope | null = null;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.file = join(cwd, ".ur", "security", "scope.json");
    this.legacyFile = join(cwd, ".309", "security", "scope.json");
    this.load();
  }

  private load(): void {
    try {
      const source = fs.existsSync(this.file)
        ? this.file
        : fs.existsSync(this.legacyFile)
          ? this.legacyFile
          : null;
      if (source) {
        this.scope = JSON.parse(fs.readFileSync(source, "utf8")) as Scope;
        if (source === this.legacyFile) this.persist();
      }
    } catch {
      this.scope = null;
    }
  }

  private persist(): void {
    if (!this.scope) return;
    fs.mkdirSync(join(this.cwd, ".ur", "security"), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.scope, null, 2));
  }

  get(): Scope | null {
    if (!this.scope) return null;
    return {
      ...this.scope,
      approved:
        this.scope.approved &&
        this.scope.approvalSessionId === String(getSessionId()),
    };
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

  allowTool(tool: string): void {
    if (!this.scope) return;
    const normalized = tool.trim().toLowerCase();
    if (normalized && !this.scope.allowedTools.includes(normalized)) this.scope.allowedTools.push(normalized);
    this.persist();
  }

  setRateLimit(rateLimitPerMin: number): void {
    if (!this.scope) return;
    this.scope.rateLimitPerMin = rateLimitPerMin;
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
    this.scope.approvalSessionId = String(getSessionId());
    this.persist();
  }

  clear(): void {
    this.scope = null;
    try {
      if (fs.existsSync(this.file)) fs.rmSync(this.file);
      if (fs.existsSync(this.legacyFile)) fs.rmSync(this.legacyFile);
    } catch {
      /* ignore */
    }
  }

  inScope(host: string): boolean {
    if (isLocalHost(host)) return true;
    const s = this.scope;
    if (!s) return false;
    if (s.disallowedHosts.some(entry => matchesScopeEntry(host, entry))) return false;
    return s.allowedHosts.some(entry => matchesScopeEntry(host, entry)) || matchesScopeEntry(host, s.target);
  }
}
