import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  unlinkSync,
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
  test('tracks the agent feature surfaces', () => {
    expect(AGENT_FEATURES).toHaveLength(23)
    const ids = AGENT_FEATURES.map(feature => feature.id)
    expect(ids).toContain('task-pr')
    expect(ids).toContain('browser-evals')
    expect(ids).toContain('collab-patterns')
    expect(ids).toContain('workflows')
    expect(ids).toContain('knowledge-base')
    expect(ids).toContain('agent-crew')
    expect(ids).toContain('scheduler')
    expect(ids).toContain('model-router')
    expect(ids).toContain('trigger-bridge')
    expect(ids).toContain('goals')
    expect(ids).toContain('sdk')
    expect(ids).toContain('test-first-loop')
    expect(ids).toContain('permission-safety')
    expect(ids).toContain('context-pack')
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
  test('local-first command reports private offline readiness', async () => {
    const dir = tempDir('ur-local-first-command-')
    const { call } = await import('../src/commands/local-first/local-first.js')

    const result = await runWithCwdOverride(dir, () => call('--json'))
    expect(result.type).toBe('text')
    if (result.type !== 'text') throw new Error('expected text')
    const parsed = JSON.parse(result.value)
    expect(parsed.posture).toContain('no cloud required')
    expect(parsed.posture).toContain('private codebase friendly')
    expect(parsed.recommendedCommands).toContain('ur --offline')
  })

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

  test('background-agent dry-run records durable local tasks without spawning', async () => {
    const dir = tempDir('ur-bg-command-')
    const { call } = await import('../src/commands/bg/bg.js')

    const created = await runWithCwdOverride(dir, () =>
      call('run "Fix the flaky test" --worktree --pr --route strong --title "Fix flaky test" --dry-run --json'),
    )

    expect(created.type).toBe('text')
    if (created.type !== 'text') throw new Error('expected text')
    const parsed = JSON.parse(created.value)
    expect(parsed.dryRun).toBe(true)
    expect(parsed.task.task).toBe('Fix the flaky test')
    expect(parsed.task.worktree.enabled).toBe(true)
    expect(parsed.task.pr.enabled).toBe(true)
    expect(parsed.task.routeStrategy).toBe('strong')
    expect(parsed.command.join(' ')).toContain('bg worker')

    const listed = await runWithCwdOverride(dir, () => call('list --json'))
    if (listed.type !== 'text') throw new Error('expected text')
    expect(JSON.parse(listed.value).tasks).toHaveLength(1)
  })

  test('background-agent fanout caps and records multiple candidates', async () => {
    const dir = tempDir('ur-bg-fanout-')
    const { call } = await import('../src/commands/bg/bg.js')

    const result = await runWithCwdOverride(dir, () =>
      call('fanout "Improve the parser" --agents 2 --dry-run --json'),
    )

    expect(result.type).toBe('text')
    if (result.type !== 'text') throw new Error('expected text')
    const parsed = JSON.parse(result.value)
    expect(parsed.results).toHaveLength(2)
    expect(parsed.results[0].task.task).toContain('Candidate 1/2')
    expect(parsed.results[1].task.task).toContain('Candidate 2/2')
  })

  test('artifact comments can steer a background task inbox', async () => {
    const dir = tempDir('ur-artifact-steering-')
    const bg = await import('../src/commands/bg/bg.js')
    const artifacts = await import('../src/commands/artifacts/artifacts.js')
    const {
      formatInboxSteering,
      readBackgroundInbox,
      streamUserMessage,
    } = await import('../src/services/agents/backgroundRunner.js')

    const bgResult = await runWithCwdOverride(dir, () =>
      bg.call('run "Implement feature" --dry-run --json'),
    )
    if (bgResult.type !== 'text') throw new Error('expected text')
    const taskId = JSON.parse(bgResult.value).task.id

    const artifactResult = await runWithCwdOverride(dir, () =>
      artifacts.call(`add --kind plan --title "Plan" --body "Initial plan" --task ${taskId} --json`),
    )
    if (artifactResult.type !== 'text') throw new Error('expected text')
    const artifactId = JSON.parse(artifactResult.value).id

    const comment = await runWithCwdOverride(dir, () =>
      artifacts.call(`comment ${artifactId} --feedback "Use the simpler path"`),
    )
    expect(comment.type).toBe('text')
    if (comment.type === 'text') {
      expect(comment.value).toContain(`queued it for background task ${taskId}`)
    }
    expect(readBackgroundInbox(dir, taskId)).toContain('Use the simpler path')
    const steering = formatInboxSteering({
      artifactId: artifactId,
      text: 'Use the simpler path',
    })
    expect(steering).toContain(`artifact ${artifactId}`)
    const message = JSON.parse(streamUserMessage(steering!, 'now'))
    expect(message.type).toBe('user')
    expect(message.priority).toBe('now')
    expect(message.message.content).toContain('Use the simpler path')
  })

  test('memory retention prunes project-local memory jsonl files', async () => {
    const dir = tempDir('ur-memory-retention-')
    mkdirSync(join(dir, '.ur', 'memory'), { recursive: true })
    writeFileSync(
      join(dir, '.ur', 'memory', 'notes.jsonl'),
      [
        JSON.stringify({ ts: '2000-01-01T00:00:00.000Z', text: 'old' }),
        JSON.stringify({ ts: '2100-01-01T00:00:00.000Z', text: 'new' }),
      ].join('\n') + '\n',
    )
    const { call } = await import('../src/commands/memory-retention/memory-retention.js')

    await runWithCwdOverride(dir, () =>
      call('set --ttl-days 365 --max-entries 10 --json'),
    )
    const pruned = await runWithCwdOverride(dir, () => call('prune --json'))

    expect(pruned.type).toBe('text')
    if (pruned.type !== 'text') throw new Error('expected text')
    const parsed = JSON.parse(pruned.value)
    expect(parsed.files[0].removed).toBe(1)
    expect(readFileSync(join(dir, '.ur', 'memory', 'notes.jsonl'), 'utf-8')).toContain('new')
    expect(readFileSync(join(dir, '.ur', 'memory', 'notes.jsonl'), 'utf-8')).not.toContain('old')
  })

  test('code-index watch dry-run does not require Ollama', async () => {
    const dir = tempDir('ur-code-index-watch-')
    const { call } = await import('../src/commands/code-index/code-index.js')

    const result = await runWithCwdOverride(dir, () => call('watch --dry-run --json'))

    expect(result.type).toBe('text')
    if (result.type !== 'text') throw new Error('expected text')
    const parsed = JSON.parse(result.value)
    expect(parsed.watching).toBe(dir)
    expect(parsed.dryRun).toBe(true)
  })

  test('IDE inline diff bundles capture patch metadata and comments', async () => {
    const dir = tempDir('ur-ide-diff-')
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' })
    writeFileSync(join(dir, 'app.ts'), 'export const value = 1\n')
    execFileSync('git', ['add', 'app.ts'], { cwd: dir, stdio: 'ignore' })
    execFileSync(
      'git',
      ['-c', 'user.name=UR Test', '-c', 'user.email=ur@example.test', 'commit', '-m', 'init'],
      { cwd: dir, stdio: 'ignore' },
    )
    writeFileSync(join(dir, 'app.ts'), 'export const value = 2\n')
    const { runIdeDiffCommand } = await import('../src/commands/ide/inlineDiffCommand.js')

    const captured = await runWithCwdOverride(dir, () =>
      runIdeDiffCommand('diff capture --title "Inline review" --json'),
    )
    const parsed = JSON.parse(captured)
    expect(parsed.bundle.id).toBe('diff-1')
    expect(parsed.bundle.files[0].path).toBe('app.ts')
    expect(parsed.bundle.files[0].additions).toBe(1)
    expect(existsSync(join(dir, '.ur', 'ide', 'diffs', parsed.bundle.patchFile))).toBe(true)

    const commented = await runWithCwdOverride(dir, () =>
      runIdeDiffCommand('diff comment diff-1 --feedback "Prefer a named constant" --file app.ts --line 1'),
    )
    expect(commented).toContain('Added IDE diff comment')
    const shown = await runWithCwdOverride(dir, () =>
      runIdeDiffCommand('diff show diff-1 --json'),
    )
    expect(JSON.parse(shown).comments[0].text).toBe('Prefer a named constant')
  })

  test('VS Code inline diff extension manifest exposes UR review commands', () => {
    const manifest = JSON.parse(
      readFileSync(
        join(process.cwd(), 'extensions', 'vscode-ur-inline-diffs', 'package.json'),
        'utf-8',
      ),
    )
    expect(manifest.name).toBe('ur-inline-diffs')
    expect(manifest.main).toBe('./out/extension.js')
    const commands = manifest.contributes.commands.map((command: { command: string }) => command.command)
    expect(commands).toContain('urInlineDiffs.open')
    expect(commands).toContain('urInlineDiffs.comment')
    expect(manifest.contributes.views.ur[0].id).toBe('urInlineDiffs')
  })

  test('VS Code inline diff extension manifest exposes the PR3 status/actions/search/options surfaces', () => {
    const manifest = JSON.parse(
      readFileSync(
        join(process.cwd(), 'extensions', 'vscode-ur-inline-diffs', 'package.json'),
        'utf-8',
      ),
    )
    const viewIds = manifest.contributes.views.ur.map((view: { id: string }) => view.id)
    expect(viewIds).toContain('urActions')

    const commands = manifest.contributes.commands.map((command: { command: string }) => command.command)
    for (const id of [
      'urInlineDiffs.agentStatus',
      'urInlineDiffs.agentOptions',
      'urInlineDiffs.reviewCurrentDiff',
      'urInlineDiffs.runVerifier',
      'urInlineDiffs.searchActions',
      'urActions.refresh',
    ]) {
      expect(commands).toContain(id)
    }
  })

  test('VS Code inline diff extension packages as bundled VSIX', async () => {
    const { createBundledVSCodeExtensionVsix } = await import('../src/utils/ide.js')
    const { unzipSync } = await import('fflate')
    const vsixPath = await createBundledVSCodeExtensionVsix()

    try {
      expect(existsSync(vsixPath)).toBe(true)
      const files = unzipSync(new Uint8Array(readFileSync(vsixPath)))
      expect(files['extension/package.json']).toBeDefined()
      expect(files['extension/out/extension.js']).toBeDefined()
      expect(files['extension.vsixmanifest']).toBeDefined()
      const manifest = JSON.parse(
        Buffer.from(files['extension/package.json']!).toString('utf8'),
      )
      expect(`${manifest.publisher}.${manifest.name}`).toBe(
        'ur-agent.ur-inline-diffs',
      )
      const rootPackage = JSON.parse(
        readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
      )
      expect(manifest.version).toBe(rootPackage.version)
    } finally {
      unlinkSync(vsixPath)
    }
  })

  test('eval benchmark adapters import local SWE-bench style records', async () => {
    const dir = tempDir('ur-eval-bench-')
    const benchFile = join(dir, 'swe.jsonl')
    writeFileSync(
      benchFile,
      JSON.stringify({
        instance_id: 'example__repo-1',
        repo: 'example/repo',
        problem_statement: 'Fix the parser when input is empty.',
        FAIL_TO_PASS: ['tests/test_parser.py::test_empty'],
      }) + '\n',
    )
    const { call } = await import('../src/commands/eval/eval.js')

    const imported = await runWithCwdOverride(dir, () =>
      call(`bench swe-bench --file "${benchFile}" --name local-swe --json`),
    )
    expect(imported.type).toBe('text')
    if (imported.type !== 'text') throw new Error('expected text')
    const parsed = JSON.parse(imported.value)
    expect(parsed.suite.name).toBe('local-swe')
    expect(parsed.suite.cases[0].category).toBe('swe-bench')
    expect(parsed.suite.cases[0].prompt).toContain('Fix the parser')
    expect(existsSync(join(dir, '.ur', 'evals', 'local-swe.json'))).toBe(true)

    const validation = await runWithCwdOverride(dir, () => call('validate local-swe --json'))
    if (validation.type !== 'text') throw new Error('expected text')
    expect(JSON.parse(validation.value).valid).toBe(true)
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
