import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HeadlessRunner } from '../src/services/agents/headlessAgent.ts'
import { createSpec } from '../src/services/agents/spec.ts'
import {
  buildVerifierPrompt,
  loadVerificationRecord,
  runSpecVerification,
  saveVerificationRecord,
  type SpecVerifyRecord,
} from '../src/services/agents/specVerifier.ts'
import { evaluateVerificationProofs } from '../src/services/agents/verificationProofs.ts'

function allProofsOutput(): string {
  return [
    'Compile proof: command `bun run typecheck` exited 0; output: ok.',
    'Test proof: command `bun test` exited 0; output: all tests passed.',
    'Lint proof: command `bun run lint` exited 0; output: lint passed.',
    'Diff proof: command `git diff --stat` showed only expected files.',
    'Runtime proof: command `node ./bin/ur.js --version` exited 0.',
    'VERDICT: PASS',
  ].join('\n')
}

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('spec verifier', () => {
  test('dry-run verification previews without claiming execution proof', async () => {
    const dir = tempDir('ur-spec-verify-')
    createSpec(dir, 'auth-refactor', 'refactor login without changing behavior')
    const runner: HeadlessRunner = async () => ({
      output: allProofsOutput(),
      verdict: 'PASS',
      isError: false,
    })
    const result = await runSpecVerification(dir, 'auth-refactor', { dryRun: true, runner })
    expect(result.verdict).toBe('PARTIAL')
    expect(result.summary).toContain('proofs')
    expect(await loadVerificationRecord(dir, 'auth-refactor')).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  test('legacy verification records migrate without preserving an unsupported PASS', async () => {
    const dir = tempDir('ur-spec-record-')
    createSpec(dir, 'feat', 'do a thing')
    const record: SpecVerifyRecord = {
      version: 1,
      verdict: 'PASS',
      summary: 'ok',
      commandFailures: 0,
      generatedAt: new Date().toISOString(),
    }
    saveVerificationRecord(dir, 'feat', record)
    const loaded = await loadVerificationRecord(dir, 'feat')
    expect(loaded?.verdict).toBe('PARTIAL')
    expect(loaded?.legacyVerdict).toBe('PASS')
    expect(loaded?.version).toBe(2)
    expect(loaded?.summary).toContain('ok')
    rmSync(dir, { recursive: true, force: true })
  })

  test('prompt builder includes spec goal and diff', () => {
    const prompt = buildVerifierPrompt({
      spec: {
        version: 1,
        name: 'auth-refactor',
        goal: 'refactor login without changing behavior',
        phase: 'tasks',
        approvals: { requirements: true, design: true, tasks: false },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      requirements: 'keep behavior',
      design: 'split into modules',
      tasks: [
        { id: 'T1', title: 'extract helper', done: true },
        { id: 'T2', title: 'update tests', done: false },
      ],
      changedFiles: ['src/auth.ts'],
      diff: '+function login() {',
      priorVerifications: [],
    })
    expect(prompt).toContain('refactor login without changing behavior')
    expect(prompt).toContain('keep behavior')
    expect(prompt).toContain('split into modules')
    expect(prompt).toContain('T2: update tests')
    expect(prompt).toContain('src/auth.ts')
    expect(prompt).toContain('+function login()')
    expect(prompt).toContain('REQUIRED PROOFS')
  })

  test('PASS without required proofs is downgraded to FAIL', async () => {
    const dir = tempDir('ur-spec-proof-')
    createSpec(dir, 'feat', 'do a thing')
    const runner: HeadlessRunner = async () => ({
      output: 'looks good\nVERDICT: PASS',
      verdict: 'PASS',
      isError: false,
    })
    const result = await runSpecVerification(dir, 'feat', { runner })
    expect(result.verdict).toBe('FAIL')
    expect(result.commandFailures).toBe(1)
    expect(result.subagentOutput).toContain('PASS was claimed without required proof')
    expect((await loadVerificationRecord(dir, 'feat'))?.verdict).toBe('FAIL')
    rmSync(dir, { recursive: true, force: true })
  })

  test('proof evaluator requires compile, test, lint, diff, and runtime evidence', () => {
    const missing = evaluateVerificationProofs('Compile proof: command `tsc` exited 0.')
    expect(missing.ok).toBe(false)
    expect(missing.present).toEqual([])
    expect(missing.missing).toEqual(['compile', 'test', 'lint', 'diff', 'runtime'])

    const labelsOnly = evaluateVerificationProofs([
      'Compile proof',
      'Test proof',
      'Lint proof',
      'Diff proof',
      'Runtime proof',
      'VERDICT: PASS',
    ].join('\n'))
    expect(labelsOnly.ok).toBe(false)
    expect(labelsOnly.present).toEqual([])

    const complete = evaluateVerificationProofs(allProofsOutput())
    expect(complete.ok).toBe(false)
    expect(complete.present).toEqual([])
  })

  test('fails fast when deterministic gates fail', async () => {
    const dir = tempDir('ur-spec-gate-')
    createSpec(dir, 'feat', 'do a thing')
    writeFileSync(
      join(dir, '.ur', 'verify.json'),
      JSON.stringify({ afterEdit: ['exit 1'] }),
    )
    const runner: HeadlessRunner = async () => ({
      output: allProofsOutput(),
      verdict: 'PASS',
      isError: false,
    })
    const result = await runSpecVerification(dir, 'feat', { dryRun: false, runner })
    expect(result.verdict).toBe('FAIL')
    expect(result.gateResults).toHaveLength(1)
    expect(result.gateResults[0].ok).toBe(false)
    expect(result.commandFailures).toBe(1)
    expect((await loadVerificationRecord(dir, 'feat'))?.verdict).toBe('FAIL')
    rmSync(dir, { recursive: true, force: true })
  })

  test('no gates skips to subagent and persists result', async () => {
    const dir = tempDir('ur-spec-no-gate-')
    createSpec(dir, 'feat', 'do a thing')
    const runner: HeadlessRunner = async () => ({
      output: 'VERDICT: FAIL\nmissing runtime proof',
      verdict: 'FAIL',
      isError: false,
    })
    const result = await runSpecVerification(dir, 'feat', { runner })
    expect(result.verdict).toBe('FAIL')
    expect(result.summary).toContain('failing evidence')
    const loaded = await loadVerificationRecord(dir, 'feat')
    expect(loaded?.verdict).toBe('FAIL')
    expect(loaded?.commandFailures).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })
})
