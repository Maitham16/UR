import { spawnExec, type ExecFn } from "./exec.ts";

export interface IRSnapshot {
  processes: string;
  connections: string;
  services: string;
  logins: string;
  persistence: string;
}

async function readOnly(exec: ExecFn, cmd: string): Promise<string> {
  try {
    const r = await exec("bash", ["-lc", cmd], { timeoutMs: 8000 });
    return (r.stdout || "").trim().slice(0, 6000) || "(none)";
  } catch {
    return "(unavailable)";
  }
}

/** Read-only incident-response collection. Never deletes or quarantines. */
export async function collect(exec: ExecFn = spawnExec): Promise<IRSnapshot> {
  return {
    processes: await readOnly(exec, "ps aux 2>/dev/null | head -40 || true"),
    connections: await readOnly(exec, "(ss -tanp 2>/dev/null || netstat -tanp 2>/dev/null) | head -40 || true"),
    services: await readOnly(exec, "systemctl list-units --type=service --state=running 2>/dev/null | head -40 || true"),
    logins: await readOnly(exec, "last -n 20 2>/dev/null || true"),
    persistence: await readOnly(exec, "ls -la /etc/cron.d ~/.config/systemd/user ~/Library/LaunchAgents 2>/dev/null || true"),
  };
}

export function buildTimeline(events: Array<{ ts: string; event: string }>): string {
  return events
    .slice()
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .map((e) => `${e.ts}  ${e.event}`)
    .join("\n");
}

export function containmentPlan(): string[] {
  return [
    "Isolate the affected host from the network (with approval).",
    "Preserve volatile evidence first: memory, network connections, process list.",
    "Rotate any exposed credentials and revoke active sessions.",
    "Hunt for persistence: cron, systemd units, launch agents, startup items.",
    "Identify and patch the entry vector.",
    "Reconstruct a timeline from logs and artifacts.",
    "Do not delete or quarantine artifacts without explicit approval.",
  ];
}
