import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { previewAgentSkill, runAgentSkill } from '../src/services/agents/agentSkillRunner.js'
import { getBackgroundTask } from '../src/services/agents/backgroundRunner.js'

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
