import {
  buildExecutionPlan,
  compilePatternToWorkflow,
  formatExecutionPlan,
  formatPatternDetail,
  formatPatternList,
  getPattern,
  listPatterns,
  scaffoldPattern,
} from '../../services/agents/patterns.js'
import { formatExecResult } from '../../services/agents/executor.js'
import { saveAndRunWorkflow } from '../../services/agents/runWorkflow.js'
import { saveWorkflow } from '../../services/agents/workflows.js'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

function knownIds(): string {
  return listPatterns()
    .map(pattern => pattern.id)
    .join(', ')
}

function optionValue(tokens: string[], flag: string): string | undefined {
  const index = tokens.indexOf(flag)
  return index >= 0 ? tokens[index + 1] : undefined
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const force = tokens.includes('--force')
  const save = tokens.includes('--save')
  const positional = tokens.filter(token => !token.startsWith('--'))
  const command = positional[0] ?? 'list'

  if (command === 'list') {
    return { type: 'text', value: formatPatternList(json) }
  }

  const id = positional[1]
  if (!id) {
    return {
      type: 'text',
      value: `Usage: ur pattern ${command} <${knownIds()}>`,
    }
  }
  const pattern = getPattern(id)
  if (!pattern) {
    return {
      type: 'text',
      value: `Unknown pattern: ${id}\nKnown patterns: ${knownIds()}`,
    }
  }

  if (command === 'show') {
    return { type: 'text', value: formatPatternDetail(pattern, json) }
  }

  if (command === 'run') {
    const task = positional.slice(2).join(' ')
    const execute = tokens.includes('--execute') || tokens.includes('--live')

    if (execute) {
      const workflow = compilePatternToWorkflow(pattern, task.trim() || '{{task}}')
      workflow.name = `${pattern.id}-run`
      const dryRun = tokens.includes('--dry-run')
      const maxTurnsValue = Number(optionValue(tokens, '--max-turns') ?? '30')
      const parallelAgents = pattern.stages.filter(s => s.parallelizable).length
      const result = await saveAndRunWorkflow(workflow, {
        cwd: getCwd(),
        stateName: workflow.name,
        dryRun,
        resume: tokens.includes('--resume'),
        skipPermissions:
          tokens.includes('--skip-permissions') ||
          tokens.includes('--dangerously-skip-permissions'),
        maxTurns:
          Number.isFinite(maxTurnsValue) && maxTurnsValue > 0 ? maxTurnsValue : 30,
        maxConcurrency: parallelAgents > 1 ? parallelAgents : undefined,
        loop: pattern.loop
          ? {
              from: pattern.loop.from,
              to: pattern.loop.to,
              maxIterations: pattern.loop.maxIterations,
            }
          : null,
      })
      if (json) return { type: 'text', value: JSON.stringify(result, null, 2) }
      const header = dryRun ? '(dry run — no model calls)\n\n' : ''
      return { type: 'text', value: `${header}${formatExecResult(result)}` }
    }

    const plan = buildExecutionPlan(pattern, task)
    let savedNote = ''
    if (save) {
      const workflow = compilePatternToWorkflow(pattern, plan.task)
      workflow.name = `${pattern.id}-run`
      const result = saveWorkflow(getCwd(), workflow, { force: true })
      savedNote = `\n\nSaved workflow: ${result.path}`
    }
    if (json) {
      return { type: 'text', value: formatExecutionPlan(plan, true) }
    }
    return { type: 'text', value: `${formatExecutionPlan(plan, false)}${savedNote}` }
  }

  if (command === 'install') {
    const result = scaffoldPattern(getCwd(), pattern.id, { force })
    if (json) return { type: 'text', value: JSON.stringify(result, null, 2) }
    const lines = [`Installed pattern ${pattern.id} under ${result.root}`]
    if (result.created.length > 0) lines.push(`created: ${result.created.join(', ')}`)
    if (result.skipped.length > 0) lines.push(`kept existing: ${result.skipped.join(', ')}`)
    return { type: 'text', value: lines.join('\n') }
  }

  return {
    type: 'text',
    value: `Unknown pattern command: ${command}\n\n${formatPatternList(false)}`,
  }
}
