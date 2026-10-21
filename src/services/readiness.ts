import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { doctorActiveProvider, getProviderRuntimeInfo, type ProviderDoctorAdapters } from './providers/providerRegistry.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import type { SettingsJson } from '../utils/settings/types.js'
import { strictGitSubprocessEnv } from '../utils/subprocessEnv.js'
import { getSandboxReadiness } from './safety/safetyReadiness.js'
import { listGoals } from './agents/goals.js'
import { listSpecs } from './agents/spec.js'
import { loadVerificationRecord } from './agents/specVerifier.js'
import { readBackgroundTasks } from './agents/backgroundRunner.js'
import { captureVerificationState } from './verifier/executionEvidence.js'

const exec = promisify(execFile)
const MAX_ITEMS = 8
const display = (value: string) => value.replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu,
  character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`).slice(0, 240)

async function changedFiles(cwd: string): Promise<{ available: boolean; summary: string[]; truncated: boolean }> {
  try {
    const { stdout } = await exec('git', ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
      'status', '--porcelain=v1', '--untracked-files=normal'], {
      cwd, env: strictGitSubprocessEnv(), timeout: 5_000, maxBuffer: 512 * 1024,
    })
    const lines = stdout.split('\n').filter(Boolean)
    return { available: true, summary: lines.slice(0, 40).map(display), truncated: lines.length > 40 }
  } catch { return { available: false, summary: [], truncated: false } }
}

/** Read-only diagnostics: no model generation, MCP spawning, reconciliation or configuration writes. */
export async function collectReadiness(cwd: string, options: {
  settings?: SettingsJson; providerAdapters?: ProviderDoctorAdapters
} = {}) {
  const settings = options.settings ?? getInitialSettings()
  const runtime = getProviderRuntimeInfo(settings)
  const model = runtime.model
  const provider = await doctorActiveProvider({ settings, adapters: options.providerAdapters })
  const sandbox = getSandboxReadiness()
  const changes = await changedFiles(cwd)
  const warnings: string[] = []
  let verification: Array<{ name: string; verdict: string; freshness: string; commandFailures: number }> = []
  try {
    verification = (await Promise.all(listSpecs(cwd).slice(0, MAX_ITEMS).map(async spec => {
      const result = await loadVerificationRecord(cwd, spec.name, { migrateLegacy: false })
      return { name: display(spec.name), verdict: result?.verdict ?? 'NOT_RUN',
        freshness: result?.freshness ?? 'unverifiable', commandFailures: result?.commandFailures ?? 0 }
    })))
  } catch { warnings.push('Some verification records could not be read; no current PASS is inferred.') }
  let goals: Array<{ name: string; status: string; controller: string; outcome: string; freshness: string; costUsd: number | null; unknownCostCalls: number; calls: number | null; resume: string; pause: string }> = []
  try {
    const saved = listGoals(cwd).slice(0, MAX_ITEMS)
    let current: string | undefined
    if (saved.some(goal => goal.outcome?.status === 'verified')) {
      try { current = (await captureVerificationState(cwd)).sha256 } catch { /* No current verification is inferred. */ }
    }
    goals = saved.map(goal => ({
      name: display(goal.name), status: display(goal.status), controller: display(goal.controller?.state ?? 'legacy'),
      outcome: display(goal.outcome?.status ?? 'unverified'),
      freshness: goal.outcome?.status !== 'verified' ? 'not-verified' : !current || !goal.outcome.stateSha256
        ? 'unverifiable' : current === goal.outcome.stateSha256 ? 'current' : 'stale',
      costUsd: typeof goal.controller?.usage.costUsd === 'number' && Number.isFinite(goal.controller.usage.costUsd) ? goal.controller.usage.costUsd : null,
      unknownCostCalls: goal.controller?.usage.unknownCostCalls ?? 0,
      calls: goal.controller?.usage.calls ?? null,
      resume: /^[A-Za-z0-9_-]{1,80}$/u.test(goal.name) ? `ur goal resume ${JSON.stringify(goal.name)}` : 'ur goal list',
      pause: /^[A-Za-z0-9_-]{1,80}$/u.test(goal.name) ? `ur goal pause ${JSON.stringify(goal.name)}` : 'ur goal list',
    }))
  } catch { warnings.push('Some goal records could not be read; inspect `ur goal list`.') }
  let background: Array<{ id: string; status: string; phase: string; sessionId: string | null; unknownEffects: number }> = []
  try {
    background = readBackgroundTasks(cwd).slice(0, MAX_ITEMS).map(task => ({
      id: display(task.id), status: display(task.status), phase: display(task.phase ?? 'unknown'),
      sessionId: task.session?.id ? display(task.session.id) : null, unknownEffects: task.recovery?.unknownEffects?.length ?? 0,
    }))
  } catch { warnings.push('Background state could not be read; inspect `ur bg list`.') }
  const ready = provider.ok && !!model && !(sandbox.required && sandbox.status !== 'available')
  return {
    version: 1, ready, scope: 'diagnostics-only' as const,
    provider: { id: provider.provider, name: provider.displayName, diagnosticsPassed: provider.ok,
      model: model ? display(model) : null, usesExternalCli: provider.usesExternalCli,
      checks: provider.checks.map(check => ({ name: check.name, status: check.status })),
      generationVerified: false,
      next: provider.ok && model ? 'Start UR and submit a task; diagnostics do not prove generation/tool compatibility.'
        : 'Open /model to choose a provider/model and add its key (K), or run the provider doctor below.',
      doctor: `ur provider doctor ${provider.provider}` },
    sandbox,
    workspace: { initialized: existsSync(join(cwd, '.ur')), changes, verification, goals, background },
    workflow: {
      firstTask: 'ur -p "Inspect this project and explain how to run its tests. Do not modify files." --max-turns 3',
      diff: 'git diff --no-ext-diff --no-textconv; git diff --cached --no-ext-diff --no-textconv',
      verify: 'ur spec verify <name>',
      cost: '/cost (unknown provider usage is not zero; subscription billing may not be reported)',
      cancel: 'Ctrl+C interrupts foreground work; ur bg cancel <id> cancels a background task.',
      recovery: 'ur --resume <session-id>; ur bg resume <id>; ur goal resume <name>',
    },
    warnings,
    limits: ['Provider diagnostics can check endpoints or official CLI login; no paid generation or model tool execution was requested.',
      'Review excludes transcripts, raw command output and credentials. Source-current proof is separate from task or goal completion.',
      'Background rows are persisted snapshots, not a live process-liveness assertion; inspection does not reconcile or reclaim them.',
      `At most ${MAX_ITEMS} goals and specifications are shown. Filesystem state can change after this snapshot.`],
  }
}

export type ReadinessReport = Awaited<ReturnType<typeof collectReadiness>>

export function formatReadiness(report: ReadinessReport, json = false): string {
  if (json) return JSON.stringify(report, null, 2)
  return [
    `UR readiness: ${report.ready ? 'diagnostics passed' : 'needs attention'} (generation not tested)`,
    `Provider: ${display(report.provider.name)} · model: ${report.provider.model ?? 'not selected'}`,
    `  ${report.provider.next}`, `  ${report.provider.doctor}`,
    `Sandbox: ${report.sandbox.status}${report.sandbox.required ? ' (required)' : ''}; ${report.sandbox.attestation}`,
    ...(report.sandbox.reason ? [`  ${report.sandbox.reason}`] : []),
    `Review: ${report.workspace.changes.available ? `${report.workspace.changes.summary.length}${report.workspace.changes.truncated ? '+' : ''} changed entries` : 'Git state unavailable'}`,
    ...report.workspace.changes.summary.map(line => `  ${line}`),
    ...report.workspace.verification.map(item => `  ${item.name}: ${item.verdict} (${item.freshness}); ${item.commandFailures} command failures`),
    ...report.workspace.goals.map(goal => `  goal ${goal.name}: ${goal.controller}/${goal.outcome} (${goal.freshness}); calls ${goal.calls ?? 'unknown'}; reported cost ${goal.costUsd === null ? 'unknown' : `$${goal.costUsd.toFixed(4)}`}${goal.unknownCostCalls ? ` + ${goal.unknownCostCalls} unknown-cost calls` : ''}`),
    ...report.workspace.background.map(task => `  saved background ${task.id}: ${task.status}/${task.phase}${task.unknownEffects ? `; ${task.unknownEffects} unknown effects need reconciliation` : ''}`),
    'Next:', ...Object.entries(report.workflow).map(([key, value]) => `  ${key}: ${value}`),
    ...report.warnings.map(warning => `Warning: ${warning}`), ...report.limits,
  ].join('\n')
}
