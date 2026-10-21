import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import { safeParseJSON } from '../../utils/json.js'

import { runBrowserFixture, validateBrowserFixture, type BrowserFixture } from '../../services/agents/browserQa.js'

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
    const results = all.map(item => ({ file: item.file, errors: validateBrowserFixture(item.fixture) }))
    return { type: 'text', value: JSON.stringify({ results }, null, 2), exitCode: results.some(item => item.errors.length) ? 1 : 0 }
  }

  if (command === 'run') {
    const name = tokens.find(token => !token.startsWith('--') && token !== 'run')
    const selected = all.find(item => item.file === name || item.fixture?.name === name)
    if (!selected?.fixture) return { type: 'text', value: `Browser QA fixture not found: ${name ?? ''}`, exitCode: 1 }
    const errors = validateBrowserFixture(selected.fixture)
    if (errors.length > 0) return { type: 'text', value: `Invalid fixture: ${errors.join(', ')}`, exitCode: 1 }
    const result = await runBrowserFixture(selected.fixture, { cwd: getCwd(), dryRun })
    return { type: 'text', value: JSON.stringify(result, null, 2), exitCode: 'ok' in result && !result.ok ? 1 : 0 }
  }

  return { type: 'text', value: 'Usage: ur browser-qa list|validate|run [fixture] [--dry-run] [--json]' }
}
