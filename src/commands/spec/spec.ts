import type { LocalCommandCall } from '../../types/command.js'
import {
  approvePhase,
  createSpec,
  deleteSpec,
  formatSpecList,
  formatSpecStatus,
  generatePhase,
  listSpecs,
  loadSpec,
  parseTasks,
  readPhase,
  runSpec,
  type SpecPhase,
} from '../../services/agents/spec.js'
import { createAgentKernel } from '../../services/agents/kernel.js'
import { runSpecVerification } from '../../services/agents/specVerifier.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'

const PHASES: readonly SpecPhase[] = ['requirements', 'design', 'tasks']
const VALUE_FLAGS = new Set(['--goal', '--max-turns'])

function usage(): string {
  return [
    'Usage:',
    '  ur spec list [--json]',
    '  ur spec init <name> --goal "..." [--json]',
    '  ur spec show <name> [requirements|design|tasks] [--json]',
    '  ur spec status <name> [--json]',
    '  ur spec approve <name> [requirements|design|tasks] [--json]',
    '  ur spec generate <name> [requirements|design|tasks] [--dry-run] [--max-turns N] [--json]',
    '  ur spec next <name> [--json]',
    '  ur spec run <name> [--all] [--dry-run] [--max-turns N] [--skip-permissions] [--kernel] [--json]',
    '  ur spec verify <name> [--dry-run] [--max-turns N] [--skip-permissions] [--kernel] [--json]',
    '  ur spec delete <name> [--json]',
  ].join('\n')
}

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const values: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (VALUE_FLAGS.has(token)) {
      i++
      continue
    }
    if (token.startsWith('--')) continue
    values.push(token)
  }
  return values
}

function asPhase(value: string | undefined): SpecPhase | undefined {
  return PHASES.includes(value as SpecPhase) ? (value as SpecPhase) : undefined
}

function notFound(name: string): string {
  return `Spec not found: ${name}`
}

