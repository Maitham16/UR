import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  claimNextTask,
  createCrew,
  loadCrew,
  reopenClaimed,
  runCrew,
  sanitizeCrewName,
  type CrewEvent,
} from '../src/services/agents/crew.js'
import type { DecomposedTask } from '../src/services/agents/decomposer.js'
import { lockSync } from '../src/utils/lockfile.js'

function tempCrew(): string {
  return mkdtempSync(join(tmpdir(), 'ur-crew-recovery-'))
}

function decomposed(
  id: string,
  goal: string,
  dependsOn: string[] = [],
): DecomposedTask {
  return {
    id,
    goal,
    dependsOn,
    filesTouched: [],
    risk: 'low',
    testsRequired: ['unit test'],
    rollbackPoint: 'HEAD',
  }
}

describe('crew worker scheduling and recovery', () => {
  test('keeps crew and worktree identifiers bounded and non-empty', () => {
    expect(sanitizeCrewName('   ')).toBe('crew')
    const first = sanitizeCrewName(`review ${'x'.repeat(200)}`)
    const second = sanitizeCrewName(`review ${'x'.repeat(199)}y`)
    expect(first.length).toBeLessThanOrEqual(80)
    expect(second.length).toBeLessThanOrEqual(80)
    expect(first).not.toBe(second)
  })

  test('runs independent tasks concurrently', async () => {
    const cwd = tempCrew()
    try {
      createCrew(cwd, 'parallel', 'parallel work', {
        decomposed: [
          decomposed('left', 'Inspect left side'),
          decomposed('right', 'Inspect right side'),
        ],
      })
      let active = 0
      let peak = 0
      let started = 0
      let release: (() => void) | undefined
      const bothStarted = new Promise<void>(resolve => {
        release = resolve
      })

      const result = await runCrew('parallel', {
        cwd,
        workers: 2,
        runnerFor: () => async () => {
          active += 1
          peak = Math.max(peak, active)
          started += 1
          if (started === 2) release?.()
          await bothStarted
          active -= 1
          return { output: 'done', verdict: 'PASS' }
        },
      })

      expect(result.progress.done).toBe(2)
      expect(peak).toBe(2)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('serializes claims across separate CLI processes', async () => {
    const cwd = tempCrew()
    try {
      createCrew(cwd, 'cross-process', 'one task')
      const lockPath = join(
        cwd,
        '.ur',
        'crew',
        'cross-process.mutation-lock',
      )
      const release = lockSync(lockPath, { realpath: false, stale: 30_000 })
      const moduleUrl = new URL(
        '../src/services/agents/crew.ts',
        import.meta.url,
      ).href
      const child = Bun.spawn(
        [
          process.execPath,
          '-e',
          `import { claimNextTask } from ${JSON.stringify(moduleUrl)}; const task = claimNextTask(process.env.CREW_TEST_CWD, 'cross-process', 'child'); process.stdout.write(JSON.stringify(task));`,
        ],
        {
          env: { ...process.env, CREW_TEST_CWD: cwd },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )

      await new Promise(resolve => setTimeout(resolve, 50))
      release()
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])

      expect(exitCode, stderr).toBe(0)
      expect(JSON.parse(stdout).id).toBe('t1')
      expect(claimNextTask(cwd, 'cross-process', 'parent')).toBeNull()
      expect(
        readdirSync(join(cwd, '.ur', 'crew')).some(file => file.endsWith('.tmp')),
      ).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('waits for dependencies and supplies their outputs', async () => {
    const cwd = tempCrew()
    try {
      createCrew(cwd, 'ordered', 'ordered work', {
        decomposed: [
          decomposed('build', 'build the artifact'),
          decomposed('verify', 'verify the artifact', ['build']),
        ],
      })
      const order: string[] = []
      const result = await runCrew('ordered', {
        cwd,
        workers: 2,
        runnerFor: () => async input => {
          order.push(input.step.id)
          if (input.step.id === 'verify') {
            expect(input.priorOutputs).toEqual({ build: 'artifact ready' })
          }
          return {
            output: input.step.id === 'build' ? 'artifact ready' : 'verified',
            verdict: 'PASS',
          }
        },
      })

      expect(order).toEqual(['build', 'verify'])
      expect(result.progress.done).toBe(2)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('blocks dependents when a prerequisite fails', async () => {
    const cwd = tempCrew()
    try {
      createCrew(cwd, 'blocked', 'dependent work', {
        decomposed: [
          decomposed('compile', 'compile'),
          decomposed('publish', 'publish', ['compile']),
        ],
      })
      const seen: string[] = []
      const result = await runCrew('blocked', {
        cwd,
        workers: 2,
        runnerFor: () => async input => {
          seen.push(input.step.id)
          return { output: 'compile failed', verdict: 'FAIL' }
        },
      })

      expect(seen).toEqual(['compile'])
      expect(result.progress.failed).toBe(1)
      expect(result.progress.blocked).toBe(1)
      expect(loadCrew(cwd, 'blocked')?.tasks.find(task => task.id === 'publish')?.status)
        .toBe('blocked')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('respawns a crashed safe worker within the bounded attempt limit', async () => {
    const cwd = tempCrew()
    try {
      createCrew(cwd, 'retry', 'retry work')
      let processStarts = 0
      const events: CrewEvent[] = []
      const result = await runCrew('retry', {
        cwd,
        maxAttempts: 3,
        retryBackoffMs: 0,
        retrySafe: true,
        onEvent: event => events.push(event),
        runnerFor: () => {
          processStarts += 1
          return async () => {
            if (processStarts < 3) throw new Error(`crash ${processStarts}`)
            return { output: 'recovered', verdict: 'PASS' }
          }
        },
      })

      expect(processStarts).toBe(3)
      expect(events.filter(event => event.kind === 'retry')).toHaveLength(2)
      expect(result.handled).toEqual([
        { worker: 'w1', taskId: 't1', status: 'done', attempts: 3 },
      ])
      expect(loadCrew(cwd, 'retry')?.tasks[0]?.attempts).toBe(3)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('does not replay a failed shared-workspace attempt', async () => {
    const cwd = tempCrew()
    try {
      createCrew(cwd, 'unsafe', 'unsafe work')
      let starts = 0
      const events: CrewEvent[] = []
      const result = await runCrew('unsafe', {
        cwd,
        maxAttempts: 5,
        retryBackoffMs: 0,
        onEvent: event => events.push(event),
        runnerFor: () => async () => {
          starts += 1
          return { output: 'may have edited files', isError: true }
        },
      })

      expect(starts).toBe(1)
      expect(events.some(event => event.kind === 'retry-skipped')).toBe(true)
      expect(result.progress.failed).toBe(1)
      expect(result.handled[0]?.attempts).toBe(1)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('hard-caps retries even when the caller requests an excessive limit', async () => {
    const cwd = tempCrew()
    try {
      createCrew(cwd, 'bounded', 'bounded retry work')
      let starts = 0
      const result = await runCrew('bounded', {
        cwd,
        maxAttempts: 999,
        retryBackoffMs: 0,
        retrySafe: true,
        runnerFor: () => async () => {
          starts += 1
          throw new Error('persistent crash')
        },
      })

      expect(starts).toBe(5)
      expect(result.progress.failed).toBe(1)
      expect(result.handled[0]?.attempts).toBe(5)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('does not exceed the attempt budget after a manually reopened task', async () => {
    const cwd = tempCrew()
    try {
      createCrew(cwd, 'reopened-limit', 'bounded retry work')
      claimNextTask(cwd, 'reopened-limit', 'old-worker-1')
      reopenClaimed(cwd, 'reopened-limit')
      claimNextTask(cwd, 'reopened-limit', 'old-worker-2')
      reopenClaimed(cwd, 'reopened-limit')
      let starts = 0
      const result = await runCrew('reopened-limit', {
        cwd,
        maxAttempts: 2,
        retrySafe: true,
        runnerFor: () => async () => {
          starts += 1
          return { output: 'unexpected', verdict: 'PASS' }
        },
      })

      expect(starts).toBe(0)
      expect(result.progress.failed).toBe(1)
      expect(loadCrew(cwd, 'reopened-limit')?.tasks[0]?.attempts).toBe(2)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('cancellation stops a pending retry', async () => {
    const cwd = tempCrew()
    try {
      createCrew(cwd, 'cancel', 'cancel work')
      const controller = new AbortController()
      let starts = 0
      const result = await runCrew('cancel', {
        cwd,
        maxAttempts: 5,
        retryBackoffMs: 1_000,
        retrySafe: true,
        signal: controller.signal,
        onEvent: event => {
          if (event.kind === 'retry') controller.abort()
        },
        runnerFor: () => async () => {
          starts += 1
          return { output: 'temporary failure', isError: true }
        },
      })

      expect(starts).toBe(1)
      expect(result.progress.failed).toBe(1)
      expect(result.handled[0]?.attempts).toBe(1)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('does not automatically reopen an ambiguous task from a crashed run', async () => {
    const cwd = tempCrew()
    try {
      createCrew(cwd, 'orphan', 'orphan work')
      expect(claimNextTask(cwd, 'orphan', 'dead-worker')).not.toBeNull()
      let starts = 0
      const result = await runCrew('orphan', {
        cwd,
        runnerFor: () => async () => {
          starts += 1
          return { output: 'unexpected', verdict: 'PASS' }
        },
      })

      expect(starts).toBe(0)
      expect(result.progress.failed).toBe(1)
      expect(loadCrew(cwd, 'orphan')?.tasks[0]?.lastError).toContain(
        'automatic replay was refused',
      )
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('terminates dependency cycles as blocked work', async () => {
    const cwd = tempCrew()
    try {
      createCrew(cwd, 'cycle', 'cycle work', {
        decomposed: [
          decomposed('a', 'task a', ['b']),
          decomposed('b', 'task b', ['a']),
        ],
      })
      const result = await runCrew('cycle', {
        cwd,
        workers: 4,
        runnerFor: () => async () => ({ output: 'should not run', verdict: 'PASS' }),
      })

      expect(result.handled).toHaveLength(0)
      expect(result.progress.blocked).toBe(2)
      expect(result.progress.todo).toBe(0)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('dynamic mode also terminates an unresolvable dependency board', async () => {
    const cwd = tempCrew()
    try {
      createCrew(cwd, 'dynamic-cycle', 'cycle work', {
        decomposed: [
          decomposed('a', 'task a', ['b']),
          decomposed('b', 'task b', ['a']),
        ],
      })
      const result = await runCrew('dynamic-cycle', {
        cwd,
        dynamic: true,
        maxWorkers: 4,
        runnerFor: () => async () => ({ output: 'should not run', verdict: 'PASS' }),
      })

      expect(result.progress.blocked).toBe(2)
      expect(result.workers).toBe(1)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
