/**
 * Self-checking command discipline.
 *
 * Every shell command is logged as a structured record: command, exit code,
 * stdout, stderr, reason (why it was run / what the agent expected), and next
 * action (what the agent decided to do). Records are written as JSONL under
 * `.ur/runs/<run-id>/commands.jsonl` and can be replayed for audit, eval, and
 * failure memory.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { safeParseJSON } from '../../utils/json.js'
import { addRunArtifact, appendRunAction } from './runArtifacts.js'

export type CommandLogEntry = {
  at: string
  command: string
  exitCode: number
  stdout: string
  stderr: string
  reason: string
  nextAction: string
  durationMs?: number
  toolUseId?: string
}

export type CommandLogInput = Omit<CommandLogEntry, 'at' | 'reason' | 'nextAction'> & {
  reason?: string
  nextAction?: string
}

export function commandLogDir(cwd: string, runId: string): string {
  return join(cwd, '.ur', 'runs', runId)
}

export function commandLogPath(cwd: string, runId: string): string {
  return join(commandLogDir(cwd, runId), 'commands.jsonl')
}

export function appendCommandLog(
  cwd: string,
  runId: string,
  entry: CommandLogInput,
): CommandLogEntry {
  const full: CommandLogEntry = {
    ...entry,
    stdout: entry.stdout ?? '',
    stderr: entry.stderr ?? '',
    reason: entry.reason?.trim() || 'unspecified command reason',
    nextAction: entry.nextAction?.trim() || defaultNextAction(entry.exitCode),
    at: new Date().toISOString(),
  }
  const path = commandLogPath(cwd, runId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(full)}\n`, { flag: 'a' })
  addRunArtifact(cwd, runId, {
    kind: 'command-log',
    path: commandLogPath(cwd, runId),
    title: `commands.jsonl (${entry.command.slice(0, 60)})`,
  })
  appendRunAction(cwd, runId, {
    kind: 'command',
    title: entry.command.slice(0, 80),
    status: full.exitCode === 0 ? 'passed' : 'failed',
    command: full.command,
    exitCode: full.exitCode,
    stdout: full.stdout,
    stderr: full.stderr,
    reason: full.reason,
    nextAction: full.nextAction,
    data: {
      durationMs: full.durationMs,
      toolUseId: full.toolUseId,
    },
  })
  return full
}

export function readCommandLog(cwd: string, runId: string): CommandLogEntry[] {
  const path = commandLogPath(cwd, runId)
  try {
    const text = readFileSync(path, 'utf-8')
    return text
      .split('\n')
      .filter(Boolean)
      .map(line => safeParseJSON(line, false))
      .filter((item): item is CommandLogEntry => {
        if (!item || typeof item !== 'object') return false
        const obj = item as Record<string, unknown>
        return (
          typeof obj.command === 'string' && typeof obj.exitCode === 'number'
        )
      })
      .map(entry => ({
        ...entry,
        stdout: entry.stdout ?? '',
        stderr: entry.stderr ?? '',
        reason: entry.reason || 'unspecified command reason',
        nextAction: entry.nextAction || defaultNextAction(entry.exitCode),
      }))
  } catch {
    return []
  }
}

export function defaultNextAction(exitCode: number): string {
  return exitCode === 0
    ? 'continue; command completed successfully'
    : 'inspect failure output and decide whether to fix, retry, or rollback'
}