export const call: LocalCommandCall = async (args: string) => {
  const cwd = getCwd()
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const positional = positionals(tokens)
  const action = positional[0] ?? 'list'
  const name = positional[1]

  if (action === 'list') {
    return { type: 'text', value: formatSpecList(listSpecs(cwd), json) }
  }

  if (action === 'init' || action === 'create') {
    const goal = option(tokens, '--goal')
    if (!name || !goal) return { type: 'text', value: usage() }
    const meta = createSpec(cwd, name, goal)
    return {
      type: 'text',
      value: json
        ? JSON.stringify(meta, null, 2)
        : `Created spec ${meta.name} in .ur/specs/${meta.name}.`,
    }
  }

  if (!name) return { type: 'text', value: usage() }

  if (action === 'show') {
    const phase = asPhase(positional[2]) ?? 'requirements'
    const body = readPhase(cwd, name, phase)
    if (body === null) return { type: 'text', value: `Spec phase not found: ${name}/${phase}` }
    return {
      type: 'text',
      value: json ? JSON.stringify({ name, phase, body }, null, 2) : body,
    }
  }

  if (action === 'status') {
    const meta = loadSpec(cwd, name)
    if (!meta) return { type: 'text', value: notFound(name) }
    return { type: 'text', value: formatSpecStatus(cwd, meta, json) }
  }

  if (action === 'approve') {
    const meta = loadSpec(cwd, name)
    if (!meta) return { type: 'text', value: notFound(name) }
    const phase = asPhase(positional[2]) ?? meta.phase
    const approved = approvePhase(cwd, name, phase)
    if (!approved) return { type: 'text', value: notFound(name) }
    return {
      type: 'text',
      value: json
        ? JSON.stringify(approved, null, 2)
        : `Approved ${phase} for ${approved.name}. Current phase: ${approved.phase}.`,
    }
  }

  if (action === 'generate') {
    const meta = loadSpec(cwd, name)
    if (!meta) return { type: 'text', value: notFound(name) }
    const phase = asPhase(positional[2]) ?? meta.phase
    const maxTurnsRaw = option(tokens, '--max-turns')
    const body = await generatePhase(cwd, name, phase, {
      dryRun: tokens.includes('--dry-run'),
      maxTurns: maxTurnsRaw ? Number(maxTurnsRaw) : undefined,
    })
    return {
      type: 'text',
      value: json ? JSON.stringify({ name: meta.name, phase, body }, null, 2) : body,
    }
  }

  if (action === 'next') {
    const meta = loadSpec(cwd, name)
    if (!meta) return { type: 'text', value: notFound(name) }
    const next = parseTasks(readPhase(cwd, name, 'tasks') ?? '').find(task => !task.done)
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ name: meta.name, next: next ?? null }, null, 2)
        : next
          ? `${next.id}: ${next.title}`
          : `No open tasks for ${meta.name}.`,
    }
  }

  if (action === 'run') {
    const maxTurnsRaw = option(tokens, '--max-turns')
    const events: string[] = []
    const useKernel = tokens.includes('--kernel')
    try {
      const result = await runSpec(cwd, name, {
        cwd,
        all: tokens.includes('--all'),
        dryRun: tokens.includes('--dry-run'),
        skipPermissions: tokens.includes('--skip-permissions'),
        maxTurns: maxTurnsRaw ? Number(maxTurnsRaw) : undefined,
        kernel: useKernel
          ? createAgentKernel({ cwd, dryRun: tokens.includes('--dry-run'), maxTurns: maxTurnsRaw ? Number(maxTurnsRaw) : undefined, skipPermissions: tokens.includes('--skip-permissions') })
          : undefined,
        onEvent: event => {
          events.push(`  ${event.id}: ${event.isError ? 'error' : (event.verdict ?? 'no verdict')}`)
        },
      })
      if (json) return { type: 'text', value: JSON.stringify(result, null, 2) }
      const ran = result.ran.length
        ? result.ran.map(task => `  ${task.id}: ${task.status} - ${task.title}`).join('\n')
        : '  No open tasks.'
      const trace = events.length ? `\n\nAgent verdicts:\n${events.join('\n')}` : ''
      return {
        type: 'text',
        value: `Spec ${result.name}: ${result.remaining} task(s) remaining.${result.stoppedOnFailure ? ' Stopped on failure.' : ''}\n\nRan:\n${ran}${trace}`,
      }
    } catch (error) {
      return { type: 'text', value: error instanceof Error ? error.message : String(error) }
    }
  }

  if (action === 'verify') {
    const meta = loadSpec(cwd, name)
    if (!meta) return { type: 'text', value: notFound(name) }
    const maxTurnsRaw = option(tokens, '--max-turns')
    const useKernel = tokens.includes('--kernel')
    try {
      const result = await runSpecVerification(cwd, name, {
        dryRun: tokens.includes('--dry-run'),
        skipPermissions: tokens.includes('--skip-permissions'),
        maxTurns: maxTurnsRaw ? Number(maxTurnsRaw) : undefined,
        kernel: useKernel
          ? createAgentKernel({ cwd, dryRun: tokens.includes('--dry-run'), maxTurns: maxTurnsRaw ? Number(maxTurnsRaw) : undefined, skipPermissions: tokens.includes('--skip-permissions') })
          : undefined,
      })
      if (json) return { type: 'text', value: JSON.stringify(result, null, 2) }
      const gateLines = result.gateResults.length
        ? result.gateResults.map(g => `  ${g.ok ? '✓' : '✗'} ${g.command}`).join('\n')
        : '  (no project gates configured)'
      return {
        type: 'text',
        value: [
          `Spec ${name}: verification ${result.verdict}`,
          `Summary: ${result.summary}`,
          `Command failures: ${result.commandFailures}`,
          '',
          'Gates:',
          gateLines,
          '',
          'Report: .ur/specs/verification.md',
        ].join('\n'),
      }
    } catch (error) {
      return { type: 'text', value: error instanceof Error ? error.message : String(error) }
    }
  }

  if (action === 'delete' || action === 'remove') {
    const deleted = deleteSpec(cwd, name)
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ name, deleted }, null, 2)
        : deleted
          ? `Deleted spec ${name}.`
          : notFound(name),
    }
  }

  return { type: 'text', value: usage() }
}
