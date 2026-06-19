/**
 * Reproducible containerized execution target (opt-in, local-first).
 *
 * Cursor/Codex/Jules run agents on disposable cloud VMs; UR stays local but can
 * route command execution through a container so `ci-loop` (and, when the image
 * ships `ur`, `arena`/`escalate`) run in a clean, isolated, reproducible
 * environment instead of the host. Default is `local` — nothing changes unless a
 * target is configured via `.ur/devcontainer.json`, `.devcontainer/`, or the
 * UR_EXEC_TARGET / UR_EXEC_IMAGE env vars. The docker argv builder and resolver
 * are pure functions, so the wrapping logic unit-tests with no Docker.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeParseJSON } from '../../utils/json.js'

export type ExecTargetKind = 'local' | 'docker' | 'devcontainer'

export type ExecTargetConfig = {
  kind: ExecTargetKind
  image?: string
  /** Working directory inside the container. Default /workspace. */
  workdir?: string
  /** Allow network inside the container. Default false (isolated). */
  network?: boolean
  /** Names of host env vars to forward into the container. */
  env?: string[]
  /** Extra `-v host:container` mount specs. */
  mounts?: string[]
}

export type Command = { file: string; args: string[] }

export function isContainerized(config: ExecTargetConfig): boolean {
  return config.kind !== 'local'
}

/** Pure builder for `docker run …` argv. Exposed for tests. */
export function buildDockerArgs(
  config: ExecTargetConfig,
  command: Command,
  cwd: string,
): string[] {
  const workdir = config.workdir ?? '/workspace'
  const argv = ['run', '--rm', '-i']
  if (!config.network) argv.push('--network', 'none')
  argv.push('-v', `${cwd}:${workdir}`, '-w', workdir)
  for (const mount of config.mounts ?? []) argv.push('-v', mount)
  for (const name of config.env ?? []) argv.push('-e', name)
  argv.push(config.image ?? 'ubuntu:22.04')
  argv.push(command.file, ...command.args)
  return argv
}

/** Wrap a command for the configured target. `local` passes through unchanged. */
export function wrapCommand(
  config: ExecTargetConfig,
  command: Command,
  cwd: string,
): Command {
  if (!isContainerized(config)) return command
  return { file: 'docker', args: buildDockerArgs(config, command, cwd) }
}

function configPath(cwd: string): string {
  return join(cwd, '.ur', 'devcontainer.json')
}

function readDevcontainerImage(cwd: string): string | undefined {
  const path = join(cwd, '.devcontainer', 'devcontainer.json')
  if (!existsSync(path)) return undefined
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  if (parsed && typeof parsed === 'object' && typeof (parsed as { image?: unknown }).image === 'string') {
    return (parsed as { image: string }).image
  }
  return undefined
}

/**
 * Resolve the active target. Precedence: env vars > `.ur/devcontainer.json` >
 * `.devcontainer/devcontainer.json` > local.
 */
export function resolveExecTarget(
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): ExecTargetConfig {
  const envKind = (env.UR_EXEC_TARGET || '').trim().toLowerCase()
  if (envKind === 'docker' || envKind === 'devcontainer') {
    return {
      kind: envKind,
      image: env.UR_EXEC_IMAGE || readDevcontainerImage(cwd),
      network: env.UR_EXEC_NETWORK === '1' || env.UR_EXEC_NETWORK === 'true',
    }
  }
  if (envKind === 'local') return { kind: 'local' }

  const path = configPath(cwd)
  if (existsSync(path)) {
    const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
    if (parsed && typeof parsed === 'object') {
      const config = parsed as ExecTargetConfig
      if (config.kind === 'devcontainer' && !config.image) {
        config.image = readDevcontainerImage(cwd)
      }
      if (config.kind === 'local' || config.kind === 'docker' || config.kind === 'devcontainer') {
        return config
      }
    }
  }
  return { kind: 'local' }
}

export function loadExecTargetConfig(cwd: string): ExecTargetConfig | null {
  const path = configPath(cwd)
  if (!existsSync(path)) return null
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  return parsed && typeof parsed === 'object' ? (parsed as ExecTargetConfig) : null
}

export function defaultExecTargetConfig(image = 'node:22-bookworm'): ExecTargetConfig {
  return { kind: 'docker', image, workdir: '/workspace', network: false, env: [] }
}

export function scaffoldExecTarget(
  cwd: string,
  options: { force?: boolean; image?: string } = {},
): { path: string; created: boolean } {
  const path = configPath(cwd)
  mkdirSync(join(cwd, '.ur'), { recursive: true })
  if (existsSync(path) && options.force !== true) return { path, created: false }
  writeFileSync(path, `${JSON.stringify(defaultExecTargetConfig(options.image), null, 2)}\n`)
  return { path, created: true }
}

export function formatExecTarget(config: ExecTargetConfig): string {
  if (!isContainerized(config)) {
    return 'Execution target: local (host). Enable a container with `ur devcontainer init`.'
  }
  return [
    `Execution target: ${config.kind}`,
    `  image:   ${config.image ?? '(unset)'}`,
    `  workdir: ${config.workdir ?? '/workspace'}`,
    `  network: ${config.network ? 'on' : 'isolated (none)'}`,
    config.mounts?.length ? `  mounts:  ${config.mounts.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
