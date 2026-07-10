import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import {
  createCloudTask,
  formatCloudTasks,
  getCloudTask,
  listCloudTasks,
  loadCloudResult,
  runCloudWorker,
  spawnCloudWorker,
} from '../../services/agents/cloudTasks.js'
import { getCwd } from '../../utils/cwd.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'

function flagValue(tokens: string[], flag: string): string | undefined {
  const i = tokens.indexOf(flag)
  return i === -1 ? undefined : tokens[i + 1]
}

export const call: LocalCommandCall = async (args: string): Promise<LocalCommandResult> => {
  const cwd = getCwd()
  const tokens = (args ?? '').trim().split(/\s+/).filter(Boolean)
  const action = tokens[0]
  const json = tokens.includes('--json')

  if (action === 'run') {
    // Task text = everything between `run` and the first flag; quotes optional.
    const flagIdx = tokens.findIndex((t, i) => i > 0 && t.startsWith('--'))
    const taskText = tokens
      .slice(1, flagIdx === -1 ? tokens.length : flagIdx)
      .join(' ')
      .replace(/^"|"$/g, '')
    if (!taskText) {
      return { type: 'text', value: 'Usage: ur cloud run "<task>" [--attempts N] [--model m] [--max-turns n]' }
    }
    const task = createCloudTask(cwd, {
      task: taskText,
      attempts: Number(flagValue(tokens, '--attempts') ?? 3),
      model: flagValue(tokens, '--model'),
      maxTurns: flagValue(tokens, '--max-turns')
        ? Number(flagValue(tokens, '--max-turns'))
        : undefined,
    })
    const pid = spawnCloudWorker(cwd, task.id)
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ ...task, workerPid: pid }, null, 2)
        : `Cloud task ${task.id} started (best-of-${task.attempts}, pid ${pid ?? '?'}).\nBrowse: ur cloud list · Result: ur cloud show ${task.id} · Apply winner: ur cloud apply ${task.id}`,
    }
  }

  if (action === 'list' || action === undefined) {
    return { type: 'text', value: formatCloudTasks(listCloudTasks(cwd), json) }
  }

  if (action === 'show') {
    const id = tokens[1]
    const task = id ? getCloudTask(cwd, id) : null
    if (!task) return { type: 'text', value: `Cloud task not found: ${id ?? '(missing id)'}` }
    const result = loadCloudResult(cwd, id!)
    if (json) return { type: 'text', value: JSON.stringify({ task, result }, null, 2) }
    const lines = [
      `${task.id} — ${task.status} (best-of-${task.attempts})`,
      `Task: ${task.task}`,
    ]
    if (result?.candidates) {
      lines.push('', 'Candidates:')
      for (const c of result.candidates) {
        lines.push(
          `  ${c.id}${result.winner?.id === c.id ? ' ★winner' : ''}  verdict=${c.verdict ?? '?'}  diff=${c.diff?.trim() ? `${c.diff.split('\n').length} lines` : 'empty'}`,
        )
      }
      if (result.winner?.diff?.trim()) {
        lines.push('', `Apply the winner: ur cloud apply ${task.id}`)
      }
    } else if (task.status === 'running') {
      lines.push('', `Still running — log: .ur/cloud/${task.id}.log`)
    }
    return { type: 'text', value: lines.join('\n') }
  }

  if (action === 'apply') {
    const id = tokens[1]
    const result = id ? loadCloudResult(cwd, id) : null
    const diff = result?.winner?.diff
    if (!diff?.trim()) {
      return { type: 'text', value: `No winning diff to apply for ${id ?? '(missing id)'} — run ur cloud show ${id ?? '<id>'}` }
    }
    const patchDir = join(cwd, '.ur', 'cloud')
    mkdirSync(patchDir, { recursive: true })
    const patch = join(patchDir, `${id}-winner.patch`)
    writeFileSync(patch, diff)
    const applied = await execFileNoThrowWithCwd('git', ['apply', '--3way', patch], {
      cwd,
      timeout: 60_000,
      preserveOutputOnError: true,
    })
    rmSync(patch, { force: true })
    return {
      type: 'text',
      value:
        applied.code === 0
          ? `Applied winning diff from ${id} to the working tree. Review with git diff.`
          : `git apply failed (${applied.code}): ${applied.stderr || applied.stdout}`.slice(0, 1500),
    }
  }

  if (action === 'worker') {
    const id = tokens[1]
    if (!id) return { type: 'text', value: 'Usage: ur cloud worker <id> (internal)' }
    await runCloudWorker(cwd, id)
    const task = getCloudTask(cwd, id)
    return { type: 'text', value: `worker finished: ${id} → ${task?.status}` }
  }

  return {
    type: 'text',
    value: 'Usage: ur cloud run "<task>" [--attempts N] | list | show <id> | apply <id>',
  }
}
