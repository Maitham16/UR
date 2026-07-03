import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface UrCommandConfig {
  executablePath?: string
  executableArgs?: string[]
}

export type UrCommandSource = 'configured' | 'workspace-dist' | 'workspace-launcher' | 'path'

export interface ResolvedUrCommand {
  command: string
  args: string[]
  source: UrCommandSource
  display: string
}

export interface ResolveUrCommandOptions {
  cwd: string
  config?: UrCommandConfig
  pathExists?: (path: string) => boolean
  bunAvailable?: (command: string) => boolean
  bunCommand?: string
  nodeCommand?: string
}

export function resolveUrCommand(options: ResolveUrCommandOptions): ResolvedUrCommand {
  const config = options.config ?? {}
  const configuredPath = config.executablePath?.trim()
  const configuredArgs = normalizeExecutableArgs(config.executableArgs)
  if (configuredPath) {
    return command(configuredPath, configuredArgs, 'configured')
  }

  const pathExists = options.pathExists ?? existsSync
  const bunCommand = options.bunCommand ?? 'bun'
  const nodeCommand = options.nodeCommand ?? 'node'
  const distEntrypoint = join(options.cwd, 'dist', 'cli.js')
  if (pathExists(distEntrypoint) && (options.bunAvailable ?? isBunAvailable)(bunCommand)) {
    return command(bunCommand, [distEntrypoint], 'workspace-dist')
  }

  const launcherEntrypoint = join(options.cwd, 'bin', 'ur.js')
  if (pathExists(launcherEntrypoint)) {
    return command(nodeCommand, [launcherEntrypoint], 'workspace-launcher')
  }

  return command('ur', [], 'path')
}

export function formatResolvedUrCommand(resolved: Pick<ResolvedUrCommand, 'command' | 'args'>): string {
  return [resolved.command, ...resolved.args].join(' ')
}

function command(commandName: string, args: string[], source: UrCommandSource): ResolvedUrCommand {
  const resolved = { command: commandName, args, source, display: '' }
  return { ...resolved, display: formatResolvedUrCommand(resolved) }
}

function normalizeExecutableArgs(args: string[] | undefined): string[] {
  return Array.isArray(args) ? args.filter(arg => typeof arg === 'string' && arg.length > 0) : []
}

function isBunAvailable(commandName: string): boolean {
  const result = spawnSync(commandName, ['--version'], { stdio: 'ignore' })
  return !result.error && result.status === 0
}
