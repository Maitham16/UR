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

export type FsReadRestrictionConfig = {
  allowOnly: string[]
  denyOnly: string[]
  allowWithinDeny: string[]
}
export type FsWriteRestrictionConfig = {
  allowOnly: string[]
  denyWithinAllow: string[]
}
export type IgnoreViolationsConfig = Record<string, string[]>
export type NetworkHostPattern = {
  host: string
  port?: number
  protocol?: string
}
export type NetworkRestrictionConfig = {
  allowedHosts: string[]
  deniedHosts: string[]
  blockAll: boolean
}
export type SandboxAskCallback = (
  hostPattern: NetworkHostPattern,
) => boolean | Promise<boolean>
export type SandboxDependencyCheck = {
  errors: string[]
  warnings: string[]
}
export type SandboxRuntimeConfig = {
  network?: {
    allowedDomains?: string[]
    deniedDomains?: string[]
    blockAll?: boolean
    allowUnixSockets?: string[]
    allowAllUnixSockets?: boolean
    allowLocalBinding?: boolean
    httpProxyPort?: number
    socksProxyPort?: number
  }
  filesystem?: {
    allowRead?: string[]
    denyRead?: string[]
    allowWrite?: string[]
    denyWrite?: string[]
  }
  ignoreViolations?: IgnoreViolationsConfig
  enableWeakerNestedSandbox?: boolean
  enableWeakerNetworkIsolation?: boolean
  ripgrep?: {
    command: string
    args?: string[]
    argv0?: string
  }
}
export type SandboxViolationEvent = {
  timestamp: Date
  command?: string
  line: string
  reason?: string
  policyDecision?: 'allow' | 'ask' | 'deny'
  sandboxMode?: 'disabled' | 'recommended' | 'required'
}

let currentConfig: SandboxRuntimeConfig = {}

function envNetworkBlocked(): boolean {
  const value = (process.env.UR_SANDBOX_BLOCK_NETWORK ?? '').toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

/** Whether to also block network egress. */
function networkBlocked(config?: Partial<SandboxRuntimeConfig>): boolean {
  const network = {
    ...currentConfig.network,
    ...config?.network,
  }
  return (
    envNetworkBlocked() ||
    network?.blockAll === true ||
    network?.deniedDomains?.includes('*') === true
  )
}

export class SandboxViolationStore {
  private violations: SandboxViolationEvent[] = []
  private listeners = new Set<(violations: SandboxViolationEvent[]) => void>()

  record(event: Omit<SandboxViolationEvent, 'timestamp'> & { timestamp?: Date }): void {
    const violation: SandboxViolationEvent = {
      ...event,
      timestamp: event.timestamp ?? new Date(),
    }
    this.violations.push(violation)
    this.notify()
  }

  getViolations(): SandboxViolationEvent[] {
    return [...this.violations]
  }

  getTotalCount(): number {
    return this.violations.length
  }

  subscribe(listener: (violations: SandboxViolationEvent[]) => void): () => void {
    this.listeners.add(listener)
    listener(this.getViolations())
    return () => {
      this.listeners.delete(listener)
    }
  }

  clear(): void {
    this.violations.length = 0
    this.notify()
  }

  private notify(): void {
    const snapshot = this.getViolations()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }
}

const sandboxViolationStore = new SandboxViolationStore()

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
    customConfig?: Partial<SandboxRuntimeConfig>,
    _abortSignal?: unknown,
  ): string {
    const root = process.cwd()
    const denyNetwork = networkBlocked(customConfig)
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

  static async initialize(
    config?: SandboxRuntimeConfig,
    _callback?: SandboxAskCallback,
  ): Promise<void> {
    if (config) currentConfig = config
  }

  static updateConfig(config?: SandboxRuntimeConfig): void {
    currentConfig = config ?? {}
  }

  static async reset(): Promise<void> {
    currentConfig = {}
    sandboxViolationStore.clear()
  }

  static getFsReadConfig(): FsReadRestrictionConfig {
    return {
      allowOnly: currentConfig.filesystem?.allowRead ?? [],
      denyOnly: currentConfig.filesystem?.denyRead ?? [],
      allowWithinDeny: [],
    }
  }

  static getFsWriteConfig(): FsWriteRestrictionConfig {
    return {
      allowOnly: currentConfig.filesystem?.allowWrite ?? [],
      denyWithinAllow: currentConfig.filesystem?.denyWrite ?? [],
    }
  }

  static getNetworkRestrictionConfig(): NetworkRestrictionConfig {
    return {
      allowedHosts: currentConfig.network?.allowedDomains ?? [],
      deniedHosts: currentConfig.network?.deniedDomains ?? [],
      blockAll: networkBlocked(),
    }
  }

  static getIgnoreViolations(): IgnoreViolationsConfig {
    return currentConfig.ignoreViolations ?? {}
  }

  static getAllowUnixSockets(): string[] | undefined {
    return currentConfig.network?.allowUnixSockets
  }

  static getAllowLocalBinding(): boolean | undefined {
    return currentConfig.network?.allowLocalBinding
  }

  static getEnableWeakerNestedSandbox(): boolean | undefined {
    return currentConfig.enableWeakerNestedSandbox
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
    return sandboxViolationStore
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
