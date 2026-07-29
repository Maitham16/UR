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

function invalidMaxTurns(raw: string | undefined): boolean {
  if (raw === undefined) return false
  const value = Number(raw)
  return !Number.isSafeInteger(value) || value < 1
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
    if (!name || !goal) {
      return { type: 'text', value: usage(), exitCode: 2 }
    }
    const meta = createSpec(cwd, name, goal)
    return {
      type: 'text',
      value: json
        ? JSON.stringify(meta, null, 2)
        : `Created spec ${meta.name} in .ur/specs/${meta.name}.`,
    }
  }

  if (!name) return { type: 'text', value: usage(), exitCode: 2 }

  if (action === 'show') {
    const requestedPhase = positional[2]
    const phase = asPhase(requestedPhase) ?? 'requirements'
    if (requestedPhase && !asPhase(requestedPhase)) {
      return {
        type: 'text',
        value: `Unknown spec phase: ${requestedPhase}`,
        exitCode: 2,
      }
    }
    const body = readPhase(cwd, name, phase)
    if (body === null) {
      return {
        type: 'text',
        value: `Spec phase not found: ${name}/${phase}`,
        exitCode: 1,
      }
    }
    return {
      type: 'text',
      value: json ? JSON.stringify({ name, phase, body }, null, 2) : body,
    }
  }

  if (action === 'status') {
    const meta = loadSpec(cwd, name)
    if (!meta) {
      return { type: 'text', value: notFound(name), exitCode: 1 }
    }
    return { type: 'text', value: formatSpecStatus(cwd, meta, json) }
  }

  if (action === 'approve') {
    const meta = loadSpec(cwd, name)
    if (!meta) {
      return { type: 'text', value: notFound(name), exitCode: 1 }
    }
    const requestedPhase = positional[2]
    const phase = asPhase(requestedPhase) ?? meta.phase
    if (requestedPhase && !asPhase(requestedPhase)) {
      return {
        type: 'text',
        value: `Unknown spec phase: ${requestedPhase}`,
        exitCode: 2,
      }
    }
    const approved = approvePhase(cwd, name, phase)
    if (!approved) {
      return { type: 'text', value: notFound(name), exitCode: 1 }
    }
    return {
      type: 'text',
      value: json
        ? JSON.stringify(approved, null, 2)
        : `Approved ${phase} for ${approved.name}. Current phase: ${approved.phase}.`,
    }
  }

  if (action === 'generate') {
    const meta = loadSpec(cwd, name)
    if (!meta) {
      return { type: 'text', value: notFound(name), exitCode: 1 }
    }
    const requestedPhase = positional[2]
    const phase = asPhase(requestedPhase) ?? meta.phase
    if (requestedPhase && !asPhase(requestedPhase)) {
      return {
        type: 'text',
        value: `Unknown spec phase: ${requestedPhase}`,
        exitCode: 2,
      }
    }
    const maxTurnsRaw = option(tokens, '--max-turns')
    if (invalidMaxTurns(maxTurnsRaw)) {
      return {
        type: 'text',
        value: '--max-turns must be a positive integer.',
        exitCode: 2,
      }
    }
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
    if (!meta) {
      return { type: 'text', value: notFound(name), exitCode: 1 }
    }
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
    if (!loadSpec(cwd, name)) {
      return { type: 'text', value: notFound(name), exitCode: 1 }
    }
    const maxTurnsRaw = option(tokens, '--max-turns')
    if (invalidMaxTurns(maxTurnsRaw)) {
      return {
        type: 'text',
        value: '--max-turns must be a positive integer.',
        exitCode: 2,
      }
    }
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
      if (json) {
        return {
          type: 'text',
          value: JSON.stringify(result, null, 2),
          ...(result.stoppedOnFailure ? { exitCode: 1 } : {}),
        }
      }
      const ran = result.ran.length
        ? result.ran.map(task => `  ${task.id}: ${task.status} - ${task.title}`).join('\n')
        : '  No open tasks.'
      const trace = events.length ? `\n\nAgent verdicts:\n${events.join('\n')}` : ''
      return {
        type: 'text',
        value: `Spec ${result.name}: ${result.remaining} task(s) remaining.${result.stoppedOnFailure ? ' Stopped on failure.' : ''}\n\nRan:\n${ran}${trace}`,
        ...(result.stoppedOnFailure ? { exitCode: 1 } : {}),
      }
    } catch (error) {
      return {
        type: 'text',
        value: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      }
    }
  }

  if (action === 'verify') {
    const meta = loadSpec(cwd, name)
    if (!meta) {
      return { type: 'text', value: notFound(name), exitCode: 1 }
    }
    const maxTurnsRaw = option(tokens, '--max-turns')
    if (invalidMaxTurns(maxTurnsRaw)) {
      return {
        type: 'text',
        value: '--max-turns must be a positive integer.',
        exitCode: 2,
      }
    }
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
      if (json) {
        return {
          type: 'text',
          value: JSON.stringify(result, null, 2),
          ...(result.verdict === 'PASS' ? {} : { exitCode: 1 }),
        }
      }
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
        ...(result.verdict === 'PASS' ? {} : { exitCode: 1 }),
      }
    } catch (error) {
      return {
        type: 'text',
        value: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      }
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
      ...(deleted ? {} : { exitCode: 1 }),
    }
  }

  return { type: 'text', value: usage(), exitCode: 2 }
}
