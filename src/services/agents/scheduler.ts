/**
 * Resident automation scheduler.
 *
 * Automations are cron-defined specs, but on their own they only fire when
 * something invokes `ur automation run-due`. This module makes that periodic
 * invocation real in three ways, in order of preference per platform:
 *
 *  - macOS  → a launchd LaunchAgent plist (per-user, survives logout/login)
 *  - Linux  → a systemd --user service + timer
 *  - any    → a crontab line (printed for the user to install)
 *
 * It also offers an in-process `runDaemon` loop for `ur automation daemon`, which
 * is handy in containers/CI where a foreground process is preferred. The file
 * builders are pure and exported so they can be unit-tested without touching the
 * host. Mirrors the "scheduled / recurring agent" model (Routines) but local.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runDueAutomations } from '../../commands/automation/automation.js'

export type SchedulerPlatform = 'launchd' | 'systemd' | 'cron'

export type SchedulerConfig = {
  /** Absolute project directory the scheduler should run `run-due` in. */
  cwd: string
  /** Seconds between run-due checks. Default 60. */
  intervalSec?: number
  /** Command that launches UR. Defaults to this process's CLI. */
  bin?: { file: string; args: string[] }
}

export function defaultBin(): { file: string; args: string[] } {
  return { file: process.execPath, args: [process.argv[1] ?? ''] }
}

/** Stable per-project label so multiple projects don't collide. */
export function schedulerLabel(cwd: string): string {
  const hash = createHash('sha1').update(cwd).digest('hex').slice(0, 8)
  return `com.ur.automation.${hash}`
}

export function detectPlatform(): SchedulerPlatform {
  if (process.platform === 'darwin') return 'launchd'
  if (process.platform === 'linux') return 'systemd'
  return 'cron'
}

function runDueArgs(config: SchedulerConfig): string[] {
  const bin = config.bin ?? defaultBin()
  return [bin.file, ...bin.args.filter(Boolean), 'automation', 'run-due']
}

function launchAgentsDir(): string {
  return join(homedir(), 'Library', 'LaunchAgents')
}

export function launchdPlistPath(cwd: string): string {
  return join(launchAgentsDir(), `${schedulerLabel(cwd)}.plist`)
}

export function buildLaunchdPlist(config: SchedulerConfig): string {
  const label = schedulerLabel(config.cwd)
  const interval = config.intervalSec ?? 60
  const args = runDueArgs(config)
  const programArgs = args.map(arg => `    <string>${escapeXml(arg)}</string>`).join('\n')
  const logPath = join(config.cwd, '.ur', 'automations', 'scheduler.log')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(config.cwd)}</string>
  <key>StartInterval</key>
  <integer>${interval}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function systemdUnitDir(): string {
  return join(homedir(), '.config', 'systemd', 'user')
}

export function systemdServiceName(cwd: string): string {
  return `${schedulerLabel(cwd)}.service`
}

export function systemdTimerName(cwd: string): string {
  return `${schedulerLabel(cwd)}.timer`
}

export function buildSystemdService(config: SchedulerConfig): string {
  const args = runDueArgs(config).map(arg => quoteArg(arg)).join(' ')
  return `[Unit]
Description=UR automation run-due (${config.cwd})

[Service]
Type=oneshot
WorkingDirectory=${config.cwd}
ExecStart=${args}
`
}

export function buildSystemdTimer(config: SchedulerConfig): string {
  const interval = config.intervalSec ?? 60
  return `[Unit]
Description=UR automation scheduler timer (${config.cwd})

[Timer]
OnBootSec=${interval}
OnUnitActiveSec=${interval}
AccuracySec=15s
Persistent=true

[Install]
WantedBy=timers.target
`
}

export function buildCronLine(config: SchedulerConfig): string {
  // Cron's finest granularity is one minute; the scheduler is a per-minute poll.
  const args = runDueArgs(config).map(arg => quoteArg(arg)).join(' ')
  return `* * * * * cd ${quoteArg(config.cwd)} && ${args} >> ${quoteArg(join(config.cwd, '.ur', 'automations', 'scheduler.log'))} 2>&1`
}

