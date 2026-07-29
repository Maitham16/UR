import { describe, expect, test } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { call as agentFeaturesCall } from '../src/commands/agent-features/agent-features.js'
import { call as agentInspectCall } from '../src/commands/agent-inspect/agent-inspect.js'
import { call as agentTemplatesCall } from '../src/commands/agent-templates/agent-templates.js'
import { call as artifactsCall } from '../src/commands/artifacts/artifacts.js'
import { call as automationCall } from '../src/commands/automation/automation.js'
import { call as browserQaCall } from '../src/commands/browser-qa/browser-qa.js'
import { call as claimLedgerCall } from '../src/commands/claim-ledger/claim-ledger.js'
import { call as codeIndexCall } from '../src/commands/code-index/code-index.js'
import { call as goalCall } from '../src/commands/goal/goal.js'
import { call as importSessionCall } from '../src/commands/import-session/import-session.js'
import { call as knowledgeCall } from '../src/commands/knowledge/knowledge.js'
import { call as memoryRetentionCall } from '../src/commands/memory-retention/memory-retention.js'
import { call as memorySuggestCall } from '../src/commands/memory-suggest/memory-suggest.js'
import { call as permissionProfileCall } from '../src/commands/permission-profile/permission-profile.js'
import { call as repoEditCall } from '../src/commands/repo-edit/repo-edit.js'
import { call as roleModeCall } from '../src/commands/role-mode/role-mode.js'
import { call as routeCall } from '../src/commands/route/route.js'
import { call as safetyCall } from '../src/commands/safety/safety.js'
import { call as sandboxCall } from '../src/commands/sandbox/sandbox.js'
import { call as sdkCall } from '../src/commands/sdk/sdk.js'
import { call as semanticMemoryCall } from '../src/commands/semantic-memory/semantic-memory.js'
import { call as specCall } from '../src/commands/spec/spec.js'
import { call as taskCall } from '../src/commands/task/task.js'
import { call as testFirstCall } from '../src/commands/test-first/test-first.js'
import { call as triggerCall } from '../src/commands/trigger/trigger.js'
import { call as worktreeCall } from '../src/commands/worktree/worktree.js'
import type { LocalCommandCall } from '../src/types/command.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'

const CLI = resolve(import.meta.dir, '..', 'bin', 'ur.js')

function workspace(prefix: string): string {
  const cwd = mkdtempSync(join(tmpdir(), prefix))
  mkdirSync(join(cwd, '.ur'), { recursive: true })
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({ name: 'failure-contract-fixture' }),
  )
  return cwd
}

function runCli(
  cwd: string,
  args: string[],
): { code: number; stdout: string; stderr: string } {
  const isolatedHome = join(cwd, '.cli-home')
  mkdirSync(isolatedHome, { recursive: true })
  const result = spawnSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      UR_CODE_DISABLE_AUTO_MEMORY: '1',
      UR_CODE_DISABLE_AUTO_UPDATER: '1',
    },
  })
  if (result.status === null) {
    throw new Error(
      `ur ${args.join(' ')} was killed by ${result.signal ?? 'an unknown signal'}`,
    )
  }
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

function runCliAsync(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const isolatedHome = join(cwd, '.cli-home')
  mkdirSync(isolatedHome, { recursive: true })
  return new Promise((resolveResult, reject) => {
    const child = spawn('node', [CLI, ...args], {
      cwd,
      env: {
        ...process.env,
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        UR_CODE_DISABLE_AUTO_MEMORY: '1',
        UR_CODE_DISABLE_AUTO_UPDATER: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === null) {
        reject(
          new Error(
            `ur ${args.join(' ')} was killed by ${signal ?? 'an unknown signal'}`,
          ),
        )
        return
      }
      resolveResult({ code, stdout, stderr })
    })
  })
}

async function exitCode(
  call: LocalCommandCall,
  args: string,
): Promise<number | undefined> {
  return (await call(args, {} as never)).exitCode
}

