import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call as workflowCommand } from '../src/commands/workflow/workflow.js'
import { runWorkflowSpec } from '../src/services/agents/runWorkflow.js'
import {
  approveWorkflowStep,
  loadRunState,
  MAX_PERSISTED_STEP_OUTPUT_BYTES,
  markStepComplete,
  markStepAwaitingApproval,
  resetRunState,
  saveWorkflow,
  setRunCompleted,
  type WorkflowSpec,
} from '../src/services/agents/workflows.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ur-workflow-safety-'))
}

const gatedWorkflow: WorkflowSpec = {
  version: 1,
  name: 'safe-release',
  steps: [
    {
      id: 'build',
      name: 'Build',
      agent: 'worker',
      prompt: 'build',
      checkpoint: true,
    },
    {
      id: 'ship',
      name: 'Ship',
      agent: 'worker',
      prompt: 'ship',
      dependsOn: ['build'],
      gate: 'approval',
    },
  ],
}

describe('durable workflow safety state', () => {
  test('resume restores dependency outputs without replaying completed steps', async () => {
    const cwd = tempDir()
    const workflow: WorkflowSpec = {
      version: 1,
      name: 'resume-outputs',
      steps: [
        {
          id: 'produce',
          name: 'Produce',
          agent: 'worker',
          prompt: 'produce artifact',
        },
        {
          id: 'consume',
          name: 'Consume',
          agent: 'worker',
          prompt: 'consume {{produce}}\nall prior: {{prior}}',
          dependsOn: ['produce'],
          gate: 'approval',
        },
      ],
    }

    const held = await runWorkflowSpec(workflow, {
      cwd,
      dryRun: true,
    })
    expect(held.status).toBe('held')
    const persistedOutput = held.steps.find(
      step => step.id === 'produce',
    )?.output
    expect(persistedOutput).toContain('produce artifact')
    expect(loadRunState(cwd, workflow.name)?.outputs?.produce).toBe(
      persistedOutput,
    )

    approveWorkflowStep(cwd, workflow.name, 'consume')
    const resumed = await runWorkflowSpec(workflow, {
      cwd,
      dryRun: true,
      resume: true,
    })

    expect(resumed.status).toBe('completed')
    expect(resumed.steps.find(step => step.id === 'produce')).toMatchObject({
      status: 'done',
      iterations: 0,
      output: persistedOutput,
    })
    const consumeOutput = resumed.steps.find(
      step => step.id === 'consume',
    )?.output
    expect(consumeOutput).toContain(`consume ${persistedOutput}`)
    expect(consumeOutput).toContain(`all prior: ${persistedOutput}`)
  })

  test('legacy resume fails closed when a required output is unavailable', async () => {
    const cwd = tempDir()
    const workflow: WorkflowSpec = {
      version: 1,
      name: 'legacy-output-gap',
      steps: [
        {
          id: 'produce',
          name: 'Produce',
          agent: 'worker',
          prompt: 'produce side effect',
        },
        {
          id: 'consume',
          name: 'Consume',
          agent: 'worker',
          prompt: 'consume {{produce}}',
          dependsOn: ['produce'],
          gate: 'approval',
        },
      ],
    }
    resetRunState(cwd, workflow.name)
    markStepComplete(cwd, workflow.name, 'produce')
    markStepAwaitingApproval(cwd, workflow.name, 'consume')
    approveWorkflowStep(cwd, workflow.name, 'consume')

    const resumed = await runWorkflowSpec(workflow, {
      cwd,
      dryRun: true,
      resume: true,
    })

    expect(resumed.status).toBe('failed')
    expect(resumed.steps.find(step => step.id === 'produce')).toMatchObject({
      status: 'done',
      iterations: 0,
    })
    expect(resumed.steps.find(step => step.id === 'consume')).toMatchObject({
      status: 'failed',
      iterations: 0,
    })
    expect(
      resumed.steps.find(step => step.id === 'consume')?.error,
    ).toContain('required persisted output is unavailable')
    expect(loadRunState(cwd, workflow.name)?.approved).not.toContain('consume')
  })

  test('oversized outputs are marked unavailable instead of truncated', () => {
    const cwd = tempDir()
    const oversized = 'x'.repeat(MAX_PERSISTED_STEP_OUTPUT_BYTES + 1)
    setRunCompleted(cwd, 'bounded-outputs', ['produce'], {
      produce: oversized,
    })

    const state = loadRunState(cwd, 'bounded-outputs')
    expect(state?.completed).toEqual(['produce'])
    expect(state?.outputs?.produce).toBeUndefined()
    expect(state?.unavailableOutputs).toContain('produce')
  })

  test('holds before execution, persists approval, and resumes safely', async () => {
    const cwd = tempDir()
    saveWorkflow(cwd, gatedWorkflow)

    const held = await runWorkflowSpec(gatedWorkflow, {
      cwd,
      stateName: gatedWorkflow.name,
      dryRun: true,
    })
    expect(held.status).toBe('held')
    expect(held.steps.find(step => step.id === 'ship')?.iterations).toBe(0)

    let state = loadRunState(cwd, gatedWorkflow.name)
    expect(state?.completed).toEqual(['build'])
    expect(state?.awaitingApproval).toBe('ship')
    expect(state?.status).toBe('held')
    expect(state?.checkpoints).toHaveLength(1)
    expect(state?.checkpoints?.[0]).toMatchObject({
      stepId: 'build',
      completed: ['build'],
    })

    approveWorkflowStep(cwd, gatedWorkflow.name, 'ship')
    state = loadRunState(cwd, gatedWorkflow.name)
    expect(state?.approved).toContain('ship')
    expect(state?.awaitingApproval).toBeUndefined()

    const resumed = await runWorkflowSpec(gatedWorkflow, {
      cwd,
      stateName: gatedWorkflow.name,
      dryRun: true,
      resume: true,
    })
    expect(resumed.status).toBe('completed')
    state = loadRunState(cwd, gatedWorkflow.name)
    expect(state?.completed).toEqual(['build', 'ship'])
    expect(state?.status).toBe('completed')
    expect(state?.approved).not.toContain('ship')
    // The ordinary recovery write for ship is not a semantic checkpoint.
    expect(state?.checkpoints?.map(checkpoint => checkpoint.stepId)).toEqual([
      'build',
    ])
  })

  test('approve action accepts only the currently held approval gate', async () => {
    const cwd = tempDir()
    saveWorkflow(cwd, gatedWorkflow)
    resetRunState(cwd, gatedWorkflow.name)
    markStepAwaitingApproval(cwd, gatedWorkflow.name, 'ship')

    let exitCode: number | undefined
    const context = {
      setExitCode: (code: number) => {
        exitCode = code
      },
    }
    const result = await runWithCwdOverride(cwd, () =>
      workflowCommand('approve safe-release ship', context as never),
    )
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.value).toContain('Resume safely')
    }
    expect(exitCode).toBeUndefined()
    expect(loadRunState(cwd, gatedWorkflow.name)?.approved).toContain('ship')

    const duplicate = await runWithCwdOverride(cwd, () =>
      workflowCommand('approve safe-release ship', context as never),
    )
    expect(duplicate.type).toBe('text')
    if (duplicate.type === 'text') {
      expect(duplicate.value).toContain('not awaiting approval')
    }
    expect(exitCode).toBe(1)
    expect(duplicate.exitCode).toBe(1)
  })

  test('manual done cannot bypass approval or verification gates', async () => {
    const cwd = tempDir()
    saveWorkflow(cwd, gatedWorkflow)
    resetRunState(cwd, gatedWorkflow.name)

    let exitCode: number | undefined
    const result = await runWithCwdOverride(cwd, () =>
      workflowCommand(
        'done safe-release ship',
        {
          setExitCode: (code: number) => {
            exitCode = code
          },
        } as never,
      ),
    )
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.value).toContain('cannot be bypassed')
    }
    expect(exitCode).toBe(1)
    expect(result.exitCode).toBe(1)
    expect(loadRunState(cwd, gatedWorkflow.name)?.completed).not.toContain(
      'ship',
    )
  })

  test('workflow run returns a failure exit status when approval is held', async () => {
    const cwd = tempDir()
    saveWorkflow(cwd, gatedWorkflow)
    let exitCode: number | undefined
    const result = await runWithCwdOverride(cwd, () =>
      workflowCommand(
        'run safe-release --dry-run',
        {
          setExitCode: (code: number) => {
            exitCode = code
          },
        } as never,
      ),
    )
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.value).toContain('Status: held')
    }
    expect(exitCode).toBe(1)
    expect(result.exitCode).toBe(1)
    expect(loadRunState(cwd, gatedWorkflow.name)?.awaitingApproval).toBe('ship')
  })

  test('manual completion cannot skip dependencies', async () => {
    const cwd = tempDir()
    const ordered: WorkflowSpec = {
      version: 1,
      name: 'ordered',
      steps: [
        {
          id: 'first',
          name: 'First',
          agent: 'worker',
          prompt: 'first',
          checkpoint: true,
        },
        {
          id: 'second',
          name: 'Second',
          agent: 'worker',
          prompt: 'second',
          dependsOn: ['first'],
        },
      ],
    }
    saveWorkflow(cwd, ordered)

    const result = await runWithCwdOverride(cwd, () =>
      workflowCommand('done ordered second', {} as never),
    )
    expect(result.exitCode).toBe(1)
    expect(
      (result as Extract<typeof result, { type: 'text' }>).value,
    ).toContain('before: first')
    expect(loadRunState(cwd, ordered.name)?.completed ?? []).not.toContain(
      'second',
    )

    const first = await runWithCwdOverride(cwd, () =>
      workflowCommand('done ordered first', {} as never),
    )
    expect(first.exitCode).toBeUndefined()
    expect(loadRunState(cwd, ordered.name)?.checkpoints?.map(item => item.stepId))
      .toEqual(['first'])

    const second = await runWithCwdOverride(cwd, () =>
      workflowCommand('done ordered second', {} as never),
    )
    expect(second.exitCode).toBeUndefined()
    expect(loadRunState(cwd, ordered.name)?.status).toBe('completed')
  })

  test('next previews structured metadata without imitating a tool call', async () => {
    const cwd = tempDir()
    saveWorkflow(cwd, gatedWorkflow)

    const result = await runWithCwdOverride(cwd, () =>
      workflowCommand('next safe-release', {} as never),
    )
    expect(result.type).toBe('text')
    const value = (result as Extract<typeof result, { type: 'text' }>).value
    expect(value).toContain('Agent type: worker')
    expect(value).toContain('This is step metadata, not a tool invocation.')
    expect(value).toContain('ur workflow run safe-release --resume')
    expect(value).not.toContain('Agent({')
  })

  test('resume rejects impossible downstream-only recovery state', async () => {
    const cwd = tempDir()
    saveWorkflow(cwd, gatedWorkflow)
    resetRunState(cwd, gatedWorkflow.name)
    markStepComplete(cwd, gatedWorkflow.name, 'ship')

    const resumed = await runWorkflowSpec(gatedWorkflow, {
      cwd,
      stateName: gatedWorkflow.name,
      dryRun: true,
      resume: true,
    })
    expect(resumed.status).toBe('held')
    expect(resumed.steps.find(step => step.id === 'build')?.iterations).toBe(1)
    expect(resumed.steps.find(step => step.id === 'ship')?.iterations).toBe(0)
    expect(loadRunState(cwd, gatedWorkflow.name)?.completed).toEqual(['build'])
  })

  test('invalid workflow limits return usage status 2', async () => {
    const cwd = tempDir()
    saveWorkflow(cwd, gatedWorkflow)
    const result = await runWithCwdOverride(cwd, () =>
      workflowCommand('run safe-release --concurrency nope', {} as never),
    )
    expect(result.exitCode).toBe(2)
    expect(
      (result as Extract<typeof result, { type: 'text' }>).value,
    ).toContain('positive integer')
  })

  test('loads legacy v1 state files without new optional fields', () => {
    const cwd = tempDir()
    const stateDir = join(cwd, '.ur', 'workflows', '.state')
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(
      join(stateDir, 'legacy.json'),
      `${JSON.stringify({
        version: 1,
        name: 'legacy',
        startedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        completed: ['one'],
      })}\n`,
    )
    expect(loadRunState(cwd, 'legacy')).toMatchObject({
      version: 1,
      completed: ['one'],
    })
  })
})
