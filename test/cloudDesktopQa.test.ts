import { describe, expect, spyOn, test } from 'bun:test'
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cancelCloudTask,
  claimCloudTaskForWorkerSpawn,
  cloudWorkerEnvironment,
  createCloudTask,
  formatCloudTasks,
  getCloudTask,
  isSafeManagedBranch,
  loadCloudManifest,
  readCloudLog,
  reconcileManagedCloudTask,
  recordCloudWorkerPid,
  runCloudWorker,
  startManagedCloudTask,
  steerCloudTask,
} from '../src/services/agents/cloudTasks.js'
import type { ManagedCloudClient } from '../src/services/agents/cloudManagedRunner.js'
import { verdictFromOutput } from '../src/services/agents/cloudManagedRunner.js'
import {
  createBackgroundTask,
  readBackgroundInbox,
  steerBackgroundTask,
} from '../src/services/agents/backgroundRunner.js'
import {
  buildDesktopQaEnvironment,
  type DesktopQaDriver,
  type DesktopQaDriverSession,
} from '../src/services/qa/electronDesktopQaDriver.js'
import {
  runDesktopQaFixture,
  type DesktopQaReport,
  validateDesktopQaFixture,
} from '../src/services/qa/desktopQa.js'
import {
  parseDesktopQaFixture,
  type DesktopQaFixture,
  type DesktopQaFixtureInput,
} from '../src/services/qa/desktopQaSchema.js'
import {
  openArtifactAttachment,
  recordArtifact,
  type Artifact,
} from '../src/services/agents/artifacts.js'
import { handleArtifactsRequest } from '../src/services/agents/artifactsServer.js'
import {
  handleA2ARequest,
  type ServeOptions,
} from '../src/services/agents/a2aServer.js'
import { mintDelegationToken } from '../src/services/agents/delegation.js'
import { runDesktopQaCommand } from '../src/commands/desktop-qa/desktop-qa.js'
import { runCloudCommand } from '../src/commands/cloud/cloud.js'

