import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..')

function isIgnored(path: string): boolean {
  return (
    spawnSync('git', ['check-ignore', '--no-index', '--quiet', path], {
      cwd: REPO,
      stdio: 'ignore',
    }).status === 0
  )
}

describe('project-local .ur state', () => {
  test('generated runtime files stay out of Git', () => {
    for (const path of [
      '.ur/code-index/repo.json',
      '.ur/research/projects/research.json',
      '.ur/repo-edit/index.json',
      '.ur/mcp-2026/tasks.json',
      '.ur/a2a/protocol-tasks.json',
      '.ur/openai-responses/state.json',
      '.ur/test-first/traces/failure.log',
      '.ur/workflows/.state/release.json',
      '.ur/learning/stats.json',
      '.ur/learning/stats.mutation-lock',
      '.ur/crew/release.mutation-lock',
      '.ur/threads/session.html',
      '.ur/automations/scheduler.log',
      '.ur/project-manifest.json',
      '.ur/scheduled_tasks.lock',
      '.ur/escalation.json',
      '.ur/mode',
    ]) {
      expect(isIgnored(path), path).toBe(true)
    }
  })

  test('shareable project definitions remain trackable', () => {
    for (const path of [
      '.ur/agents/reviewer.md',
      '.ur/skills/release/SKILL.md',
      '.ur/workflows/release.yaml',
      '.ur/goals/release.json',
      '.ur/specs/release/spec.json',
      '.ur/crew/release.json',
      '.ur/evidence/claims.json',
    ]) {
      expect(isIgnored(path), path).toBe(false)
    }
  })
})
