import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalCommandCall, LocalCommandResult } from '../../types/command.js'
import {
  defaultHeadlessRunner,
  makeDryHeadlessRunner,
} from '../../services/agents/headlessAgent.js'
import { runStructured } from '../../services/agents/structuredRun.js'
import { getCwd } from '../../utils/cwd.js'
import { safeParseJSON } from '../../utils/json.js'

/**
 * Recipes = Devin-style playbooks: a stored prompt template + JSON Schema.
 * `run` spawns a headless child session whose final answer must validate
 * against the schema (one automatic repair round on mismatch), so scripts
 * and workflows can consume agent output programmatically.
 */

type Recipe = {
  name: string
  description?: string
  /** Prompt template; ${INPUT} is replaced with the run arguments. */
  prompt: string
  schema: object
  model?: string
  maxTurns?: number
}

function recipesDir(cwd: string): string {
  return join(cwd, '.ur', 'recipes')
}

function loadRecipe(cwd: string, name: string): Recipe | null {
  const path = join(recipesDir(cwd), `${name}.json`)
  if (!existsSync(path)) return null
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  if (!parsed || typeof parsed !== 'object') return null
  const r = parsed as Recipe
  return r.prompt && r.schema ? r : null
}

const STARTER: Recipe = {
  name: 'triage',
  description: 'Triage a bug report into a structured ticket',
  prompt:
    'Triage this bug report. Investigate the codebase as needed.\n\nReport: ${INPUT}',
  schema: {
    type: 'object',
    required: ['severity', 'component', 'summary', 'next_step'],
    properties: {
      severity: { enum: ['low', 'medium', 'high', 'critical'] },
      component: { type: 'string' },
      summary: { type: 'string' },
      next_step: { type: 'string' },
    },
    additionalProperties: false,
  },
}

export const call: LocalCommandCall = async (args: string): Promise<LocalCommandResult> => {
  const cwd = getCwd()
  const tokens = (args ?? '').trim().split(/\s+/).filter(Boolean)
  const action = tokens[0] ?? 'list'
  const json = tokens.includes('--json')

  if (action === 'init') {
    const name = tokens[1] ?? STARTER.name
    mkdirSync(recipesDir(cwd), { recursive: true })
    const path = join(recipesDir(cwd), `${name}.json`)
    if (existsSync(path)) return { type: 'text', value: `Recipe exists: ${path}` }
    writeFileSync(path, `${JSON.stringify({ ...STARTER, name }, null, 2)}\n`)
    return {
      type: 'text',
      value: `Created ${path} — edit the prompt/schema, then: ur recipe run ${name} "<input>"`,
    }
  }

  if (action === 'list') {
    const dir = recipesDir(cwd)
    const names = existsSync(dir)
      ? readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
      : []
    if (json) return { type: 'text', value: JSON.stringify({ recipes: names }, null, 2) }
    return {
      type: 'text',
      value: names.length
        ? `Recipes:\n${names.map(n => `  ${n}`).join('\n')}`
        : 'No recipes yet. Start with: ur recipe init triage',
    }
  }

  if (action === 'run') {
    const name = tokens[1]
    if (!name) return { type: 'text', value: 'Usage: ur recipe run <name> [input...] [--model m] [--max-turns n] [--dry-run] [--json]' }
    const recipe = loadRecipe(cwd, name)
    if (!recipe) return { type: 'text', value: `Recipe not found or invalid: ${name} (looked in .ur/recipes/${name}.json)` }

    const flagIdx = tokens.findIndex(t => t.startsWith('--'), 2)
    const inputEnd = flagIdx === -1 ? tokens.length : flagIdx
    const input = tokens.slice(2, inputEnd).join(' ')
    const modelIdx = tokens.indexOf('--model')
    const maxTurnsIdx = tokens.indexOf('--max-turns')
    const dryRun = tokens.includes('--dry-run')

    const runner = dryRun ? makeDryHeadlessRunner() : defaultHeadlessRunner()
    const result = await runStructured(runner, {
      cwd,
      prompt: recipe.prompt.replace(/\$\{INPUT\}/g, input),
      schema: recipe.schema,
      model: modelIdx !== -1 ? tokens[modelIdx + 1] : recipe.model,
      maxTurns:
        maxTurnsIdx !== -1 ? Number(tokens[maxTurnsIdx + 1]) : (recipe.maxTurns ?? 15),
    })

    if (json || result.ok) {
      return {
        type: 'text',
        value: JSON.stringify(
          result.ok
            ? { ok: true, recipe: name, data: result.data, attempts: result.attempts }
            : { ok: false, recipe: name, errors: result.errors, raw: result.rawOutput.slice(0, 2000) },
          null,
          2,
        ),
      }
    }
    return {
      type: 'text',
      value: `Recipe ${name} FAILED schema validation after ${result.attempts} attempt(s):\n${result.errors.map(e => `  - ${e}`).join('\n')}\n\nRaw output (truncated):\n${result.rawOutput.slice(0, 1500)}`,
    }
  }

  return { type: 'text', value: 'Usage: ur recipe init <name> | list | run <name> [input...]' }
}