describe('remaining local-command failure contracts', () => {
  test('route removes adapter quoting and rejects an empty task', async () => {
    const result = await routeCall(
      '"fix parser" "with spaces" --json',
      {} as never,
    )
    expect(result.exitCode).toBeUndefined()
    expect(
      JSON.parse(result.type === 'text' ? result.value : '{}').task,
    ).toBe('fix parser with spaces')
    expect(await exitCode(routeCall, '')).toBe(2)
  })

  test('claim ledger refuses corrupt state without overwriting it', async () => {
    const cwd = workspace('ur-claim-contract-')
    const path = join(cwd, '.ur', 'evidence', 'claims.json')
    try {
      mkdirSync(join(cwd, '.ur', 'evidence'), { recursive: true })
      writeFileSync(path, '{"claims":[{"id":"1"}]}\n')
      const before = readFileSync(path, 'utf8')

      await runWithCwdOverride(cwd, async () => {
        expect(await exitCode(claimLedgerCall, '"validate"')).toBe(1)
        expect(
          await exitCode(
            claimLedgerCall,
            '"add" --claim "must not write" --source "web:https://example.com"',
          ),
        ).toBe(1)
      })

      expect(readFileSync(path, 'utf8')).toBe(before)
      rmSync(path)
      await runWithCwdOverride(cwd, async () => {
        expect(
          await exitCode(
            claimLedgerCall,
            '"add" --claim "measured result" --source "file:bench.json"',
          ),
        ).toBeUndefined()
        expect(
          await exitCode(claimLedgerCall, '"validate"'),
        ).toBeUndefined()
      })
      expect(JSON.parse(readFileSync(path, 'utf8')).claims).toHaveLength(1)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('claim ledger serializes parallel agent writers without losing claims', async () => {
    const cwd = workspace('ur-claim-parallel-')
    try {
      const writers = Array.from({ length: 8 }, (_, index) =>
        runCliAsync(cwd, [
          'claim-ledger',
          'add',
          '--claim',
          `parallel claim ${index + 1}`,
          '--source',
          `user:worker-${index + 1}`,
          '--json',
        ]),
      )
      const results = await Promise.all(writers)
      for (const result of results) {
        expect(result.code, result.stderr).toBe(0)
      }

      const ledger = JSON.parse(
        readFileSync(
          join(cwd, '.ur', 'evidence', 'claims.json'),
          'utf8',
        ),
      ) as { claims: Array<{ id: string; claim: string }> }
      expect(ledger.claims).toHaveLength(writers.length)
      expect(new Set(ledger.claims.map(claim => claim.id)).size).toBe(
        writers.length,
      )
      expect(new Set(ledger.claims.map(claim => claim.claim)).size).toBe(
        writers.length,
      )
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('invalid inputs and missing resources return stable failure classes', async () => {
    const cwd = workspace('ur-local-failure-contract-')
    try {
      await runWithCwdOverride(cwd, async () => {
        const cases: Array<[string, LocalCommandCall, string, number]> = [
          ['agent features', agentFeaturesCall, '"unknown"', 2],
          ['agent templates', agentTemplatesCall, '"install" "missing"', 2],
          ['artifact', artifactsCall, '"show" "missing"', 1],
          ['browser fixture', browserQaCall, '"run" "missing"', 1],
          ['code index', codeIndexCall, '"search" "query"', 1],
          ['goal', goalCall, '"show" "missing"', 1],
          ['import', importSessionCall, '"missing transcript.jsonl"', 1],
          ['knowledge', knowledgeCall, '"add" "missing source"', 1],
          [
            'memory retention',
            memoryRetentionCall,
            '"set" --ttl-days "bad"',
            2,
          ],
          ['memory suggest', memorySuggestCall, '--turns "3x"', 2],
          ['permission profile', permissionProfileCall, '"use"', 2],
          ['repo edit', repoEditCall, '"move" "Thing" "target.ts"', 2],
          ['role mode', roleModeCall, '"show" "missing"', 1],
          ['safety', safetyCall, '"check"', 2],
          ['sandbox', sandboxCall, '"unknown"', 2],
          ['sdk', sdkCall, '"unknown"', 2],
          ['semantic memory', semanticMemoryCall, '"search"', 2],
          ['spec', specCall, '"run" "missing"', 1],
          ['task', taskCall, '"status" "missing"', 1],
          ['test first', testFirstCall, '"unknown"', 2],
          ['trigger', triggerCall, '"parse" --file "missing.json"', 1],
          ['worktree', worktreeCall, '"status" "missing"', 1],
          [
            'agent inspect',
            agentInspectCall,
            '--file "missing transcript.jsonl"',
            1,
          ],
        ]
        for (const [label, call, args, expected] of cases) {
          expect(await exitCode(call, args), label).toBe(expected)
        }
      })
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('child process failures propagate through automation results', async () => {
    const cwd = workspace('ur-automation-failure-contract-')
    try {
      const dir = join(cwd, '.ur', 'automations')
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'broken.json'),
        `${JSON.stringify({
          version: 1,
          name: 'broken',
          schedule: '0 0 * * *',
          prompt: 'run',
          runner: {
            command: 'definitely-not-a-real-ur-contract-binary',
            args: [],
          },
          createdAt: '2026-07-29T00:00:00.000Z',
          enabled: true,
        })}\n`,
      )
      await runWithCwdOverride(cwd, async () => {
        expect(await exitCode(automationCall, '"run" "broken"')).toBe(1)
      })
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('repo-edit action arguments produce a preview without mutating', async () => {
    const cwd = workspace('ur-repo-edit-contract-')
    const source = join(cwd, 'sample.ts')
    const original = 'export const oldName = 1\nconsole.log(oldName)\n'
    try {
      writeFileSync(source, original)
      await runWithCwdOverride(cwd, async () => {
        const result = await repoEditCall(
          '"rename" "oldName" --to "newName" --file "sample.ts"',
          {} as never,
        )
        expect(
          result.exitCode,
          result.type === 'text' ? result.value : 'non-text result',
        ).toBeUndefined()
        expect(result.type === 'text' ? result.value : '').not.toContain(
          'Usage:',
        )
      })
      expect(readFileSync(source, 'utf8')).toBe(original)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('shipped adapter preserves route text and propagates failures', () => {
    const cwd = workspace('ur-shipped-failure-contract-')
    try {
      const route = runCli(cwd, [
        'route',
        'fix parser',
        'with spaces',
        '--json',
      ])
      expect(route.code, `${route.stdout}\n${route.stderr}`).toBe(0)
      expect(JSON.parse(route.stdout).task).toBe('fix parser with spaces')

      const cases: Array<[string[], number]> = [
        [['route'], 2],
        [['automation', 'run', 'missing'], 1],
        [['browser-qa', 'run', 'missing'], 1],
        [['claim-ledger', 'unknown'], 2],
        [['safety', 'unknown'], 2],
        [['trigger', 'parse', '--file', 'missing.json'], 1],
      ]
      for (const [args, expected] of cases) {
        const result = runCli(cwd, args)
        expect(
          result.code,
          `ur ${args.join(' ')}\n${result.stdout}\n${result.stderr}`,
        ).toBe(expected)
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
