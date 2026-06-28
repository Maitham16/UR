import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWithCwdOverride } from '../src/utils/cwd.js'
import {
  AGENT_FEATURES,
  installAgentTemplates,
  scaffoldAgentFeatures,
} from '../src/services/agents/featureScaffolds.js'
import { buildOllamaShowRequestBody } from '../src/commands/model-doctor/model-doctor.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('agent feature scaffolds', () => {
  test('tracks the nine feature surfaces', () => {
    expect(AGENT_FEATURES).toHaveLength(9)
    expect(AGENT_FEATURES.map(feature => feature.id)).toContain('task-pr')
    expect(AGENT_FEATURES.map(feature => feature.id)).toContain('browser-evals')
  })

  test('installs only requested agent templates', () => {
    const dir = tempDir('ur-templates-')
    const result = installAgentTemplates(dir, ['reviewer'])

    expect(result.created).toEqual(['agents/reviewer.md'])
    expect(existsSync(join(dir, '.ur', 'agents', 'reviewer.md'))).toBe(true)
    expect(existsSync(join(dir, '.ur', 'agents', 'test-runner.md'))).toBe(false)
  })

  test('creates feature scaffolds including workflow, evidence, browser QA, and templates', () => {
    const dir = tempDir('ur-feature-scaffold-')
    const result = scaffoldAgentFeatures(dir)

    expect(result.created).toContain('.github/workflows/ur-agent.yml')
    expect(result.created).toContain('evidence/claims.schema.json')
    expect(result.created).toContain('browser-qa/example.json')
    expect(result.created).toContain('agents/reviewer.md')
  })
})

describe('agent feature commands', () => {
  test('agent-templates rejects unknown names without installing everything', async () => {
    const dir = tempDir('ur-template-command-')
    const { call } = await import('../src/commands/agent-templates/agent-templates.js')

    const result = await runWithCwdOverride(dir, () => call('install revier'))

    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.value).toContain('Unknown agent template')
    }
    const agentsDir = join(dir, '.ur', 'agents')
    expect(existsSync(agentsDir) ? readdirSync(agentsDir) : []).toEqual([])
  })

  test('automation validates schedules and dry-runs due automations', async () => {
    const dir = tempDir('ur-automation-command-')
    const { call } = await import('../src/commands/automation/automation.js')

    const invalid = await runWithCwdOverride(dir, () =>
      call('create bad --schedule "not cron" --prompt "Review"'),
    )
    expect(invalid.type).toBe('text')
    if (invalid.type === 'text') {
      expect(invalid.value).toContain('Invalid automation schedule')
    }

    const created = await runWithCwdOverride(dir, () =>
      call('create nightly --schedule "* * * * *" --prompt "Review open tasks" --json'),
    )
    expect(created.type).toBe('text')
    if (created.type !== 'text') throw new Error('expected text')
    expect(JSON.parse(created.value).name).toBe('nightly')

    const due = await runWithCwdOverride(dir, () =>
      call('run-due --dry-run --now 2100-01-01T00:00:00.000Z --json'),
    )
    expect(due.type).toBe('text')
    if (due.type !== 'text') throw new Error('expected text')
    expect(JSON.parse(due.value).results).toHaveLength(1)
  })

  test('agent-task PR dry-run generates gh command without creating a PR', async () => {
    const dir = tempDir('ur-agent-task-')
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
    writeFileSync(join(dir, 'README.md'), 'test\n')
    const { call } = await import('../src/commands/agent-task/agent-task.js')

    const result = await runWithCwdOverride(dir, () =>
      call('pr --create --dry-run --title "Test PR" --body "Body text"'),
    )

    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.value).toContain('PR dry run')
      expect(result.value).toContain('gh pr create --title "Test PR" --body "Body text"')
    }
  })

  test('semantic memory, claim ledger, and browser QA commands operate on project-local files', async () => {
    const dir = tempDir('ur-local-feature-')
    mkdirSync(join(dir, '.ur', 'browser-qa'), { recursive: true })
    writeFileSync(join(dir, 'README.md'), 'Release checks use typecheck and bundle.')
    writeFileSync(
      join(dir, '.ur', 'browser-qa', 'home.json'),
      JSON.stringify({
        name: 'home',
        target: 'http://127.0.0.1:9',
        assertions: ['page is nonblank'],
      }),
    )
    const semantic = await import('../src/commands/semantic-memory/semantic-memory.js')
    const claims = await import('../src/commands/claim-ledger/claim-ledger.js')
    const browser = await import('../src/commands/browser-qa/browser-qa.js')

    await runWithCwdOverride(dir, () => semantic.call('build --json'))
    const search = await runWithCwdOverride(dir, () =>
      semantic.call('search release checks --json'),
    )
    if (search.type !== 'text') throw new Error('expected text')
    expect(JSON.parse(search.value).results).toHaveLength(1)

    await runWithCwdOverride(dir, () =>
      claims.call('add --claim "Release checks exist" --source file:README.md --json'),
    )
    const valid = await runWithCwdOverride(dir, () => claims.call('validate --json'))
    if (valid.type !== 'text') throw new Error('expected text')
    expect(JSON.parse(valid.value).valid).toBe(true)

    const qa = await runWithCwdOverride(dir, () => browser.call('validate --json'))
    if (qa.type !== 'text') throw new Error('expected text')
    expect(JSON.parse(qa.value).results[0].errors).toEqual([])
  })

  test('model-doctor uses Ollama api/show model request body', () => {
    expect(buildOllamaShowRequestBody('qwen3-coder:latest')).toBe(
      JSON.stringify({ model: 'qwen3-coder:latest' }),
    )
  })
})
