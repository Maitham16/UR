import { spawnExec, type ExecFn } from "./exec.ts";
import { evaluate } from "./containment.ts";
import { toolPolicy } from "./policy.ts";
import type { Scope } from "./types.ts";

export interface RunResult {
  ran: boolean;
  blocked?: string;
  alternative?: string;
  code?: number | null;
  output?: string;
}

export interface RunOptions {
  scope: Scope | null;
  target?: string;
  exec?: ExecFn;
  timeoutMs?: number;
}

/**
 * The only path that executes an active security tool. Every invocation is
 * gated by the Security Containment Firewall (scope + authorization +
 * destructive/intensity checks); blocked runs return a reason and a safe
 * alternative and never execute.
 */
export async function runSecurityTool(tool: string, args: string[], opts: RunOptions): Promise<RunResult> {
  const policy = toolPolicy(tool);
  const verdict = evaluate(
    {
      tool,
      toolClass: policy?.classification,
      destructive: policy?.classification === "destructive",
      target: opts.target,
    },
    opts.scope,
  );
  if (!verdict.allow) {
    return { ran: false, blocked: verdict.reason, alternative: verdict.alternative };
  }
  const exec = opts.exec ?? spawnExec;
  const r = await exec(tool, args, { timeoutMs: opts.timeoutMs ?? 120_000, cwd: process.cwd() });
  const output = (r.stdout + (r.stderr ? `\n${r.stderr}` : "")).slice(0, 20_000);
  return { ran: true, code: r.code, output };
}
