import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call as agenticCiCall } from '../src/commands/agent-ci/agent-ci.js'
import { call as learnCall } from '../src/commands/learn/learn.js'
import { call as workspaceCall } from '../src/commands/workspace/workspace.js'
import {
  emptyStats,
  saveStats,
} from '../src/services/agents/learning.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'

test('Agentic CI init dry-run previews without creating files', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-agentic-ci-dry-run-'))
  try {
    const result = await runWithCwdOverride(cwd, () =>
      agenticCiCall('init audit --dry-run --json', {} as never),
    )
    expect(result.type).toBe('text')
    if (result.type !== 'text') throw new Error('expected text result')
    const payload = JSON.parse(result.value)
    expect(payload.dryRun).toBe(true)
    expect(payload.specCreated).toBe(true)
    expect(payload.workflowCreated).toBe(true)
    expect(existsSync(join(cwd, '.ur'))).toBe(false)
    expect(existsSync(join(cwd, '.github'))).toBe(false)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('learn apply dry-run proposes policy without saving it', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-learn-apply-dry-run-'))
  try {
    const stats = emptyStats()
    stats.models['model-x'] = { pass: 5, fail: 0 }
    stats.modelByCategory['model-x'] = {
      coding: { pass: 5, fail: 0 },
    }
    saveStats(cwd, stats)

    const result = await runWithCwdOverride(cwd, () =>
      learnCall('apply --dry-run --json', {} as never),
    )
    expect(result.type).toBe('text')
    if (result.type !== 'text') throw new Error('expected text result')
    const payload = JSON.parse(result.value)
    expect(payload).toMatchObject({
      dryRun: true,
      appliedOracle: null,
      proposedOracle: 'model-x',
    })
    expect(existsSync(join(cwd, '.ur', 'escalation.json'))).toBe(false)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('workspace init dry-run validates without creating state', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-workspace-init-dry-run-'))
  try {
    const result = await runWithCwdOverride(cwd, () =>
      workspaceCall('init audit --dry-run --json', {} as never),
    )
    expect(result.type).toBe('text')
    if (result.type !== 'text') throw new Error('expected text result')
    expect(JSON.parse(result.value)).toMatchObject({
      dryRun: true,
      spec: { name: 'audit', repositories: [], tasks: [] },
    })
    expect(existsSync(join(cwd, '.ur'))).toBe(false)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