function temporary(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function managedClient(
  overrides: Partial<ManagedCloudClient> = {},
): ManagedCloudClient {
  return {
    start: async input => ({
      sessionId: `session-${input.candidateId}`,
      title: input.candidateId,
    }),
    inspect: async () => ({ status: 'running' }),
    steer: async () => true,
    cancel: async () => undefined,
    ...overrides,
  }
}

describe('managed cloud lifecycle and state safety', () => {
  test('migrates v1 manifests and drops invalid persisted permission modes', () => {
    const cwd = temporary('ur-cloud-v1-')
    try {
      mkdirSync(join(cwd, '.ur', 'cloud'), { recursive: true })
      writeFileSync(
        join(cwd, '.ur', 'cloud', 'manifest.json'),
        JSON.stringify({
          version: 1,
          tasks: [
            {
              id: 'legacy',
              task: 'legacy task',
              attempts: 3,
              status: 'queued',
              permissionMode: 'made-up-mode',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      )
      const manifest = loadCloudManifest(cwd)
      expect(manifest.version).toBe(2)
      expect(manifest.tasks[0]?.runner).toBe('local')
      expect(manifest.tasks[0]?.permissionMode).toBeUndefined()
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('reserves steering ids before I/O and delivers a concurrent retry at most once', async () => {
    const cwd = temporary('ur-cloud-steer-')
    let release!: () => void
    const gate = new Promise<void>(resolvePromise => {
      release = resolvePromise
    })
    let deliveries = 0
    const client = managedClient({
      steer: async () => {
        deliveries++
        await gate
        return true
      },
    })
    try {
      const task = createCloudTask(cwd, {
        task: 'managed work',
        attempts: 1,
        runner: 'managed',
      })
      await startManagedCloudTask(cwd, task.id, client)
      const firstPromise = steerCloudTask(cwd, task.id, 'new direction', {
        requestId: 'request-1',
        client,
      })
      await new Promise(resolvePromise => setTimeout(resolvePromise, 0))
      const concurrent = await steerCloudTask(
        cwd,
        task.id,
        'new direction',
        { requestId: 'request-1', client },
      )
      expect(concurrent.accepted).toBe(false)
      expect(concurrent.duplicate).toBe(true)
      expect(concurrent.reason).toContain('in progress')
      release()
      expect((await firstPromise).accepted).toBe(true)
      const retry = await steerCloudTask(cwd, task.id, 'new direction', {
        requestId: 'request-1',
        client,
      })
      expect(retry.accepted).toBe(true)
      expect(retry.duplicate).toBe(true)
      expect(deliveries).toBe(1)
    } finally {
      release?.()
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('cancels a managed session that finishes starting after task cancellation', async () => {
    const cwd = temporary('ur-cloud-cancel-start-')
    let releaseStart!: () => void
    let markStarted!: () => void
    const startGate = new Promise<void>(resolvePromise => {
      releaseStart = resolvePromise
    })
    const startCalled = new Promise<void>(resolvePromise => {
      markStarted = resolvePromise
    })
    const canceled: string[] = []
    const client = managedClient({
      start: async input => {
        markStarted()
        await startGate
        return {
          sessionId: `session-${input.candidateId}`,
          title: input.candidateId,
        }
      },
      cancel: async sessionId => {
        canceled.push(sessionId)
      },
    })
    try {
      const task = createCloudTask(cwd, {
        task: 'cancel during startup',
        attempts: 1,
        runner: 'managed',
      })
      const starting = startManagedCloudTask(cwd, task.id, client)
      await startCalled
      await cancelCloudTask(cwd, task.id, client)
      releaseStart()
      const result = await starting
      expect(result.status).toBe('canceled')
      expect(canceled).toEqual(['session-c1'])
      expect(getCloudTask(cwd, task.id)?.status).toBe('canceled')
    } finally {
      releaseStart?.()
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('persists managed cancellation before waiting for remote cancellation', async () => {
    const cwd = temporary('ur-cloud-cancel-remote-')
    let releaseCancel!: () => void
    let markCancelCalled!: () => void
    const cancelGate = new Promise<void>(resolvePromise => {
      releaseCancel = resolvePromise
    })
    const cancelCalled = new Promise<void>(resolvePromise => {
      markCancelCalled = resolvePromise
    })
    const client = managedClient({
      cancel: async () => {
        markCancelCalled()
        await cancelGate
      },
    })
    let cancellation: ReturnType<typeof cancelCloudTask> | undefined
    try {
      const task = createCloudTask(cwd, {
        task: 'cancel remote atomically',
        attempts: 1,
        runner: 'managed',
      })
      await startManagedCloudTask(cwd, task.id, client)
      cancellation = cancelCloudTask(cwd, task.id, client)
      await cancelCalled
      expect(getCloudTask(cwd, task.id)?.status).toBe('canceled')
      expect(
        (await reconcileManagedCloudTask(cwd, task.id, client))?.status,
      ).toBe('canceled')
      releaseCancel()
      expect((await cancellation)?.status).toBe('canceled')
    } finally {
      releaseCancel?.()
      await cancellation?.catch(() => undefined)
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('redacts managed output and requires a PASS result to select a winner', async () => {
    const secret = 'managed-secret-123456'
    const previous = process.env.UR_TEST_API_KEY
    process.env.UR_TEST_API_KEY = secret
    const passingCwd = temporary('ur-cloud-pass-')
    const failClosedCwd = temporary('ur-cloud-fail-')
    try {
      const passing = createCloudTask(passingCwd, {
        task: 'managed pass',
        attempts: 1,
        runner: 'managed',
      })
      const passingClient = managedClient({
        inspect: async () => ({
          status: 'completed',
          output: `token=${secret}\nVERDICT: PASS`,
          verdict: 'PASS',
          branch: 'review/managed-pass',
        }),
      })
      await startManagedCloudTask(passingCwd, passing.id, passingClient)
      const passed = await reconcileManagedCloudTask(
        passingCwd,
        passing.id,
        passingClient,
      )
      expect(passed?.status).toBe('done')
      expect(JSON.stringify(passed)).not.toContain(secret)
      expect(readCloudLog(passingCwd, passing.id)).not.toContain(secret)

      const incomplete = createCloudTask(failClosedCwd, {
        task: 'managed without verdict',
        attempts: 1,
        runner: 'managed',
      })
      const incompleteClient = managedClient({
        inspect: async () => ({
          status: 'completed',
          output: 'session stopped without a completion verdict',
          verdict: null,
          branch: 'review/missing-verdict',
        }),
      })
      await startManagedCloudTask(
        failClosedCwd,
        incomplete.id,
        incompleteClient,
      )
      const failed = await reconcileManagedCloudTask(
        failClosedCwd,
        incomplete.id,
        incompleteClient,
      )
      expect(failed?.status).toBe('failed')
      expect(failed?.winner).toBeNull()
      expect(failed?.candidates?.[0]).toMatchObject({
        eligible: false,
        ineligibilityReason: 'verdict is missing',
      })
    } finally {
      if (previous === undefined) delete process.env.UR_TEST_API_KEY
      else process.env.UR_TEST_API_KEY = previous
      rmSync(passingCwd, { recursive: true, force: true })
      rmSync(failClosedCwd, { recursive: true, force: true })
    }
  })

  test('requires safe review branches and ranks every eligible PASS deterministically', async () => {
    const cwd = temporary('ur-cloud-rank-')
    const unsafeCwd = temporary('ur-cloud-unsafe-')
    try {
      const task = createCloudTask(cwd, {
        task: 'rank managed candidates',
        attempts: 3,
        runner: 'managed',
      })
      const manifestPath = join(cwd, '.ur', 'cloud', 'manifest.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        tasks: Array<{ candidates: unknown[] }>
      }
      manifest.tasks[0]!.candidates.reverse()
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      const client = managedClient({
        inspect: async sessionId => ({
          status: 'completed',
          output: 'VERDICT: PASS',
          verdict: 'PASS',
          branch: `review/${sessionId}`,
        }),
      })
      await startManagedCloudTask(cwd, task.id, client)
      const ranked = await reconcileManagedCloudTask(cwd, task.id, client)
      expect(ranked?.winner?.id).toBe('c1')
      expect(
        Object.fromEntries(
          (ranked?.candidates ?? []).map(candidate => [
            candidate.id,
            candidate.rank,
          ]),
        ),
      ).toEqual({ c3: 3, c2: 2, c1: 1 })
      expect(ranked?.candidates?.every(candidate => candidate.eligible)).toBe(
        true,
      )
      expect(formatCloudTasks([ranked!], false)).toContain('selected=c1')
      expect(formatCloudTasks([ranked!], false)).not.toContain('best-of')

      const unsafe = createCloudTask(unsafeCwd, {
        task: 'reject unsafe branch',
        attempts: 1,
        runner: 'managed',
      })
      const unsafeClient = managedClient({
        inspect: async () => ({
          status: 'completed',
          output: 'VERDICT: PASS',
          verdict: 'PASS',
          branch: '../unsafe',
        }),
      })
      await startManagedCloudTask(unsafeCwd, unsafe.id, unsafeClient)
      const rejected = await reconcileManagedCloudTask(
        unsafeCwd,
        unsafe.id,
        unsafeClient,
      )
      expect(rejected?.status).toBe('failed')
      expect(rejected?.winner).toBeNull()
      expect(rejected?.candidates?.[0]).toMatchObject({
        eligible: false,
        ineligibilityReason: 'unsafe review branch',
      })
      expect(isSafeManagedBranch('review/feature-1')).toBe(true)
      expect(isSafeManagedBranch('../unsafe')).toBe(false)
      expect(isSafeManagedBranch('review/.hidden')).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
      rmSync(unsafeCwd, { recursive: true, force: true })
    }
  })

  test('cloud workers preserve provider credentials but force nested subprocess scrubbing', () => {
    const environment = cloudWorkerEnvironment({
      OPENAI_API_KEY: 'provider-key',
      UR_CODE_SUBPROCESS_ENV_SCRUB: '0',
    })
    expect(environment.OPENAI_API_KEY).toBe('provider-key')
    expect(environment.UR_CODE_SUBPROCESS_ENV_SCRUB).toBe('1')
    expect(verdictFromOutput('remote session completed successfully')).toBeNull()
  })

  test('worker spawn bookkeeping and worker entry cannot resurrect cancellation', async () => {
    const cwd = temporary('ur-cloud-worker-cancel-')
    try {
      const task = createCloudTask(cwd, {
        task: 'cancel before worker records its pid',
        attempts: 1,
        runner: 'local',
      })
      expect(claimCloudTaskForWorkerSpawn(cwd, task.id)).toBe(true)
      await cancelCloudTask(cwd, task.id)
      expect(recordCloudWorkerPid(cwd, task.id, 12345)).toBe(false)
      await runCloudWorker(cwd, task.id)
      expect(getCloudTask(cwd, task.id)).toMatchObject({
        status: 'canceled',
      })
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('local cloud cancellation never signals a persisted worker PID', async () => {
    const cwd = temporary('ur-cloud-stale-worker-pid-')
    const kill = spyOn(process, 'kill').mockImplementation(() => true)
    try {
      const task = createCloudTask(cwd, {
        task: 'cancel without trusting stale process identity',
        attempts: 1,
        runner: 'local',
      })
      expect(claimCloudTaskForWorkerSpawn(cwd, task.id)).toBe(true)
      expect(recordCloudWorkerPid(cwd, task.id, 424_242)).toBe(true)

      const canceled = await cancelCloudTask(cwd, task.id)
      expect(canceled?.status).toBe('canceled')
      expect(canceled?.workerPid).toBeUndefined()
      expect(getCloudTask(cwd, task.id)?.workerPid).toBeUndefined()
      expect(kill).not.toHaveBeenCalled()
    } finally {
      kill.mockRestore()
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('rejects a symlinked cloud manifest', () => {
    const cwd = temporary('ur-cloud-link-')
    const outside = temporary('ur-cloud-outside-')
    try {
      mkdirSync(join(cwd, '.ur', 'cloud'), { recursive: true })
      const target = join(outside, 'manifest.json')
      writeFileSync(target, JSON.stringify({ version: 2, tasks: [] }))
      symlinkSync(target, join(cwd, '.ur', 'cloud', 'manifest.json'))
      expect(() => loadCloudManifest(cwd)).toThrow('Unsafe cloud state')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('bounded background steering', () => {
  test('deduplicates inbox entries and rejects malformed request ids', () => {
    const cwd = temporary('ur-bg-steer-')
    try {
      const task = createBackgroundTask({
        cwd,
        task: 'wait for steering',
        dryRun: true,
      })
      const first = steerBackgroundTask(cwd, task.id, 'adjust course', {
        requestId: 'message-1',
      })
      const retry = steerBackgroundTask(cwd, task.id, 'adjust course', {
        requestId: 'message-1',
      })
      const mismatchedRetry = steerBackgroundTask(
        cwd,
        task.id,
        'different course',
        { requestId: 'message-1' },
      )
      const invalid = steerBackgroundTask(cwd, task.id, 'adjust course', {
        requestId: '../bad',
      })
      expect(first.accepted).toBe(true)
      expect(retry.duplicate).toBe(true)
      expect(mismatchedRetry).toMatchObject({
        accepted: false,
        duplicate: true,
      })
      expect(invalid.accepted).toBe(false)
      expect(
        readBackgroundInbox(cwd, task.id)
          ?.trim()
          .split('\n'),
      ).toHaveLength(1)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe('cloud CLI gates automation failures', () => {
  test('sets a nonzero exit code for invalid, missing, rejected, apply, spawn, and worker failures', async () => {
    const cwd = temporary('ur-cloud-cli-')
    let exitCode = 0
    const setExitCode = (code: number): void => {
      exitCode = code
    }
    try {
      const invoke = async (
        args: string,
        dependencies: Parameters<typeof runCloudCommand>[2] = {},
      ) => {
        exitCode = 0
        const result = await runCloudCommand(args, cwd, {
          ...dependencies,
          setExitCode,
        })
        expect(exitCode).toBe(1)
        return result
      }

      await invoke('run task --runner unknown')
      await invoke('run task --runner')
      await invoke('run task --permission-mode unknown')
      await invoke('run task --permission-mode')
      await invoke('run task --runner local', {
        spawnWorker: () => null,
      })
      await invoke('show missing')
      await invoke('logs missing')
      await invoke('cancel missing')
      await invoke('steer missing --message adjust')

      const managed = createCloudTask(cwd, {
        task: 'managed without selection',
        attempts: 1,
        runner: 'managed',
      })
      await invoke(`apply ${managed.id}`)

      const local = createCloudTask(cwd, {
        task: 'local without winner',
        attempts: 2,
        runner: 'local',
      })
      await invoke(`apply ${local.id}`)

      const conflict = createCloudTask(cwd, {
        task: 'local apply conflict',
        attempts: 2,
        runner: 'local',
      })
      writeFileSync(
        join(cwd, '.ur', 'cloud', `${conflict.id}-result.json`),
        JSON.stringify({
          candidates: [],
          winner: {
            id: 'c1',
            verdict: 'PASS',
            diff: 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -0,0 +1 @@\n+x\n',
          },
        }),
      )
      const applyResult = await invoke(`apply ${conflict.id}`, {
        applyPatch: async () => ({
          code: 1,
          stdout: '',
          stderr: 'conflict',
        }),
      })
      expect(applyResult.type).toBe('text')
      if (applyResult.type === 'text') {
        expect(applyResult.value).toContain('git apply failed')
      }

      const failedWorker = createCloudTask(cwd, {
        task: 'persisted failed worker',
        attempts: 1,
        runner: 'local',
      })
      const manifestPath = join(cwd, '.ur', 'cloud', 'manifest.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        tasks: Array<{ id: string; status: string }>
      }
      const persistedWorker = manifest.tasks.find(
        task => task.id === failedWorker.id,
      )
      if (!persistedWorker) throw new Error('test cloud task was not persisted')
      persistedWorker.status = 'failed'
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      await invoke(`worker ${failedWorker.id}`, {
        runWorker: async () => undefined,
      })

      await invoke('worker worker-failure', {
        runWorker: async () => {
          throw new Error('worker exploded')
        },
      })
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

class FakeDesktopSession implements DesktopQaDriverSession {
  closed = false
  screenshotMasks: string[][] = []

  constructor(
    private readonly cwd: string,
    private readonly runDir: string,
    private readonly recording: DesktopQaFixture['recording'],
    private readonly failureAction?: 'click' | 'assertVisible',
    private readonly afterClose?: (cwd: string, runDir: string) => void,
  ) {}

  click(): Promise<void> {
    return this.failureAction === 'click'
      ? Promise.reject(new Error('click failed'))
      : Promise.resolve()
  }
  fill(): Promise<void> {
    return Promise.resolve()
  }
  press(): Promise<void> {
    return Promise.resolve()
  }
  select(): Promise<void> {
    return Promise.resolve()
  }
  check(): Promise<void> {
    return Promise.resolve()
  }
  waitFor(): Promise<void> {
    return Promise.resolve()
  }
  assertText(): Promise<void> {
    return Promise.resolve()
  }
  assertVisible(): Promise<void> {
    return this.failureAction === 'assertVisible'
      ? Promise.reject(new Error('not visible'))
      : Promise.resolve()
  }
  screenshot(
    path: string,
    options: { redactSelectors: string[] },
  ): Promise<void> {
    this.screenshotMasks.push([...options.redactSelectors])
    writeFileSync(path, Buffer.from('fake-png'))
    return Promise.resolve()
  }
  diagnostics() {
    return [
      {
        at: '2026-01-01T00:00:00.000Z',
        level: 'info' as const,
        source: 'renderer' as const,
        text: 'token=fixture-secret-123456',
      },
    ]
  }
  close(): Promise<void> {
    this.closed = true
    if (this.recording.trace) {
      writeFileSync(join(this.runDir, 'trace.zip'), 'trace')
    }
    if (this.recording.video) {
      mkdirSync(join(this.runDir, 'video'), { recursive: true })
      writeFileSync(join(this.runDir, 'video', 'run.webm'), 'video')
    }
    this.afterClose?.(this.cwd, this.runDir)
    return Promise.resolve()
  }
}

class FakeDesktopDriver implements DesktopQaDriver {
  readonly name = 'electron' as const
  session?: FakeDesktopSession

  constructor(
    private readonly failureAction?: 'click' | 'assertVisible',
    private readonly afterClose?: (cwd: string, runDir: string) => void,
  ) {}

  async launch(
    fixture: DesktopQaFixture,
    options: { cwd: string; runDir: string },
  ): Promise<DesktopQaDriverSession> {
    this.session = new FakeDesktopSession(
      options.cwd,
      options.runDir,
      fixture.recording,
      this.failureAction,
      this.afterClose,
    )
    return this.session
  }
}

function fixture(steps: DesktopQaFixtureInput['steps']): DesktopQaFixture {
  return parseDesktopQaFixture({
    version: 1,
    name: 'Desktop fixture',
    driver: 'electron',
    launch: { args: [], timeoutMs: 30_000 },
    steps,
    recording: {
      video: true,
      trace: true,
      screenshots: true,
      screenshotOnFailure: true,
      redactSelectors: [],
    },
    timeoutMs: 30_000,
  })
}

describe('desktop QA fixtures and evidence', () => {
  test('scrubs ambient credentials but permits explicit fixture env', () => {
    const environment = buildDesktopQaEnvironment(
      {
        PATH: '/bin',
        GITHUB_TOKEN: 'ambient-github',
        AWS_SECRET_ACCESS_KEY: 'ambient-aws',
        OPENAI_API_KEY: 'ambient-openai',
        SSH_AUTH_SOCK: '/tmp/agent.sock',
      },
      { OPENAI_API_KEY: 'explicit-fixture-value' },
    )
    expect(environment.PATH).toBe('/bin')
    expect(environment.GITHUB_TOKEN).toBeUndefined()
    expect(environment.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(environment.SSH_AUTH_SOCK).toBeUndefined()
    expect(environment.OPENAI_API_KEY).toBe('explicit-fixture-value')
  })

  test('refuses unmaskable raw recordings when selector redaction is configured', async () => {
    const cwd = temporary('ur-desktop-private-')
    const driver = new FakeDesktopDriver()
    try {
      const input = fixture([{ action: 'screenshot', name: 'masked' }])
      input.recording.redactSelectors = ['[data-sensitive]']
      const validation = validateDesktopQaFixture(input)
      expect(validation.valid).toBe(false)
      expect(validation.errors.join(' ')).toContain(
        'cannot be combined with raw',
      )
      await expect(
        runDesktopQaFixture(cwd, input, {
          driver,
          runId: 'raw-privacy-rejected',
        }),
      ).rejects.toThrow('retain masked screenshots')
      expect(driver.session).toBeUndefined()
      expect(
        existsSync(
          join(cwd, '.ur', 'desktop-qa', 'runs', 'raw-privacy-rejected'),
        ),
      ).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('retains masked screenshots when raw trace and video are disabled', async () => {
    const cwd = temporary('ur-desktop-masked-')
    const driver = new FakeDesktopDriver()
    try {
      const input = fixture([{ action: 'screenshot', name: 'masked' }])
      input.recording.video = false
      input.recording.trace = false
      input.recording.redactSelectors = ['[data-sensitive]']
      const result = await runDesktopQaFixture(cwd, input, {
        driver,
        runId: 'masked-run',
      })
      expect(result.report.status).toBe('passed')
      expect(
        result.artifact.attachments?.some(
          attachment => attachment.role === 'screenshot',
        ),
      ).toBe(true)
      expect(
        result.artifact.attachments?.some(
          attachment =>
            attachment.role === 'trace' || attachment.role === 'video',
        ),
      ).toBe(false)
      expect(driver.session?.screenshotMasks).toContainEqual([
        '[data-sensitive]',
      ])
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('discards unexpected raw driver evidence while selector masking is active', async () => {
    const cwd = temporary('ur-desktop-raw-driver-')
    const driver = new FakeDesktopDriver(undefined, (_workspace, runDir) => {
      writeFileSync(join(runDir, 'unexpected-trace.zip'), 'raw trace')
    })
    try {
      const input = fixture([{ action: 'screenshot', name: 'masked' }])
      input.recording.video = false
      input.recording.trace = false
      input.recording.redactSelectors = ['[data-sensitive]']
      await expect(
        runDesktopQaFixture(cwd, input, {
          driver,
          runId: 'unexpected-raw',
        }),
      ).rejects.toThrow('raw evidence was discarded')
      expect(driver.session?.closed).toBe(true)
      expect(
        existsSync(
          join(cwd, '.ur', 'desktop-qa', 'runs', 'unexpected-raw'),
        ),
      ).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('runs injected drivers, tears down, redacts, and attaches evidence', async () => {
    const cwd = temporary('ur-desktop-pass-')
    const driver = new FakeDesktopDriver()
    try {
      const result = await runDesktopQaFixture(
        cwd,
        fixture([
          { action: 'click', selector: '#go' },
          { action: 'screenshot', name: 'after-click', fullPage: false },
        ]),
        { driver, runId: 'passing-run' },
      )
      expect(result.report.status).toBe('passed')
      expect(driver.session?.closed).toBe(true)
      expect(JSON.stringify(result.report)).not.toContain(
        'fixture-secret-123456',
      )
      expect(result.artifact.attachments?.some(item => item.role === 'video')).toBe(
        true,
      )
      expect(result.artifact.attachments?.some(item => item.role === 'trace')).toBe(
        true,
      )
      expect(existsSync(join(cwd, '.ur', 'desktop-qa', 'runs', 'passing-run'))).toBe(
        false,
      )
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('captures failure evidence and still tears down', async () => {
    const cwd = temporary('ur-desktop-fail-')
    const driver = new FakeDesktopDriver('click')
    try {
      const result = await runDesktopQaFixture(
        cwd,
        fixture([{ action: 'click', selector: '#missing' }]),
        { driver, runId: 'failing-run' },
      )
      expect(result.report.status).toBe('failed')
      expect(result.report.steps[0]?.status).toBe('failed')
      expect(driver.session?.closed).toBe(true)
      expect(
        result.artifact.attachments?.some(
          item => item.role === 'screenshot',
        ),
      ).toBe(true)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('removes raw run evidence when artifact persistence throws', async () => {
    const cwd = temporary('ur-desktop-cleanup-')
    const outside = temporary('ur-desktop-artifacts-')
    const driver = new FakeDesktopDriver(undefined, workspace => {
      symlinkSync(outside, join(workspace, '.ur', 'artifacts'))
    })
    try {
      await expect(
        runDesktopQaFixture(
          cwd,
          fixture([{ action: 'screenshot', name: 'before-persist' }]),
          { driver, runId: 'persistence-failure' },
        ),
      ).rejects.toThrow('Unsafe artifact state directory')
      expect(driver.session?.closed).toBe(true)
      expect(
        existsSync(
          join(cwd, '.ur', 'desktop-qa', 'runs', 'persistence-failure'),
        ),
      ).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test('requires explicit opt-in for an outside-workspace executable', async () => {
    const cwd = temporary('ur-desktop-policy-')
    const outside = temporary('ur-desktop-binary-')
    const executable = join(outside, 'desktop-app')
    writeFileSync(executable, '#!/bin/sh\n')
    try {
      const input = fixture([{ action: 'wait', durationMs: 0 }])
      input.launch.executablePath = executable
      await expect(
        runDesktopQaFixture(cwd, input, {
          driver: new FakeDesktopDriver(),
        }),
      ).rejects.toThrow('--allow-external')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('artifact attachments', () => {
  test('copies evidence, serves a safe MIME type, and rejects symlink sources', async () => {
    const cwd = temporary('ur-art-attachment-')
    const source = join(cwd, 'screen.png')
    const link = join(cwd, 'linked.png')
    writeFileSync(source, 'image-bytes')
    symlinkSync(source, link)
    try {
      const artifact = recordArtifact(cwd, {
        kind: 'screenshot',
        title: 'screen',
        file: source,
        attachments: [
          {
            file: source,
            role: 'preview',
            mimeType: 'image/png\r\nx-injected: yes',
          },
        ],
      })
      const response = await handleArtifactsRequest(
        cwd,
        `/artifacts/${artifact.id}/attachments/1`,
      )
      expect(response.status).toBe(200)
      expect(response.type).toBe('application/octet-stream')
      expect(response.file).toBeDefined()
      const opened = openArtifactAttachment(
        response.file!.cwd,
        response.file!.path,
      )
      expect(opened).not.toBeNull()
      try {
        expect(readFileSync(opened!.fd, 'utf8')).toBe('image-bytes')
      } finally {
        closeSync(opened!.fd)
      }
      expect(() =>
        recordArtifact(cwd, {
          kind: 'screenshot',
          title: 'linked',
          file: link,
        }),
      ).toThrow('non-symlink')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe('owner-scoped A2A steering', () => {
  test('allows the owner and hides the task from another delegated subject', async () => {
    const cwd = temporary('ur-a2a-steer-')
    const secret = 'delegation-secret'
    const token = (subject: string) =>
      mintDelegationToken(secret, {
        subject,
        audience: 'ur-nexus',
        scope: ['coding-agent'],
      })
    const options: ServeOptions = {
      host: '127.0.0.1',
      port: 8765,
      cwd,
      dryRun: true,
      delegationSecret: secret,
      audience: 'ur-nexus',
    }
    const request = (
      path: string,
      subject: string,
      body: unknown,
    ): Request =>
      new Request(`http://127.0.0.1:8765${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token(subject)}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    try {
      const submittedResponse = await handleA2ARequest(
        request('/a2a/tasks', 'alice', {
          prompt: 'implement this',
          skill: 'coding-agent',
        }),
        options,
        'http://127.0.0.1:8765',
      )
      const submitted = (await submittedResponse.json()) as {
        task: { id: string }
      }
      const path = `/a2a/tasks/${submitted.task.id}/messages`
      const denied = await handleA2ARequest(
        request(path, 'bob', { message: 'malicious change' }),
        options,
        'http://127.0.0.1:8765',
      )
      expect(denied.status).toBe(404)
      const accepted = await handleA2ARequest(
        request(path, 'alice', {
          message: 'prioritize tests',
          requestId: 'owner-message-1',
        }),
        options,
        'http://127.0.0.1:8765',
      )
      expect(accepted.status).toBe(202)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe('desktop QA CLI gates CI', () => {
  const failedArtifact: Artifact = {
    id: '1',
    kind: 'test-run',
    title: 'failed',
    status: 'pending',
    feedback: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const failedReport: DesktopQaReport = {
    version: 1,
    id: 'failed',
    fixture: { name: 'failed', driver: 'electron', steps: 1 },
    status: 'failed',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1_000,
    steps: [],
    diagnostics: [],
    evidence: [],
    warnings: [],
    error: 'assertion failed',
  }

  test('sets a nonzero exit code for failed runs and unavailable drivers', async () => {
    const cwd = temporary('ur-desktop-cli-')
    let exitCode = 0
    try {
      const failed = await runDesktopQaCommand(
        'run fixture.json --json',
        cwd,
        {
          runFixture: async () => ({
            report: failedReport,
            artifact: failedArtifact,
          }),
          setExitCode: code => {
            exitCode = code
          },
        },
      )
      expect(exitCode).toBe(1)
      expect(failed.type).toBe('text')
      if (failed.type !== 'text') throw new Error('expected text result')
      expect(JSON.parse(failed.value).report.status).toBe('failed')

      exitCode = 0
      await runDesktopQaCommand('doctor --json', cwd, {
        driverAvailable: async () => false,
        setExitCode: code => {
          exitCode = code
        },
      })
      expect(exitCode).toBe(1)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
