import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { call as auditCall } from '../src/commands/audit/audit.js'
import { call as recipeCall } from '../src/commands/recipe/recipe.js'
import { call as threadCall } from '../src/commands/thread/thread.js'
import { call as wikiCall } from '../src/commands/wiki/wiki.js'
import {
  collectAuditRecords,
  formatAudit,
} from '../src/services/agents/auditExport.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'

const CLI = resolve(import.meta.dir, '..', 'bin', 'ur.js')

function makeWorkspace(prefix: string): string {
  const cwd = mkdtempSync(join(tmpdir(), prefix))
  writeFileSync(
    join(cwd, 'package.json'),
    JSON.stringify({ name: 'command-contract-fixture' }),
  )
  mkdirSync(join(cwd, '.ur'), { recursive: true })
  writeFileSync(
    join(cwd, '.ur', 'actions.jsonl'),
    `${JSON.stringify({
      ts: '2026-07-29T00:00:00.000Z',
      tool: 'Read',
      ok: true,
      args: { file_path: 'README.md' },
    })}\n`,
  )
  return cwd
}

function writeAuditExport(cwd: string, name = 'audit export.jsonl'): string {
  const path = join(cwd, name)
  writeFileSync(path, `${formatAudit(collectAuditRecords(cwd), 'jsonl')}\n`)
  return path
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

describe('root local-command argument and status contracts', () => {
  test('direct handlers parse adapter-quoted arguments and fail closed', async () => {
    const cwd = makeWorkspace('ur-root-handler-contract-')
    try {
      const auditPath = writeAuditExport(cwd)

      await runWithCwdOverride(cwd, async () => {
        const wiki = await wikiCall('"generate"', {} as never)
        expect(wiki.exitCode).toBeUndefined()
        expect(existsSync(join(cwd, '.ur', 'wiki', 'index.md'))).toBe(true)

        const audit = await auditCall(
          `"verify" ${JSON.stringify(auditPath)}`,
        )
        expect(audit.exitCode).toBeUndefined()
        expect(audit.type === 'text' ? audit.value : '').toContain(
          'Audit chain VERIFIED',
        )

        const recipe = await recipeCall(
          '"init" "release triage"',
          {} as never,
        )
        expect(recipe.exitCode).toBeUndefined()
        expect(
          existsSync(join(cwd, '.ur', 'recipes', 'release triage.json')),
        ).toBe(true)

        const threads = await threadCall('"list" --json', {} as never)
        expect(threads.exitCode).toBeUndefined()
        expect(
          JSON.parse(threads.type === 'text' ? threads.value : '{}'),
        ).toEqual({ threads: [] })

        expect(
          (await wikiCall('"unknown"', {} as never)).exitCode,
        ).toBe(2)
        expect((await auditCall('"verify"')).exitCode).toBe(2)
        expect(
          (await recipeCall('"run" "missing"', {} as never)).exitCode,
        ).toBe(1)
        expect(
          (await threadCall('"share" "not/a/session"', {} as never))
            .exitCode,
        ).toBe(2)
      })
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('audit verification rejects empty, malformed, and tampered exports', async () => {
    const cwd = makeWorkspace('ur-audit-command-contract-')
    try {
      const empty = join(cwd, 'empty audit.jsonl')
      const malformed = join(cwd, 'malformed audit.jsonl')
      const tampered = join(cwd, 'tampered audit.jsonl')
      writeFileSync(empty, '')
      writeFileSync(malformed, 'this is not JSON\n')
      const records = collectAuditRecords(cwd)
      writeFileSync(
        tampered,
        `${JSON.stringify({ ...records[0], summary: 'modified' })}\n`,
      )

      await runWithCwdOverride(cwd, async () => {
        for (const path of [empty, malformed, tampered]) {
          const result = await auditCall(
            `"verify" ${JSON.stringify(path)}`,
          )
          expect(result.exitCode, path).toBe(1)
          expect(result.type === 'text' ? result.value : '').toContain(
            'Audit chain BROKEN',
          )
        }
      })
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('the shipped launcher preserves arguments and propagates command failures', () => {
    const cwd = makeWorkspace('ur-root-bin-contract-')
    try {
      const auditPath = writeAuditExport(cwd)

      const wiki = runCli(cwd, ['wiki', 'generate'])
      expect(wiki.code, `${wiki.stdout}\n${wiki.stderr}`).toBe(0)
      expect(wiki.stdout).toContain('Wiki generated:')
      expect(existsSync(join(cwd, '.ur', 'wiki', 'index.md'))).toBe(true)

      const audit = runCli(cwd, ['audit', 'verify', auditPath])
      expect(audit.code, `${audit.stdout}\n${audit.stderr}`).toBe(0)
      expect(audit.stdout).toContain('Audit chain VERIFIED')

      const recipe = runCli(cwd, ['recipe', 'init', 'release triage'])
      expect(recipe.code, `${recipe.stdout}\n${recipe.stderr}`).toBe(0)
      expect(
        existsSync(join(cwd, '.ur', 'recipes', 'release triage.json')),
      ).toBe(true)

      const threads = runCli(cwd, ['thread', 'list', '--json'])
      expect(threads.code, `${threads.stdout}\n${threads.stderr}`).toBe(0)
      expect(JSON.parse(threads.stdout)).toEqual({ threads: [] })

      const malformed = join(cwd, 'bad audit.jsonl')
      writeFileSync(malformed, 'not JSON\n')
      expect(runCli(cwd, ['audit', 'verify', malformed]).code).toBe(1)
      expect(runCli(cwd, ['wiki', 'unknown']).code).toBe(2)
      expect(runCli(cwd, ['recipe', 'unknown']).code).toBe(2)
      expect(runCli(cwd, ['thread', 'share', 'not/a/session']).code).toBe(2)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
