import { isInBundledMode } from './bundledMode.js'
import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { getUserBinDir } from './xdg.js'

export type UrExecutable = { file: string; baseArgs: string[] }

type ExecutableContext = {
  native?: boolean
  execPath?: string
  entrypoint?: string
  preferStable?: boolean
}

/** Resolve the running UR CLI without treating a native binary as a JS runtime. */
export function resolveUrExecutable(context: ExecutableContext = {}): UrExecutable {
  let file = context.execPath ?? process.execPath
  const entrypoint = context.entrypoint ?? process.argv[1]
  const native = context.native ?? isInBundledMode()
  if (native && context.preferStable && process.platform !== 'win32') {
    const stable = join(getUserBinDir(), 'ur')
    try {
      // Use only our own installation's symlink, never an unrelated UR on PATH.
      if (existsSync(stable) && realpathSync(stable) === realpathSync(file)) {
        file = stable
      }
    } catch {
      // Portable binaries may have no managed installation.
    }
  }
  return { file, baseArgs: native || !entrypoint ? [] : [entrypoint] }
}
