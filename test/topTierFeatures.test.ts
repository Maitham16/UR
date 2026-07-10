import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectAuditRecords,
  formatAudit,
  verifyAuditChain,
} from '../src/services/agents/auditExport.js'
import {
  createCloudTask,
  formatCloudTasks,
  getCloudTask,
  listCloudTasks,
} from '../src/services/agents/cloudTasks.js'
import { runCrew, createCrew } from '../src/services/agents/crew.js'
import { isCodeIndexEnabled } from '../src/utils/codeIndex/index.js'
import { handleDashboardRequest } from '../src/services/agents/dashboardRoutes.js'
import { emptyStats, foldOutcomes, suggestSkillCandidates } from '../src/services/agents/learning.js'
import {
  generateRepoMap,
  generateWiki,
  loadRepoMapForPrompt,
  repoMapPath,
} from '../src/services/agents/repoWiki.js'
import {
  extractJsonPayload,
  runStructured,
} from '../src/services/agents/structuredRun.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('audit export', () => {
  test('collects ledger records into a verifiable hash chain', () => {
    const dir = tempDir('ur-audit-')
    try {
      mkdirSync(join(dir, '.ur'), { recursive: true })
      writeFileSync(
        join(dir, '.ur', 'actions.jsonl'),
        `${JSON.stringify({ ts: '2026-01-01T00:00:00Z', tool: 'Bash', ok: true, args: { command: 'ls' } })}\n${JSON.stringify({ ts: '2026-01-01T00:01:00Z', tool: 'Edit', ok: false, args: {} })}\n`,
      )
      const records = collectAuditRecords(dir)
      expect(records).toHaveLength(2)
      expect(verifyAuditChain(records)).toBe(true)
      // Tamper → chain breaks
      const tampered = records.map((r, i) => (i === 0 ? { ...r, summary: 'edited' } : r))
      expect(verifyAuditChain(tampered)).toBe(false)
      expect(formatAudit(records, 'csv').split('\n')).toHaveLength(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('structured runs', () => {
  test('accepts a schema-valid reply on the first attempt', async () => {
    const runner = async () => ({
      output: 'done\n```json\n{"severity": "low", "summary": "ok"}\n```',
      verdict: 'PASS' as const,
      isError: false,
    })
    const result = await runStructured(runner, {
      cwd: '/tmp',
      prompt: 'triage',
      schema: {
        type: 'object',
        required: ['severity', 'summary'],
        properties: { severity: { type: 'string' }, summary: { type: 'string' } },
      },
    })
    expect(result.ok).toBe(true)
    expect((result.data as { severity: string }).severity).toBe('low')
    expect(result.attempts).toBe(1)
  })

  test('gives one repair round with validation errors, then succeeds', async () => {
    let calls = 0
    const runner = async (opts: { prompt: string }) => {
      calls += 1
      if (calls === 1) {
        return { output: '```json\n{"wrong": true}\n```', verdict: null, isError: false }
      }
      expect(opts.prompt).toContain('failed validation')
      return { output: '```json\n{"severity": "high"}\n```', verdict: null, isError: false }
    }
    const result = await runStructured(runner, {
      cwd: '/tmp',
      prompt: 'triage',
      schema: { type: 'object', required: ['severity'], properties: { severity: { type: 'string' } } },
    })
    expect(result.ok).toBe(true)
    expect(result.attempts).toBe(2)
  })

  test('reports errors when repair also fails', async () => {
    const runner = async () => ({ output: 'no json at all', verdict: null, isError: false })
    const result = await runStructured(runner, {
      cwd: '/tmp',
      prompt: 'x',
      schema: { type: 'object', required: ['a'] },
    })
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  test('extractJsonPayload prefers the last fenced block', () => {
    expect(extractJsonPayload('a ```json\n{"a":1}\n``` b ```json\n{"b":2}\n```')).toContain('"b"')
  })
})

describe('repo wiki + map', () => {
  test('generates wiki pages and a prompt-injectable map', () => {
    const dir = tempDir('ur-wiki-')
    try {
      writeFileSync(join(dir, 'package.json'), '{"name":"demo","scripts":{"test":"bun test"}}')
      mkdirSync(join(dir, 'src'))
      writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1')
      const { pages } = generateWiki(dir)
      expect(pages).toContain('index.md')
      expect(existsSync(join(dir, '.ur', 'wiki', 'architecture.md'))).toBe(true)
      expect(existsSync(repoMapPath(dir))).toBe(true)
      const map = loadRepoMapForPrompt(dir)
      expect(map).toContain('Repo map')
      expect(readFileSync(join(dir, '.ur', 'wiki', 'index.md'), 'utf-8')).toContain('demo')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('map injection is absent without generation and caps size', () => {
    const dir = tempDir('ur-map-')
    try {
      expect(loadRepoMapForPrompt(dir)).toBeNull()
      generateRepoMap(dir)
      expect(loadRepoMapForPrompt(dir, 10)).toContain('truncated')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('cloud tasks', () => {
  test('create/list/get roundtrip with attempts clamped', () => {
    const dir = tempDir('ur-cloud-')
    try {
      const t = createCloudTask(dir, { task: 'speed up parser', attempts: 99 })
      expect(t.attempts).toBe(8)
      expect(listCloudTasks(dir)).toHaveLength(1)
      expect(getCloudTask(dir, t.id)?.task).toBe('speed up parser')
      expect(formatCloudTasks(listCloudTasks(dir), false)).toContain(t.id)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('crew dynamic fan-out', () => {
  test('scales workers to the board under the governor', async () => {
    const dir = tempDir('ur-crew-dyn-')
    try {
      createCrew(dir, 'dyn', 'goal', {
        tasks: ['t1', 't2', 't3', 't4', 't5'],
      })
      const seen: string[] = []
      const result = await runCrew('dyn', {
        cwd: dir,
        dynamic: true,
        maxWorkers: 3,
        runnerFor: () => async ({ step }) => {
          seen.push(step.id)
          return { output: 'ok', verdict: 'PASS', isError: false }
        },
      })
      expect(result.progress.done).toBe(5)
      expect(result.workers).toBeGreaterThanOrEqual(1)
      expect(result.workers).toBeLessThanOrEqual(3 + 2) // governor bound (waves may respawn)
      expect(seen).toHaveLength(5)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('skill candidates', () => {
  test('suggests skills only with solid evidence and no existing skill', () => {
    const outcomes = Array.from({ length: 6 }, (_, i) => ({
      key: `k${i}`, category: 'testing', model: null, pass: true, detail: '',
    }))
    const stats = foldOutcomes(emptyStats(), outcomes)
    expect(suggestSkillCandidates(stats)).toHaveLength(1)
    expect(suggestSkillCandidates(stats, ['testing-playbook'])).toHaveLength(0)
    expect(suggestSkillCandidates(emptyStats())).toHaveLength(0)
  })
})

describe('dashboard routes', () => {
  test('serves /dashboard html and /api/dashboard json; ignores other paths', async () => {
    const dir = tempDir('ur-dash-')
    try {
      const html = await handleDashboardRequest(dir, '/dashboard')
      expect(html?.status).toBe(200)
      expect(html?.body).toContain('UR dashboard')
      const api = await handleDashboardRequest(dir, '/api/dashboard')
      expect(api?.type).toBe('application/json')
      expect(await handleDashboardRequest(dir, '/artifacts')).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('code index auto-enable (zero-config semantic search)', () => {
  test('enables automatically when a built index exists in cwd', () => {
    const dir = tempDir('ur-cidx-')
    const prev = process.cwd()
    try {
      process.chdir(dir)
      expect(isCodeIndexEnabled({})).toBe(false)
      mkdirSync(join(dir, '.ur', 'code-index'), { recursive: true })
      writeFileSync(join(dir, '.ur', 'code-index', 'index.json'), '{"version":1}')
      process.chdir(prev)
      process.chdir(dir) // bust the per-cwd cache window via fresh chdir
      expect(isCodeIndexEnabled({})).toBe(true)
      // Explicit off overrides index presence
      expect(isCodeIndexEnabled({ UR_CODE_INDEX: 'off' })).toBe(false)
      // Explicit on works without any index
      expect(isCodeIndexEnabled({ UR_CODE_INDEX: '1' })).toBe(true)
    } finally {
      process.chdir(prev)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
