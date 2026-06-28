import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { cronToHuman, parseCronExpression } from '../../utils/cron.js'
import { nextCronRunMs } from '../../utils/cronTasks.js'
import { getCwd } from '../../utils/cwd.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { safeParseJSON } from '../../utils/json.js'

type AutomationSpec = {
  version: 1
  name: string
  schedule: string
  prompt: string
  runner: {
    command: string
    args: string[]
  }
  createdAt: string
  enabled?: boolean
  lastRunAt?: string
  lastExitCode?: number
  lastStatus?: 'success' | 'failed' | 'dry-run'
  lastOutputPreview?: string
  nextRunAt?: string | null
}

type AutomationView = AutomationSpec & {
  due: boolean
  humanSchedule: string
  nextRunAt: string | null
}

type RunResult = {
  name: string
  dryRun: boolean
  command: string[]
  due: boolean
  skipped?: string
  exitCode?: number
  stdout?: string
  stderr?: string
}

function automationsDir(): string {
  return join(getCwd(), '.ur', 'automations')
}

function automationPath(name: string): string {
  return join(automationsDir(), `${sanitizeName(name)}.json`)
}

function sanitizeName(name: string): string {
  return name.trim().replace(/[^a-zA-Z0-9_-]/g, '-')
}

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  if (index === -1) return undefined
  return tokens[index + 1]
}

function positionals(tokens: string[]): string[] {
  const values: string[] = []
  const flagsWithValue = new Set(['--schedule', '--prompt', '--now'])

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (flagsWithValue.has(token)) {
      i++
      continue
    }
    if (token.startsWith('--')) {
      continue
    }
    values.push(token)
  }

  return values
}

function hasFlag(tokens: string[], name: string): boolean {
  return tokens.includes(name)
}

function listSpecs(): AutomationSpec[] {
  const dir = automationsDir()
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => {
      const parsed = safeParseJSON(
        readFileSync(join(dir, file), 'utf-8'),
        false,
      )
      return parsed && typeof parsed === 'object'
        ? (parsed as AutomationSpec)
        : null
    })
    .filter((spec): spec is AutomationSpec => spec !== null)
}

function writeSpec(spec: AutomationSpec): void {
  mkdirSync(automationsDir(), { recursive: true })
  writeFileSync(
    automationPath(spec.name),
    `${JSON.stringify(spec, null, 2)}\n`,
  )
}

