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
  const root = path.resolve(opts.cwd);
  const target = path.resolve(root, opts.file);
  if (!(target === root || target.startsWith(root + path.sep))) return { applied: false, reason: "path escapes the workspace" };

  let before: string;
  try {
    before = await fsp.readFile(target, "utf8");
  } catch (e) {
    return { applied: false, reason: `cannot read file: ${(e as Error).message}` };
  }
  if (!before.includes(opts.find)) return { applied: false, reason: "target text not found (precondition failed)" };

  await fsp.writeFile(target, before.replace(opts.find, opts.replace), "utf8");

  if (opts.verify) {
    const passed = await opts.verify();
    if (!passed) {
      await fsp.writeFile(target, before, "utf8");
      return { applied: false, reverted: true, reason: "verification failed — change rolled back" };
    }
  }
  return { applied: true };
}
