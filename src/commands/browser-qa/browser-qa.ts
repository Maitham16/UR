import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { safeParseJSON } from '../../utils/json.js'

type BrowserFixture = {
  name: string
  target: string
  viewports?: Array<{ name: string; width: number; height: number }>
  assertions?: string[]
}

function fixturesDir(): string {
  return join(getCwd(), '.ur', 'browser-qa')
}

function fixtures(): Array<{ file: string; fixture: BrowserFixture | null }> {
  if (!existsSync(fixturesDir())) return []
  return readdirSync(fixturesDir())
    .filter(file => file.endsWith('.json'))
    .map(file => {
      const parsed = safeParseJSON(readFileSync(join(fixturesDir(), file), 'utf-8'), false)
      return { file, fixture: parsed && typeof parsed === 'object' ? (parsed as BrowserFixture) : null }
    })
}

function validateFixture(fixture: BrowserFixture | null): string[] {
  const errors: string[] = []
  if (!fixture) return ['invalid JSON fixture']
  if (!fixture.name) errors.push('missing name')
  if (!fixture.target) errors.push('missing target')
  try {
    if (fixture.target) new URL(fixture.target)
  } catch {
    errors.push('target must be an absolute URL')
  }
  if (!Array.isArray(fixture.assertions) || fixture.assertions.length === 0) {
    errors.push('missing assertions')
  }
  return errors
}

async function smoke(fixture: BrowserFixture, dryRun: boolean): Promise<unknown> {
  if (dryRun) {
    return { name: fixture.name, target: fixture.target, dryRun: true }
  }
  try {
    const response = await fetch(fixture.target, { signal: AbortSignal.timeout(5000) })
    const text = await response.text()
    return {
      name: fixture.name,
      target: fixture.target,
      ok: response.ok && text.trim().length > 0,
      status: response.status,
      bytes: text.length,
    }
  } catch (error) {
    return {
      name: fixture.name,
      target: fixture.target,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const json = tokens.includes('--json')
  const dryRun = tokens.includes('--dry-run')
  const command = tokens.find(token => !token.startsWith('--')) ?? 'list'
  const all = fixtures()

  if (command === 'list') {
    const list = all.map(item => ({ file: item.file, name: item.fixture?.name, target: item.fixture?.target }))
    return { type: 'text', value: json ? JSON.stringify({ fixtures: list }, null, 2) : JSON.stringify({ fixtures: list }, null, 2) }
  }

  if (command === 'validate') {
    const results = all.map(item => ({ file: item.file, errors: validateFixture(item.fixture) }))
    return { type: 'text', value: json ? JSON.stringify({ results }, null, 2) : JSON.stringify({ results }, null, 2) }
  }

  if (command === 'run') {
    const name = tokens.find(token => !token.startsWith('--') && token !== 'run')
    const selected = all.find(item => item.file === name || item.fixture?.name === name)
    if (!selected?.fixture) return { type: 'text', value: `Browser QA fixture not found: ${name ?? ''}` }
    const errors = validateFixture(selected.fixture)
    if (errors.length > 0) return { type: 'text', value: `Invalid fixture: ${errors.join(', ')}` }
    const result = await smoke(selected.fixture, dryRun)
    return { type: 'text', value: json ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2) }
  }

  return { type: 'text', value: 'Usage: ur browser-qa list|validate|run [fixture] [--dry-run] [--json]' }
}
