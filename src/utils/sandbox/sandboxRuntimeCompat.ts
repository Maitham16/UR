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
    return false
  }

  static checkDependencies(): SandboxDependencyCheck {
    return { errors: [], warnings: [] }
  }

  static wrapWithSandbox(command: string): string {
    return command
  }

  static async initialize(): Promise<void> {}

  static updateConfig(): void {}

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
