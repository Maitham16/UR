import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Resolve a workspace-owned path and reject any existing symbolic-link
 * component below the workspace root. Lexical `startsWith` checks alone do
 * not stop `.ur` (or one of its children) from redirecting extension reads,
 * writes, or deletes outside the open workspace.
 *
 * The workspace root itself may be a symlink because opening a repository
 * through a symlink is a normal editor workflow. Everything created below it
 * must remain a real directory/file hierarchy.
 */
export function safeWorkspacePath(
  workspaceRoot: string,
  candidate: string,
  label = 'UR workspace data',
): string {
  const root = path.resolve(workspaceRoot)
  const target = path.resolve(candidate)
  const relative = path.relative(root, target)
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`${label} path escapes the workspace`)
  }

  let current = root
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error(`${label} path contains a symbolic link: ${current}`)
      }
    } catch (error) {
      if (isMissingPath(error)) continue
      throw error
    }
  }
  return target
}

/**
 * Replace a JSON file through a private same-directory temporary file. This
 * prevents a process interruption from leaving half a manifest/transcript and
 * avoids following an existing final-file symlink during the write.
 */
export function writeWorkspaceJsonAtomic(
  workspaceRoot: string,
  candidate: string,
  value: unknown,
  label = 'UR workspace data',
): void {
  const target = safeWorkspacePath(workspaceRoot, candidate, label)
  const directory = path.dirname(target)
  safeWorkspacePath(workspaceRoot, directory, label)
  fs.mkdirSync(directory, { recursive: true })
  safeWorkspacePath(workspaceRoot, directory, label)

  const temporary = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    fs.renameSync(temporary, target)
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true })
    } catch {
      // Preserve the original write/rename failure.
    }
    throw error
  }
}

function isMissingPath(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