function quoteArg(value: string): string {
  return /[\s"'$]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value
}

export type InstallResult = {
  platform: SchedulerPlatform
  installed: boolean
  path?: string
  instructions: string[]
}

export function installScheduler(
  config: SchedulerConfig,
  platform: SchedulerPlatform = detectPlatform(),
): InstallResult {
  // Ensure the log directory exists regardless of platform.
  mkdirSync(join(config.cwd, '.ur', 'automations'), { recursive: true })

  if (platform === 'launchd') {
    const path = launchdPlistPath(config.cwd)
    mkdirSync(launchAgentsDir(), { recursive: true })
    writeFileSync(path, buildLaunchdPlist(config))
    return {
      platform,
      installed: true,
      path,
      instructions: [
        `Wrote LaunchAgent: ${path}`,
        `Load it now:  launchctl load ${path}`,
        `Stop it:      ur automation uninstall  (or: launchctl unload ${path})`,
      ],
    }
  }

  if (platform === 'systemd') {
    const dir = systemdUnitDir()
    mkdirSync(dir, { recursive: true })
    const servicePath = join(dir, systemdServiceName(config.cwd))
    const timerPath = join(dir, systemdTimerName(config.cwd))
    writeFileSync(servicePath, buildSystemdService(config))
    writeFileSync(timerPath, buildSystemdTimer(config))
    return {
      platform,
      installed: true,
      path: timerPath,
      instructions: [
        `Wrote service: ${servicePath}`,
        `Wrote timer:   ${timerPath}`,
        `Enable it:     systemctl --user daemon-reload && systemctl --user enable --now ${systemdTimerName(config.cwd)}`,
        `Stop it:       ur automation uninstall`,
      ],
    }
  }

  return {
    platform: 'cron',
    installed: false,
    instructions: [
      'Add this line to your crontab (run `crontab -e`):',
      '',
      buildCronLine(config),
    ],
  }
}

export function uninstallScheduler(
  cwd: string,
  platform: SchedulerPlatform = detectPlatform(),
): InstallResult {
  if (platform === 'launchd') {
    const path = launchdPlistPath(cwd)
    const existed = existsSync(path)
    if (existed) unlinkSync(path)
    return {
      platform,
      installed: false,
      path: existed ? path : undefined,
      instructions: existed
        ? [`Removed ${path}.`, `If it was loaded: launchctl unload ${path}`]
        : ['No launchd scheduler was installed for this project.'],
    }
  }
  if (platform === 'systemd') {
    const dir = systemdUnitDir()
    const servicePath = join(dir, systemdServiceName(cwd))
    const timerPath = join(dir, systemdTimerName(cwd))
    const removed: string[] = []
    for (const p of [servicePath, timerPath]) {
      if (existsSync(p)) {
        unlinkSync(p)
        removed.push(p)
      }
    }
    return {
      platform,
      installed: false,
      instructions: removed.length
        ? [`Removed: ${removed.join(', ')}`, `Reload: systemctl --user daemon-reload`]
        : ['No systemd scheduler was installed for this project.'],
    }
  }
  return {
    platform: 'cron',
    installed: false,
    instructions: ['Remove the `ur automation run-due` line from your crontab (`crontab -e`).'],
  }
}

export function schedulerStatus(cwd: string): { platform: SchedulerPlatform; installed: boolean; path?: string } {
  const platform = detectPlatform()
  if (platform === 'launchd') {
    const path = launchdPlistPath(cwd)
    return { platform, installed: existsSync(path), path: existsSync(path) ? path : undefined }
  }
  if (platform === 'systemd') {
    const path = join(systemdUnitDir(), systemdTimerName(cwd))
    return { platform, installed: existsSync(path), path: existsSync(path) ? path : undefined }
  }
  return { platform, installed: false }
}

export function formatInstallResult(result: InstallResult): string {
  return [`Scheduler platform: ${result.platform}`, '', ...result.instructions].join('\n')
}

export type DaemonOptions = {
  cwd: string
  intervalSec?: number
  /** Run a single tick and return (used by tests / one-shot mode). */
  once?: boolean
  /** Stop after this many ticks (mostly for tests). */
  maxTicks?: number
  dryRun?: boolean
  onTick?: (info: { tick: number; ran: number; at: string }) => void
  /** Injectable sleep so tests don't actually wait. */
  sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * In-process scheduler loop. Polls due automations every `intervalSec` and runs
 * them. Returns the number of ticks executed (bounded only in once/maxTicks
 * mode; otherwise runs until the process is signalled).
 */
export async function runDaemon(options: DaemonOptions): Promise<number> {
  const intervalSec = Math.max(1, options.intervalSec ?? 60)
  const sleep = options.sleep ?? realSleep
  let tick = 0
  let stopped = false
  const stop = () => {
    stopped = true
  }
  if (!options.once && options.maxTicks === undefined) {
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  }

  while (!stopped) {
    tick += 1
    const results = await runDueAutomations({ dryRun: options.dryRun })
    options.onTick?.({ tick, ran: results.length, at: new Date().toISOString() })
    if (options.once) break
    if (options.maxTicks !== undefined && tick >= options.maxTicks) break
    await sleep(intervalSec * 1000)
  }
  return tick
}
