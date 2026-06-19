import { spawnExec, type ExecFn } from "./exec.ts";

export interface NetworkSnapshot {
  interfaces: string;
  listeningPorts: string;
  connections: string;
}

async function firstOf(exec: ExecFn, attempts: Array<[string, string[]]>): Promise<string> {
  for (const [bin, args] of attempts) {
    try {
      const r = await exec(bin, args, { timeoutMs: 8000 });
      if (r.code === 0 && r.stdout.trim()) return r.stdout.trim().slice(0, 8000);
    } catch {
      /* try next */
    }
  }
  return "(unavailable)";
}

/** Read-only local network state. No scanning of remote hosts. */
export async function networkSnapshot(exec: ExecFn = spawnExec): Promise<NetworkSnapshot> {
  return {
    interfaces: await firstOf(exec, [["ip", ["-o", "addr"]], ["ifconfig", []]]),
    listeningPorts: await firstOf(exec, [["ss", ["-tlnp"]], ["netstat", ["-tlnp"]], ["lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n"]]]),
    connections: await firstOf(exec, [["ss", ["-tan"]], ["netstat", ["-tan"]]]),
  };
}

/** Summarize a pcap offline if tshark is available (read-only). */
export async function summarizePcap(file: string, exec: ExecFn = spawnExec): Promise<string> {
  const r = await exec("tshark", ["-r", file, "-q", "-z", "io,phs"], { timeoutMs: 15_000 });
  if (r.code === 127) return "tshark not installed — cannot summarize pcap.";
  return (r.stdout || r.stderr || "(empty)").slice(0, 8000);
}
