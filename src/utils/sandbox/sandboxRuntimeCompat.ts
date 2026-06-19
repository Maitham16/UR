import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { getPlatform } from '../platform.js'
import {
  buildBwrapArgv,
  buildSeatbeltProfile,
  posixQuote,
} from './sandboxProfile.js'

const MACOS_SANDBOX_EXEC = '/usr/bin/sandbox-exec'

/** Find an executable on PATH, returning its absolute path or null. */
function findOnPath(binary: string): string | null {
  const pathEnv = process.env.PATH ?? ''
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, binary)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

let cachedBwrapPath: string | null | undefined
function bwrapPath(): string | null {
  if (cachedBwrapPath === undefined) {
    cachedBwrapPath =
      ['/usr/bin/bwrap', '/usr/local/bin/bwrap', '/bin/bwrap'].find(p =>
        existsSync(p),
      ) ??
      findOnPath('bwrap') ??
      null
  }
  return cachedBwrapPath
}

/** Whether to also block network egress (off by default to limit breakage). */
function networkBlocked(): boolean {
  const value = (process.env.UR_SANDBOX_BLOCK_NETWORK ?? '').toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

export type FsReadRestrictionConfig = any
export type FsWriteRestrictionConfig = any
export type IgnoreViolationsConfig = any
export type NetworkHostPattern = any
export type NetworkRestrictionConfig = any
export type SandboxAskCallback = any
export type SandboxDependencyCheck = any
export type SandboxRuntimeConfig = any
export type SandboxViolationEvent = any

export class SandboxViolationStore {
  getViolations(): never[] {
    return []
  }

  getTotalCount(): number {
    return 0
  }

  subscribe(_listener: (violations: never[]) => void): () => void {
    return () => {}
  }

  clear(): void {}
}

export class SandboxManager {
  static isSupportedPlatform(): boolean {
    const platform = getPlatform()
    if (platform === 'macos') {
      return existsSync(MACOS_SANDBOX_EXEC)
    }
    if (platform === 'linux' || platform === 'wsl') {
      return bwrapPath() !== null
    }
    return false
  }

  static checkDependencies(
    _options?: { command?: string; args?: string[] },
  ): SandboxDependencyCheck {
    const platform = getPlatform()
    if (platform === 'macos') {
      return existsSync(MACOS_SANDBOX_EXEC)
        ? { errors: [], warnings: [] }
        : { errors: ['sandbox-exec not found at /usr/bin/sandbox-exec'], warnings: [] }
    }
    if (platform === 'linux' || platform === 'wsl') {
      return bwrapPath() !== null
        ? { errors: [], warnings: [] }
        : {
            errors: [
              'bubblewrap (bwrap) not found — install it (e.g. `apt install bubblewrap`)',
            ],
            warnings: [],
          }
    }
    return {
      errors: [`sandboxing is not supported on ${platform}`],
      warnings: [],
    }
  }

  /**
   * Wrap a shell command so it runs under the OS sandbox: macOS sandbox-exec
   * with a generated Seatbelt profile, or Linux bubblewrap. Writes are confined
   * to the workspace + temp dirs; network is blocked when UR_SANDBOX_BLOCK_NETWORK
   * is set. Returns the command unchanged on unsupported platforms (fail open —
   * the caller decides whether unsandboxed execution is allowed).
   */
  static wrapWithSandbox(
    command: string,
    binShell?: string,
    _customConfig?: unknown,
    _abortSignal?: unknown,
  ): string {
    const root = process.cwd()
    const denyNetwork = networkBlocked()
    const shell = binShell || '/bin/bash'
    const platform = getPlatform()

    if (platform === 'macos' && existsSync(MACOS_SANDBOX_EXEC)) {
      const profile = buildSeatbeltProfile(root, { denyNetwork })
      return `${MACOS_SANDBOX_EXEC} -p ${posixQuote(profile)} ${shell} -c ${posixQuote(command)}`
    }

    if (platform === 'linux' || platform === 'wsl') {
      const bwrap = bwrapPath()
      if (bwrap) {
        const argv = buildBwrapArgv(root, { denyNetwork })
          .map(posixQuote)
          .join(' ')
        return `${posixQuote(bwrap)} ${argv} ${shell} -c ${posixQuote(command)}`
      }
    }

    return command
  }

  static async initialize(_config?: unknown, _callback?: unknown): Promise<void> {}

  static updateConfig(_config?: unknown): void {}

  static async reset(): Promise<void> {}

  static getFsReadConfig(): undefined {
    return undefined
  }

  static getFsWriteConfig(): undefined {
    return undefined
  }

  static getNetworkRestrictionConfig(): undefined {
    return undefined
  }

  static getIgnoreViolations(): never[] {
    return []
  }

  static getAllowUnixSockets(): boolean {
    return false
  }

  static getAllowLocalBinding(): boolean {
    return false
  }

  static getEnableWeakerNestedSandbox(): boolean {
    return false
  }

  static getProxyPort(): undefined {
    return undefined
  }

  static getSocksProxyPort(): undefined {
    return undefined
  }

  static getLinuxHttpSocketPath(): undefined {
    return undefined
  }

  static getLinuxSocksSocketPath(): undefined {
    return undefined
  }

  static waitForNetworkInitialization(): Promise<void> {
    return Promise.resolve()
  }

  static getSandboxViolationStore(): SandboxViolationStore {
    return new SandboxViolationStore()
  }

  static annotateStderrWithSandboxFailures(
    _command: string,
    stderr: string,
  ): string {
    return stderr
  }

  static cleanupAfterCommand(): void {}
}

export const SandboxRuntimeConfigSchema = {}
