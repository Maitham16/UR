import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { previewAgentSkill, runAgentSkill } from '../src/services/agents/agentSkillRunner.js'
import {
  getBackgroundTask,
  readBackgroundLog,
  startBackgroundTask,
} from '../src/services/agents/backgroundRunner.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('agentSkillRunner', () => {
  test('previewAgentSkill returns id, command, and branch', () => {
    const dir = tempDir('ur-nexus-skill-')
    try {
      const preview = previewAgentSkill({ cwd: dir, skill: 'debug', prompt: 'fix bug' })
      expect(preview.id).toMatch(/^bg_/)
      expect(preview.branch).toMatch(/^ur\/bg-/)
      expect(preview.command).toContain('bg')
      expect(preview.command).toContain('worker')
      expect(preview.command).toContain(preview.id)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('runAgentSkill dry-run returns summary without spawning', async () => {
    const dir = tempDir('ur-nexus-skill-')
    try {
      const result = await runAgentSkill({
        cwd: dir,
        skill: 'refactor',
        prompt: 'refactor utils',
        dryRun: true,
        pollMs: 50,
      })
      expect(result.taskId).toMatch(/^bg_/)
      expect(result.branch).toContain('refactor')
      expect(result.prCreated).toBe(false)
      expect(result.commits).toEqual([])
      expect(result.diffSummary).toContain('Dry run command')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('runAgentSkill creates a manifest task for non-dry runs', async () => {
    const dir = tempDir('ur-nexus-skill-')
    try {
      const promise = runAgentSkill({
        cwd: dir,
        skill: 'benchmark',
        prompt: 'add benchmarks',
        pollMs: 50,
        timeoutMs: 200,
      })
      // Give the manifest a moment to be written before we check it.
      await new Promise(resolve => setTimeout(resolve, 100))
      const manifestTask = getBackgroundTask(dir, (await promise).taskId)
      expect(manifestTask).toBeTruthy()
      expect(manifestTask?.status).toMatch(/queued|running|failed|canceled/)
      expect(manifestTask?.worktree?.enabled).toBe(true)
      expect(manifestTask?.pr).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('background log reads are byte-bounded and preserve tail line semantics', async () => {
    const dir = tempDir('ur-nexus-log-bound-')
    try {
      const { task } = await startBackgroundTask({
        cwd: dir,
        task: 'inspect bounded logs',
        dryRun: true,
      })
      writeFileSync(
        task.logFile,
        'discarded-prefix\nkept-one\nkept-two\n',
      )

      const bounded = readBackgroundLog(dir, task.id, undefined, 24)
      expect(bounded).not.toBeNull()
      expect(Buffer.byteLength(bounded!)).toBeLessThanOrEqual(24)
      expect(bounded).not.toContain('discarded-prefix')
      expect(bounded).toContain('kept-two')
      expect(readBackgroundLog(dir, task.id, 2)).toBe(
        'kept-one\nkept-two\n',
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('background manifests are private and cannot redirect task artifacts', async () => {
    const dir = tempDir('ur-nexus-manifest-hardening-')
    try {
      const { task } = await startBackgroundTask({
        cwd: dir,
        task: 'inspect manifest boundaries',
        dryRun: true,
      })
      const manifestPath = join(dir, '.ur', 'background', 'tasks.json')
      if (process.platform !== 'win32') {
        expect(statSync(manifestPath).mode & 0o777).toBe(0o600)
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      manifest.tasks[0].logFile = '/etc/passwd'
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      writeFileSync(task.logFile, 'owned task log\n')

      expect(readBackgroundLog(dir, task.id)).toBe('owned task log\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('corrupt background manifests fail visibly instead of being overwritten', async () => {
    const dir = tempDir('ur-nexus-manifest-corrupt-')
    try {
      await startBackgroundTask({
        cwd: dir,
        task: 'seed manifest',
        dryRun: true,
      })
      const manifestPath = join(dir, '.ur', 'background', 'tasks.json')
      writeFileSync(manifestPath, '{broken')
      expect(() => getBackgroundTask(dir, 'bg_missing')).toThrow(
        'Background task manifest is invalid',
      )
      await expect(
        startBackgroundTask({ cwd: dir, task: 'must not overwrite', dryRun: true }),
      ).rejects.toThrow('Background task manifest is invalid')
      expect(readFileSync(manifestPath, 'utf8')).toBe('{broken')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('runAgentSkill summary shape includes worktree path when available', async () => {
    const dir = tempDir('ur-nexus-skill-')
    try {
      const result = await runAgentSkill({
        cwd: dir,
        skill: 'security-review',
        prompt: 'audit auth',
        dryRun: true,
        pollMs: 50,
      })
      expect(result.worktreePath).toBeTruthy()
      expect(existsSync(result.worktreePath!)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('each agent skill task receives a distinct worktree without automatic PR publishing', async () => {
    const dir = tempDir('ur-nexus-skill-isolation-')
    try {
      const first = await runAgentSkill({
        cwd: dir,
        skill: 'debug-v2',
        prompt: 'fix parser bug',
        dryRun: true,
        pollMs: 50,
      })
      const second = await runAgentSkill({
        cwd: dir,
        skill: 'refactor',
        prompt: 'refactor parser helpers',
        dryRun: true,
        pollMs: 50,
      })

      expect(first.taskId).not.toBe(second.taskId)
      expect(first.branch).not.toBe(second.branch)
      expect(first.worktreePath).not.toBe(second.worktreePath)

      const firstTask = getBackgroundTask(dir, first.taskId)
      const secondTask = getBackgroundTask(dir, second.taskId)
      expect(firstTask?.worktree?.enabled).toBe(true)
      expect(secondTask?.worktree?.enabled).toBe(true)
      expect(firstTask?.pr).toBeUndefined()
      expect(secondTask?.pr).toBeUndefined()
      expect(firstTask?.worktree?.path).toContain('.ur/worktrees/')
      expect(secondTask?.worktree?.path).toContain('.ur/worktrees/')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('PR creation remains available only through an explicit createPr option', () => {
    const dir = tempDir('ur-nexus-skill-pr-')
    try {
      const preview = previewAgentSkill({ cwd: dir, skill: 'debug', prompt: 'fix', createPr: true })
      expect(getBackgroundTask(dir, preview.id)?.pr?.enabled).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