function toMs(value: string | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function nextRunIso(spec: AutomationSpec, nowMs = Date.now()): string | null {
  const anchor = toMs(spec.lastRunAt) ?? toMs(spec.createdAt) ?? nowMs
  const next = nextCronRunMs(spec.schedule, anchor)
  return next === null ? null : new Date(next).toISOString()
}

function isDue(spec: AutomationSpec, nowMs: number): boolean {
  if (spec.enabled === false) return false
  const anchor = toMs(spec.lastRunAt) ?? toMs(spec.createdAt) ?? nowMs
  const next = nextCronRunMs(spec.schedule, anchor)
  return next !== null && next <= nowMs
}

function withRuntimeFields(
  spec: AutomationSpec,
  nowMs = Date.now(),
): AutomationView {
  return {
    ...spec,
    enabled: spec.enabled !== false,
    due: isDue(spec, nowMs),
    humanSchedule: cronToHuman(spec.schedule),
    nextRunAt: nextRunIso(spec, nowMs),
  }
}

function formatSpecs(specs: AutomationSpec[]): string {
  if (specs.length === 0) {
    return 'No project automations found. Create one with `ur automation create nightly --schedule "0 9 * * 1-5" --prompt "Review open tasks"`.'
  }

  const lines = ['Project automations', '']
  for (const spec of specs) {
    const view = withRuntimeFields(spec)
    lines.push(`${view.name}${view.enabled === false ? ' (disabled)' : ''}`)
    lines.push(`  Schedule: ${view.humanSchedule} (${view.schedule})`)
    lines.push(`  Next run: ${view.nextRunAt ?? 'none in next year'}`)
    lines.push(`  Due now: ${view.due ? 'yes' : 'no'}`)
    if (view.lastRunAt) {
      lines.push(
        `  Last run: ${view.lastRunAt} (${view.lastStatus ?? 'unknown'}, exit ${view.lastExitCode ?? 'unknown'})`,
      )
    }
    lines.push(`  Prompt: ${spec.prompt}`)
    lines.push(`  Runner: ${spec.runner.command} ${spec.runner.args.join(' ')}`)
    lines.push('')
  }
  return lines.join('\n')
}

function formatRunResults(results: RunResult[]): string {
  if (results.length === 0) return 'No automations ran.'
  return results
    .map(result => {
      const lines = [
        `${result.name}: ${
          result.skipped
            ? `skipped (${result.skipped})`
            : result.dryRun
              ? 'dry run'
              : `exit ${result.exitCode ?? 'unknown'}`
        }`,
        `  Command: ${result.command.join(' ')}`,
      ]
      if (result.stdout) lines.push(`  Stdout: ${result.stdout}`)
      if (result.stderr) lines.push(`  Stderr: ${result.stderr}`)
      return lines.join('\n')
    })
    .join('\n\n')
}

function preview(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > 1200 ? `${trimmed.slice(0, 1200)}...` : trimmed
}

async function runSpec(
  spec: AutomationSpec,
  options: { dryRun: boolean; dueOnly: boolean; nowMs: number },
): Promise<RunResult> {
  const due = isDue(spec, options.nowMs)
  const command = [spec.runner.command, ...spec.runner.args, spec.prompt]
  if (spec.enabled === false) {
    return { name: spec.name, dryRun: options.dryRun, command, due, skipped: 'disabled' }
  }
  if (options.dueOnly && !due) {
    return { name: spec.name, dryRun: options.dryRun, command, due, skipped: 'not due' }
  }
  if (options.dryRun) {
    return { name: spec.name, dryRun: true, command, due }
  }

  const result = await execFileNoThrowWithCwd(spec.runner.command, [
    ...spec.runner.args,
    spec.prompt,
  ], {
    cwd: getCwd(),
    timeout: 30 * 60 * 1000,
    preserveOutputOnError: true,
  })
  const updated: AutomationSpec = {
    ...spec,
    lastRunAt: new Date(options.nowMs).toISOString(),
    lastExitCode: result.code,
    lastStatus: result.code === 0 ? 'success' : 'failed',
    lastOutputPreview: preview(result.stdout) ?? preview(result.stderr),
  }
  updated.nextRunAt = nextRunIso(updated, options.nowMs)
  writeSpec(updated)

  return {
    name: spec.name,
    dryRun: false,
    command,
    due,
    exitCode: result.code,
    stdout: preview(result.stdout),
    stderr: preview(result.stderr),
  }
}

function usage(): string {
  return [
    'Usage:',
    '  ur automation list [--json]',
    '  ur automation create <name> --schedule "0 9 * * 1-5" --prompt "Review open tasks" [--disabled]',
    '  ur automation show <name> [--json]',
    '  ur automation run <name> [--dry-run]',
    '  ur automation run-due [--dry-run] [--now ISO_DATE]',
    '  ur automation enable <name>',
    '  ur automation disable <name>',
    '  ur automation delete <name>',
  ].join('\n')
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const positional = positionals(tokens)
  const command = positional[0] ?? 'list'

  if (command === 'list') {
    const specs = listSpecs()
    const views = specs.map(spec => withRuntimeFields(spec))
    return {
      type: 'text',
      value: json ? JSON.stringify({ automations: views }, null, 2) : formatSpecs(specs),
    }
  }

  if (command === 'create') {
    const name = positional[1]
    const schedule = option(tokens, '--schedule')
    const prompt = option(tokens, '--prompt')
    if (!name || !schedule || !prompt) {
      return { type: 'text', value: usage() }
    }
    if (!parseCronExpression(schedule) || nextCronRunMs(schedule, Date.now()) === null) {
      return {
        type: 'text',
        value: `Invalid automation schedule: ${schedule}\nExpected a 5-field cron expression with a next run in the next year.`,
      }
    }

    const spec: AutomationSpec = {
      version: 1,
      name: sanitizeName(name),
      schedule,
      prompt,
      runner: {
        command: 'ur',
        args: ['-p', '--output-format', 'json'],
      },
      createdAt: new Date().toISOString(),
      enabled: !hasFlag(tokens, '--disabled'),
    }
    spec.nextRunAt = nextRunIso(spec)
    writeSpec(spec)
    return {
      type: 'text',
      value: json
        ? JSON.stringify(withRuntimeFields(spec), null, 2)
        : `Created automation ${spec.name} at ${automationPath(name)}`,
    }
  }

  if (command === 'show') {
    const name = positional[1]
    if (!name) return { type: 'text', value: usage() }
    const path = automationPath(name)
    if (!existsSync(path)) {
      return { type: 'text', value: `Automation not found: ${sanitizeName(name)}` }
    }
    const raw = readFileSync(path, 'utf-8')
    const parsed = safeParseJSON(raw, false) as AutomationSpec | null
    if (json) {
      return {
        type: 'text',
        value: JSON.stringify(parsed ? withRuntimeFields(parsed) : raw, null, 2),
      }
    }
    return { type: 'text', value: parsed ? formatSpecs([parsed]) : raw }
  }

  if (command === 'enable' || command === 'disable') {
    const name = positional[1]
    if (!name) return { type: 'text', value: usage() }
    const path = automationPath(name)
    if (!existsSync(path)) {
      return { type: 'text', value: `Automation not found: ${sanitizeName(name)}` }
    }
    const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false) as AutomationSpec | null
    if (!parsed) return { type: 'text', value: `Automation file is invalid: ${path}` }
    const updated = { ...parsed, enabled: command === 'enable' }
    updated.nextRunAt = nextRunIso(updated)
    writeSpec(updated)
    return {
      type: 'text',
      value: `${command === 'enable' ? 'Enabled' : 'Disabled'} automation ${updated.name}`,
    }
  }

  if (command === 'run' || command === 'run-due') {
    const nowMs = toMs(option(tokens, '--now')) ?? Date.now()
    const dryRun = hasFlag(tokens, '--dry-run')
    const dueOnly = command === 'run-due'
    const specs =
      command === 'run'
        ? listSpecs().filter(spec => spec.name === sanitizeName(positional[1] ?? ''))
        : listSpecs()
    if (command === 'run' && specs.length === 0) {
      return { type: 'text', value: `Automation not found: ${sanitizeName(positional[1] ?? '')}` }
    }
    const results = await Promise.all(
      specs.map(spec => runSpec(spec, { dryRun, dueOnly, nowMs })),
    )
    const runnable = results.filter(result => !result.skipped)
    const output = dueOnly ? runnable : results
    return {
      type: 'text',
      value: json
        ? JSON.stringify({ results: output }, null, 2)
        : formatRunResults(output),
    }
  }

  if (command === 'delete' || command === 'remove') {
    const name = positional[1]
    if (!name) return { type: 'text', value: usage() }
    const path = automationPath(name)
    if (!existsSync(path)) {
      return { type: 'text', value: `Automation not found: ${sanitizeName(name)}` }
    }
    unlinkSync(path)
    return { type: 'text', value: `Deleted automation ${sanitizeName(name)}` }
  }

  return { type: 'text', value: usage() }
}
