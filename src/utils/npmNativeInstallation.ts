import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { getBuildVersion } from './buildVersion.js'

export type NpmNativeInstallation = {
  packageRoot: string
  launcherPath: string
  nodeExecutable: string
  nativeExecutable: string
}

type NpmNativeOptions = {
  env?: NodeJS.ProcessEnv
  execPath?: string
  version?: string
  platform?: string
}

/** Recognize only the native payload launched by this exact installed npm package. */
function validateNpmNativeInstallation(options: NpmNativeOptions = {}): NpmNativeInstallation | null {
  const env = options.env ?? process.env
  try {
    const keys = ['UR_NPM_PACKAGE_ROOT', 'UR_NPM_LAUNCHER_PATH', 'UR_NPM_NODE_EXECUTABLE', 'UR_NPM_NATIVE_EXECUTABLE'] as const
    if (keys.some(key => !env[key] || !isAbsolute(env[key]!) || /[\0\r\n]/.test(env[key]!))) return null
    const [packageRoot, launcherPath, nodeExecutable, nativeExecutable] = keys.map(key => realpathSync(env[key]!)) as [string, string, string, string]
    if (launcherPath !== realpathSync(join(packageRoot, 'bin/ur.js')) || nativeExecutable !== realpathSync(options.execPath ?? process.execPath)) return null
    if (![launcherPath, nodeExecutable, nativeExecutable].every(path => lstatSync(path).isFile())) return null
    const metadata = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
    const version = options.version ?? getBuildVersion()
    if (metadata.name !== 'ur-agent' || metadata.version !== version || metadata.urDistribution !== 'native' || metadata.bin?.ur !== 'bin/ur.js') return null
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'bin/native-release.json'), 'utf8'))
    const platform = options.platform ?? `${process.platform}-${process.arch}`
    if (manifest.schemaVersion !== 1 || manifest.version !== version || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || !manifest.platforms?.[platform]) return null
    const cacheRoot = env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME) ? env.XDG_CACHE_HOME : join(homedir(), '.cache')
    const expected = join(resolve(cacheRoot), 'ur/npm', `${version}-${platform}`, 'ur')
    if (realpathSync(expected) !== nativeExecutable) return null
    return { packageRoot, launcherPath, nodeExecutable, nativeExecutable }
  } catch {
    return null
  }
}

// Establish ownership before an npm upgrade replaces/removes the package files.
// That upgrade must not change the update channel of an already running agent.
const initialInstallation = validateNpmNativeInstallation()

export function getNpmNativeInstallation(options?: NpmNativeOptions): NpmNativeInstallation | null {
  if (options !== undefined) return validateNpmNativeInstallation(options)
  // Callers cannot mutate the process-wide validated identity through a result.
  return initialInstallation ? { ...initialInstallation } : null
}
