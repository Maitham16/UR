import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  approveLearnedPlaybook,
  disableLearnedPlaybook,
  getLearnedPlaybook,
  learnedWorkflowLoop,
  loadApprovedLearnedWorkflow,
  mineLearnedPlaybooks,
  recommendedLearnedPlaybooks,
  rejectLearnedPlaybook,
  type MinedRun,
} from '../src/services/agents/learnedPlaybooks.js'
import { executeWorkflow } from '../src/services/agents/executor.js'
import {
  loadWorkflow,
  workflowPath,
} from '../src/services/agents/workflows.js'
import {
  appendRunAction,
  initializeResearchTrace,
} from '../src/services/agents/runArtifacts.js'

function run(id: string, command = 'bun test'): MinedRun {
  return {
    runId: id,
    task: 'fix the parser regression and verify the tests',
    manifestDigest: `sha256:${'a'.repeat(64)}`,
    passed: true,
    proofKinds: ['test'],
    actions: [
      {
        at: '2026-07-01T00:00:00.000Z',
        kind: 'inspect',
        title: 'inspect parser',
        status: 'passed',
      },
      {
        at: '2026-07-01T00:00:01.000Z',
        kind: 'edit',
        title: 'fix parser',
        status: 'passed',
      },
      {
        at: '2026-07-01T00:00:02.000Z',
        kind: 'test',
        title: 'verify tests',
        command,
        exitCode: 0,
        status: 'passed',
      },
    ],
  }
}

function seedRun(cwd: string, id: string, command = 'bun test'): void {
  const mined = run(id, command)
  initializeResearchTrace(cwd, id, { task: mined.task })
  for (const action of mined.actions) appendRunAction(cwd, id, action)
}

describe('learned playbooks', () => {
  test('mines repeated proof-backed runs and requires explicit approval', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ur-playbooks-'))
    try {
      seedRun(cwd, 'run1')
      seedRun(cwd, 'run2')
      seedRun(cwd, 'run3')
      const result = mineLearnedPlaybooks(cwd)
      expect(result.candidates).toHaveLength(1)
      const candidate = result.candidates[0]!
      expect(candidate.status).toBe('candidate')
      expect(candidate.metrics.pass).toBe(3)
      expect(existsSync(workflowPath(cwd, candidate.name))).toBe(false)

      const approved = approveLearnedPlaybook(
        cwd,
        candidate.id,
        'custom-parser-playbook',
      )
      expect(approved.status).toBe('approved')
      expect(existsSync(workflowPath(cwd, approved.name))).toBe(true)
      expect(recommendedLearnedPlaybooks(cwd, candidate.match.keywords.join(' '))).toHaveLength(1)
      mineLearnedPlaybooks(cwd)
      expect(getLearnedPlaybook(cwd, candidate.id)?.name).toBe(
        'custom-parser-playbook',
      )
      expect(loadApprovedLearnedWorkflow(cwd, candidate.id).name).toBe(
        'custom-parser-playbook',
      )
      expect(() =>
        rejectLearnedPlaybook(cwd, candidate.id, 'changed our mind'),
      ).toThrow('disable')

      expect(disableLearnedPlaybook(cwd, candidate.id).status).toBe('disabled')
      expect(getLearnedPlaybook(cwd, candidate.id)?.status).toBe('disabled')
      expect(existsSync(workflowPath(cwd, approved.name))).toBe(false)
      expect(loadWorkflow(cwd, approved.name)).toBeNull()
      expect(() => loadApprovedLearnedWorkflow(cwd, candidate.id)).toThrow(
        'not approved',
      )
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('rejects candidates and skips runs with dangerous side effects', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ur-playbooks-safe-'))
    try {
      seedRun(cwd, 'safe1')
      seedRun(cwd, 'safe2')
      seedRun(cwd, 'safe3')
      seedRun(cwd, 'unsafe', 'npm publish')
      const result = mineLearnedPlaybooks(cwd)
      expect(result.skippedUnsafeRuns).toEqual(['unsafe'])
      const rejected = rejectLearnedPlaybook(
        cwd,
        result.candidates[0]!.id,
        'not general enough',
      )
      expect(rejected.status).toBe('rejected')
      mineLearnedPlaybooks(cwd)
      expect(getLearnedPlaybook(cwd, rejected.id)?.status).toBe('rejected')
      expect(() => approveLearnedPlaybook(cwd, rejected.id)).toThrow()
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('dry-run previews lifecycle changes without mutating stores or workflows', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ur-playbooks-dry-run-'))
    try {
      seedRun(cwd, 'dry1')
      seedRun(cwd, 'dry2')
      seedRun(cwd, 'dry3')
      const candidate = mineLearnedPlaybooks(cwd).candidates[0]!

      const approval = approveLearnedPlaybook(
        cwd,
        candidate.id,
        'preview-workflow',
        { dryRun: true },
      )
      expect(approval.status).toBe('approved')
      expect(getLearnedPlaybook(cwd, candidate.id)?.status).toBe('candidate')
      expect(existsSync(workflowPath(cwd, 'preview-workflow'))).toBe(false)

      const rejection = rejectLearnedPlaybook(
        cwd,
        candidate.id,
        'preview only',
        { dryRun: true },
      )
      expect(rejection.status).toBe('rejected')
      expect(getLearnedPlaybook(cwd, candidate.id)?.status).toBe('candidate')

      const approved = approveLearnedPlaybook(cwd, candidate.id)
      const disabled = disableLearnedPlaybook(cwd, candidate.id, {
        dryRun: true,
      })
      expect(disabled.status).toBe('disabled')
      expect(getLearnedPlaybook(cwd, candidate.id)?.status).toBe('approved')
      expect(existsSync(workflowPath(cwd, approved.name))).toBe(true)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('does not treat a successful workflow finish event as proof', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ur-playbooks-finish-'))
    try {
      for (const id of ['finish1', 'finish2', 'finish3']) {
        initializeResearchTrace(cwd, id, {
          task: 'fix the parser regression and verify the tests',
        })
        appendRunAction(cwd, id, {
          at: '2026-07-01T00:00:00.000Z',
          kind: 'workflow-finish',
          title: 'finish',
          status: 'passed',
        })
      }
      expect(mineLearnedPlaybooks(cwd).candidates).toHaveLength(0)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('enforces verifier failure when running an approved workflow', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ur-playbooks-gate-'))
    try {
      seedRun(cwd, 'run1')
      seedRun(cwd, 'run2')
      seedRun(cwd, 'run3')
      const candidate = mineLearnedPlaybooks(cwd).candidates[0]!
      const approved = approveLearnedPlaybook(cwd, candidate.id)
      const workflow = loadApprovedLearnedWorkflow(cwd, approved.id)

      const result = await executeWorkflow(workflow, {
        loop: learnedWorkflowLoop(workflow),
        runStep: async ({ step }) =>
          step.gate === 'verification'
            ? { output: 'VERDICT: FAIL', verdict: 'FAIL' }
            : { output: `${step.id} complete` },
      })

      expect(result.status).toBe('max-iterations')
      expect(
        result.steps.find(step => step.id === 'verify')?.status,
      ).toBe('failed')
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
