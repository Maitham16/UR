import { spawn } from "node:child_process";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type ExecFn = (
  bin: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number },
) => Promise<ExecResult>;

const MAX = 400_000;

/** Default executor: spawn a binary and capture output. code 127 = not found. */
export const spawnExec: ExecFn = (bin, args, opts = {}) =>
  new Promise<ExecResult>((resolve) => {
    const child = spawn(bin, args, { cwd: opts.cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < MAX) stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < MAX) stderr += d.toString();
    });
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : undefined;
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      // ENOENT (binary missing) and friends surface here.
      resolve({ code: 127, stdout: "", stderr: e.message });
    });
  });
