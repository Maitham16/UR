import * as fsp from "node:fs/promises";
import * as path from "node:path";

export interface FixResult {
  applied: boolean;
  reverted?: boolean;
  reason?: string;
}

export interface FixOptions {
  cwd: string;
  file: string;
  find: string;
  replace: string;
  /** Fixes never modify files without explicit approval. */
  approved: boolean;
  /** Optional verification (e.g. run tests); if it fails, the change is rolled back. */
  verify?: () => Promise<boolean>;
}

/**
 * Apply a security fix with a staged backup and verification: write the change,
 * run verification, and roll back automatically if verification fails.
 */
export async function applyFix(opts: FixOptions): Promise<FixResult> {
  if (!opts.approved) return { applied: false, reason: "approval required before modifying files" };
  const root = await fsp.realpath(opts.cwd);
  const requestedTarget = path.resolve(root, opts.file);
  if (!(requestedTarget === root || requestedTarget.startsWith(root + path.sep))) return { applied: false, reason: "path escapes the workspace" };

  let before: string;
  let target: string;
  let mode: number;
  try {
    target = await fsp.realpath(requestedTarget);
    if (!(target.startsWith(root + path.sep))) return { applied: false, reason: "path escapes the workspace through a symbolic link" };
    const stat = await fsp.stat(target);
    if (!stat.isFile()) return { applied: false, reason: "target is not a regular file" };
    mode = stat.mode;
    before = await fsp.readFile(target, "utf8");
  } catch (e) {
    return { applied: false, reason: `cannot read file: ${(e as Error).message}` };
  }
  if (!before.includes(opts.find)) return { applied: false, reason: "target text not found (precondition failed)" };

  const replacement = before.replace(opts.find, opts.replace);
  const writeAtomically = async (content: string): Promise<void> => {
    const temp = path.join(path.dirname(target), `.${path.basename(target)}.ur-fix-${process.pid}-${Date.now()}`);
    try {
      await fsp.writeFile(temp, content, { encoding: "utf8", flag: "wx", mode });
      await fsp.rename(temp, target);
    } finally {
      await fsp.rm(temp, { force: true });
    }
  };
  await writeAtomically(replacement);

  if (opts.verify) {
    try {
      const passed = await opts.verify();
      if (passed) return { applied: true };
    } catch (error) {
      await writeAtomically(before);
      return { applied: false, reverted: true, reason: `verification failed and change was rolled back: ${(error as Error).message}` };
    }
    await writeAtomically(before);
    return { applied: false, reverted: true, reason: "verification failed — change rolled back" };
  }
  return { applied: true };
}
