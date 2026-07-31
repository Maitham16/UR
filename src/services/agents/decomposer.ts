/**
 * Automatic task decomposition with rich metadata.
 *
 * Breaks a large goal into atomic subtasks, each annotated with:
 *   - goal
 *   - files touched
 *   - risk level
 *   - tests required
 *   - rollback point (HEAD at decomposition time)
 *
 * The deterministic fallback reuses crew.goal decomposition so plain
 * `ur crew create --goal` stays fast and offline. The model path asks a
 * headless subagent to produce structured JSON when `--decompose` is used.
 */

import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { safeParseJSON } from '../../utils/json.js'
import {
  defaultHeadlessRunner,
  makeDryHeadlessRunner,
  type HeadlessRunner,
} from './headlessAgent.js'
import { decomposeGoal } from './crew.js'

export type RiskLevel = 'low' | 'medium' | 'high'

export type DecomposedTask = {
  id: string
  goal: string
  /** Task ids that must finish successfully before this task may start. */
  dependsOn?: string[]
  filesTouched: string[]
  risk: RiskLevel
  testsRequired: string[]
  rollbackPoint: string
}

export type DecompositionResult = {
  goal: string
  tasks: DecomposedTask[]
  rollbackPoint: string
  generatedAt: string
}

export type DecomposeOptions = {
  cwd: string
  runner?: HeadlessRunner
  dryRun?: boolean
}

const HIGH_RISK_KEYWORDS =
  /\b(auth|authoriz|credential|secret|token|password|encrypt|hash|ssl|tls|sandbox|shell|bash|rm\b|drop|delete|migrate|security|vulnerab|exploit|injection|race|deadlock|concurren|distributed)\b/i

const MEDIUM_RISK_KEYWORDS =
  /\b(refactor|rename|move|restructure|extract|interface|api|contract|dependency|config|schema)\b/i

const LOW_RISK_KEYWORDS =
  /\b(comment|doc|readme|changelog|typo|format|style|lint|naming|whitespace)\b/i

export function riskLevelFromKeywords(goal: string, files: string[] = []): RiskLevel {
  const text = `${goal} ${files.join(' ')}`.toLowerCase()
  if (HIGH_RISK_KEYWORDS.test(text)) return 'high'
  if (MEDIUM_RISK_KEYWORDS.test(text)) return 'medium'
  if (LOW_RISK_KEYWORDS.test(text)) return 'low'
  return 'medium'
}

async function currentRollbackPoint(cwd: string): Promise<string> {
  const result = await execFileNoThrowWithCwd(
    'git',
    ['rev-parse', 'HEAD'],
    { cwd, preserveOutputOnError: true },
  )
  if (result.code === 0 && result.stdout.trim()) return result.stdout.trim()
  return 'untracked'
}

function deterministicDecomposition(goal: string, rollbackPoint: string): DecomposedTask[] {
  const items = decomposeGoal(goal)
  return items.map((item, index) => ({
    id: `t${index + 1}`,
    goal: item,
    filesTouched: [],
    risk: riskLevelFromKeywords(item),
    testsRequired: inferTests(item),
    rollbackPoint,
  }))
}

function inferTests(goal: string): string[] {
  const lower = goal.toLowerCase()
  const tests: string[] = []
  if (/\b(test|spec|assert|coverage)\b/i.test(lower)) tests.push('unit test')
  if (/\b(integration|e2e|end-to-end|api)\b/i.test(lower)) tests.push('integration test')
  if (/\b(build|compile|typecheck|tsc)\b/i.test(lower)) tests.push('compile/typecheck')
  if (/\b(lint|format|style)\b/i.test(lower)) tests.push('lint')
  if (tests.length === 0) tests.push('existing test suite')
  return tests
}

function decomposePrompt(goal: string): string {
  return [
    'Decompose the following engineering goal into atomic subtasks.',
    'Return a JSON object with exactly this shape (no markdown, no commentary):',
    '',
    '{',
    '  "tasks": [',
    '    {',
    '      "id": "t1",',
    '      "goal": "concise subtask goal",',
    '      "dependsOn": [],',
    '      "filesTouched": ["src/example.ts"],',
    '      "risk": "low|medium|high",',
    '      "testsRequired": ["unit test"],',
    '      "rollbackPoint": "HEAD"',
    '    }',
    '  ]',
    '}',
    '',
    'Guidelines:',
    '- Each subtask should be small enough to implement and verify independently.',
    '- Use "dependsOn" only for real ordering constraints; independent tasks must use an empty array so they can run in parallel.',
    '- "filesTouched" should list the files likely to change.',
    '- "risk" should be high for auth/security/concurrency/destructive changes, medium for refactor/API changes, low for docs/style.',
    '- "testsRequired" should list the test categories that must pass.',
    '- "rollbackPoint" should be "HEAD".',
    '',
    'Goal:',
    goal,
  ].join('\n')
}

export async function decomposeTask(goal: string, options: DecomposeOptions): Promise<DecomposedTask[]> {
  const rollbackPoint = await currentRollbackPoint(options.cwd)

  if (options.dryRun) {
    return deterministicDecomposition(goal, rollbackPoint)
  }

  const runner = options.runner ?? defaultHeadlessRunner()
  const out = await runner({
    cwd: options.cwd,
    prompt: decomposePrompt(goal),
    maxTurns: 10,
  })

  const parsed = safeParseJSON(out.output, false)
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { tasks?: unknown }).tasks)) {
    const tasks = (parsed as { tasks: DecomposedTask[] }).tasks
    return tasks.map(t => ({
      ...t,
      dependsOn: Array.isArray(t.dependsOn)
        ? [...new Set(t.dependsOn.filter(dep => typeof dep === 'string' && dep !== t.id))]
        : [],
      rollbackPoint: t.rollbackPoint ?? rollbackPoint,
      filesTouched: Array.isArray(t.filesTouched) ? t.filesTouched : [],
      testsRequired: Array.isArray(t.testsRequired) ? t.testsRequired : inferTests(t.goal),
      risk: ['low', 'medium', 'high'].includes(t.risk) ? t.risk : riskLevelFromKeywords(t.goal, t.filesTouched),
    }))
  }

  return deterministicDecomposition(goal, rollbackPoint)
}

export function formatDecomposition(result: DecompositionResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2)
  const lines = [
    `Decomposition: ${result.goal}`,
    `Rollback point: ${result.rollbackPoint}`,
    `Generated: ${result.generatedAt}`,
    '',
  ]
  for (const task of result.tasks) {
    lines.push(`- ${task.id} [${task.risk.toUpperCase()}] ${task.goal}`)
    if (task.filesTouched.length) lines.push(`  files: ${task.filesTouched.join(', ')}`)
    if (task.testsRequired.length) lines.push(`  tests: ${task.testsRequired.join(', ')}`)
    lines.push(`  rollback: ${task.rollbackPoint}`)
    lines.push('')
  }
  return lines.join('\n')
}
