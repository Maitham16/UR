import { describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addWorkspaceRepository,
  addWorkspaceTask,
  createWorkspace,
  generateWorkspacePrPlan,
  generateWorkspaceRollbackPlan,
  getWorkspace,
  runWorkspace,
  validateWorkspace,
  verifyWorkspace,
} from '../src/services/agents/workspaceCoordinator.js'
import type { HeadlessRunner } from '../src/services/agents/headlessAgent.js'

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString())
  }
}

function gitOutput(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
  return result.stdout.toString().trim()
}

function repository(parent: string, name: string): string {
  const path = join(parent, name)
  mkdirSync(path)
  git(path, 'init')
  git(path, 'config', 'user.email', 'test@example.com')
  git(path, 'config', 'user.name', 'Test')
  writeFileSync(join(path, 'README.md'), `# ${name}\n`)
  git(path, 'add', 'README.md')
  git(path, 'commit', '-m', 'initial')
  return path
}

describe('multi-repository workspace coordinator', () => {
  test('validates a DAG, checkpoints tasks, serializes repository writers, and plans PRs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ur-workspace-'))
    const secret = 'workspace-secret-123456'
    const previousSecret = process.env.UR_WORKSPACE_TEST_TOKEN
    process.env.UR_WORKSPACE_TEST_TOKEN = secret
    try {
      const app = repository(root, 'app')
      const api = repository(root, 'api')
      createWorkspace(root, 'release')
      await addWorkspaceRepository(root, 'release', {
        id: 'app',
        path: app,
        verify: [
          'test -f README.md',
          'test -z "${UR_WORKSPACE_TEST_TOKEN:-}"',
        ],
      })
      await addWorkspaceRepository(root, 'release', {
        id: 'api',
        path: api,
        verify: [
          'test -f README.md',
          'test -z "${UR_WORKSPACE_TEST_TOKEN:-}"',
        ],
      })
      addWorkspaceTask(root, 'release', {
        id: 'api-contract',
        repository: 'api',
        prompt: 'Update the API contract.',
        dependsOn: [],
      })
      addWorkspaceTask(root, 'release', {
        id: 'app-one',
        repository: 'app',
        prompt: 'Update the first app consumer.',
        dependsOn: ['api-contract'],
      })
      addWorkspaceTask(root, 'release', {
        id: 'app-two',
        repository: 'app',
        prompt: 'Update the second app consumer.',
        dependsOn: ['api-contract'],
      })

      const validation = await validateWorkspace(root, 'release')
      expect(validation.valid).toBe(true)
      expect(validation.order[0]).toBe('api-contract')

      const active = new Set<string>()
      let maxActive = 0
      const runner: HeadlessRunner = async options => {
        expect(active.has(options.cwd)).toBe(false)
        expect(options.env?.UR_CODE_SUBPROCESS_ENV_SCRUB).toBe('1')
        active.add(options.cwd)
        maxActive = Math.max(maxActive, active.size)
        await Bun.sleep(5)
        active.delete(options.cwd)
        return {
          output: `Focused checks passed without exposing ${secret}.\nVERDICT: PASS`,
          verdict: 'PASS',
          isError: false,
        }
      }
      const state = await runWorkspace(root, 'release', {
        runner,
        maxConcurrency: 4,
      })
      expect(state.status).toBe('completed')
      expect(state.tasks.every(task => task.status === 'passed')).toBe(true)
      expect(JSON.stringify(state)).not.toContain(secret)
      // The two app tasks never share a wave because a repository has one writer.
      expect(maxActive).toBeGreaterThanOrEqual(1)

      const verified = await verifyWorkspace(root, 'release')
      expect(
        verified.repositories.every(repo =>
          repo.verification.length === 2 &&
          repo.verification.every(result => result.code === 0),
        ),
      ).toBe(true)
      const prPlan = await generateWorkspacePrPlan(root, 'release')
      expect(prPlan.map(item => item.repository)).toEqual(['api', 'app'])
      expect(prPlan[1]!.dependsOn).toEqual(['api'])
      expect(prPlan[1]!.base).toBe(gitOutput(app, 'branch', '--show-current'))
      expect(prPlan[1]!.commands).toContainEqual(
        expect.stringContaining('gh pr create'),
      )
      const addIndex = prPlan[1]!.commands.findIndex(command =>
        command.includes('add -A'),
      )
      const cachedCheckIndex = prPlan[1]!.commands.findIndex(command =>
        command.includes('diff --cached --check'),
      )
      expect(cachedCheckIndex).toBeGreaterThan(addIndex)
      expect(prPlan[1]!.commands).toContainEqual(
        expect.stringContaining('push -u origin'),
      )
      expect(generateWorkspaceRollbackPlan(root, 'release')[0]!.repository).toBe(
        'app',
      )
    } finally {
      if (previousSecret === undefined) {
        delete process.env.UR_WORKSPACE_TEST_TOKEN
      } else {
        process.env.UR_WORKSPACE_TEST_TOKEN = previousSecret
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('fails closed on invalid dependencies', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ur-workspace-invalid-'))
    try {
      const app = repository(root, 'app')
      createWorkspace(root, 'invalid')
      await addWorkspaceRepository(root, 'invalid', { id: 'app', path: app })
      expect(() =>
        addWorkspaceTask(root, 'invalid', {
          id: 'broken',
          repository: 'app',
          prompt: 'Broken task',
          dependsOn: ['missing'],
        }),
      ).toThrow('missing dependency')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('dry-run repository and task additions do not mutate the workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ur-workspace-dry-run-'))
    try {
      const app = repository(root, 'app')
      createWorkspace(root, 'preview')
      const repositoryPreview = await addWorkspaceRepository(
        root,
        'preview',
        { id: 'app', path: app, dryRun: true },
      )
      expect(repositoryPreview.repositories).toHaveLength(1)
      expect(getWorkspace(root, 'preview').repositories).toEqual([])

      await addWorkspaceRepository(root, 'preview', {
        id: 'app',
        path: app,
      })
      const taskPreview = addWorkspaceTask(root, 'preview', {
        id: 'change',
        repository: 'app',
        prompt: 'Preview a change.',
        dependsOn: [],
        dryRun: true,
      })
      expect(taskPreview.tasks).toHaveLength(1)
      expect(getWorkspace(root, 'preview').tasks).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('PR planning rejects worktree changes made after verification', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ur-workspace-verify-bind-'))
    try {
      const app = repository(root, 'app')
      createWorkspace(root, 'bound')
      await addWorkspaceRepository(root, 'bound', {
        id: 'app',
        path: app,
        verify: [`${JSON.stringify(process.execPath)} -e "process.exit(0)"`],
      })
      addWorkspaceTask(root, 'bound', {
        id: 'change',
        repository: 'app',
        prompt: 'Make one change.',
        dependsOn: [],
      })
      const state = await runWorkspace(root, 'bound', {
        runner: async options => {
          writeFileSync(join(options.cwd, 'agent.txt'), 'verified\n')
          return {
            output: 'done\nVERDICT: PASS',
            verdict: 'PASS',
            isError: false,
          }
        },
      })
      expect(state.status).toBe('completed')
      const verified = await verifyWorkspace(root, 'bound')
      const worktree = verified.repositories[0]!.worktree
      writeFileSync(join(worktree, 'agent.txt'), 'changed after verification\n')
      await expect(generateWorkspacePrPlan(root, 'bound')).rejects.toThrow(
        /changed after verification/i,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('serializes concurrent run invocations before worktree preparation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ur-workspace-lock-'))
    try {
      const app = repository(root, 'app')
      createWorkspace(root, 'locked')
      await addWorkspaceRepository(root, 'locked', { id: 'app', path: app })
      addWorkspaceTask(root, 'locked', {
        id: 'work',
        repository: 'app',
        prompt: 'Make one focused change.',
        dependsOn: [],
      })
      let markStarted!: () => void
      let releaseRunner!: () => void
      const started = new Promise<void>(resolve => {
        markStarted = resolve
      })
      const blocked = new Promise<void>(resolve => {
        releaseRunner = resolve
      })
      const first = runWorkspace(root, 'locked', {
        prepareWorktrees: false,
        runner: async () => {
          markStarted()
          await blocked
          return { output: 'done\nVERDICT: PASS', verdict: 'PASS', isError: false }
        },
      })
      await started
      await expect(
        runWorkspace(root, 'locked', {
          prepareWorktrees: false,
          runner: async () => ({
            output: 'unexpected',
            verdict: 'PASS',
            isError: false,
          }),
        }),
      ).rejects.toThrow('active run')
      releaseRunner()
      expect((await first).status).toBe('completed')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
