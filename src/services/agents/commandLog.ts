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

export type CommandLogEntry = {
  at: string
  command: string
  exitCode: number
  stdout: string
  stderr: string
  reason?: string
  nextAction?: string
  durationMs?: number
  toolUseId?: string
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
  entry: Omit<CommandLogEntry, 'at'>,
): CommandLogEntry {
  const full: CommandLogEntry = { ...entry, at: new Date().toISOString() }
  const path = commandLogPath(cwd, runId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(full)}\n`, { flag: 'a' })
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
      .filter((item): item is CommandLogEntry =>
        Boolean(
          item &&
            typeof item === 'object' &&
            typeof item.command === 'string' &&
            typeof item.exitCode === 'number',
        ),
      )
  } catch {
    return []
  }
}
