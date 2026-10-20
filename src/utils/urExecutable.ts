import { isInBundledMode } from './bundledMode.js'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { getNativeInstallDirectories } from './nativeRelease.js'

export type UrExecutable = { file: string; baseArgs: string[] }

type ExecutableContext = {
  native?: boolean
  execPath?: string
  entrypoint?: string
  preferStable?: boolean
}

/** Accept only the owned v1 shim whose complete activation file targets this UR. */
export function getManagedWindowsNativeExecutable(execPath: string): string | null {
  try {
    const { binDir, dataDir } = getNativeInstallDirectories()
    const shim = join(binDir, 'ur.exe')
    const marker = join(binDir, '.ur-native-launcher-v1.sha256')
    const activation = join(binDir, 'ur.cmd')
    if (![shim, marker, activation].every(path => lstatSync(path).isFile())) return null
    const identity = readFileSync(marker, 'utf8').match(/^UR-Nexus native launcher v1\n([a-f0-9]{64})\n(?![\s\S])/)
    if (!identity || createHash('sha256').update(readFileSync(shim)).digest('hex') !== identity[1]) return null
    const text = readFileSync(activation, 'utf8')
    const targetMatch = text.match(/\r\n"([^"\r\n]+)" %\*\r\n$/)
    if (!targetMatch) return null
    const target = targetMatch[1]!.replace(/%%/g, '%')
    const versionRelative = relative(join(dataDir, 'versions'), target)
    const components = versionRelative.split(sep)
    if (isAbsolute(versionRelative) || components.length !== 2 || components[0] === '..' || components[1]!.toLowerCase() !== 'ur.exe') return null
    const escape = (value: string) => value.replace(/%/g, '%%')
    const expected = `@echo off\r\n@setlocal DisableDelayedExpansion\r\n@"%SystemRoot%\\System32\\chcp.com" 65001 >nul\r\n@set "UR_NATIVE_BIN_DIR=${escape(binDir)}"\r\n@set "UR_NATIVE_DATA_DIR=${escape(dataDir)}"\r\n"${escape(target)}" %*\r\n`
    if (text !== expected || realpathSync(target).toLowerCase() !== realpathSync(execPath).toLowerCase()) return null
    return shim
  } catch {
    return null
  }
}

/** Resolve the running UR CLI without treating a native binary as a JS runtime. */
export function resolveUrExecutable(context: ExecutableContext = {}): UrExecutable {
  let file = context.execPath ?? process.execPath
  const entrypoint = context.entrypoint ?? process.argv[1]
  const native = context.native ?? isInBundledMode()
  if (native && context.preferStable && process.platform === 'win32') {
    file = getManagedWindowsNativeExecutable(file) ?? file
  } else if (native && context.preferStable) {
    try {
      const stable = join(getNativeInstallDirectories().binDir, 'ur')
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
