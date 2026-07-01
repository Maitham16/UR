import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HeadlessRunner } from '../src/services/agents/headlessAgent.ts'
import {
  AGENT_CONSTITUTION,
  buildFixPrompt,
  detectDeletionIntent,
  parseGitStatusChanges,
  detectPublicApiChanges,
  runCiLoop,
  splitCommand,
  summarizeFailure,
  type CommandExec,
} from '../src/services/agents/ciLoop.ts'
import {
  findSimilarFailures,
  formatFailureHints,
} from '../src/services/agents/failureMemory.ts'

async function withTempDir(fn: (dir: string) => void | Promise<void>): Promise<void> {
  const tempDir = mkdtempSync(join(tmpdir(), 'ur-ci-'))
  try {
    await fn(tempDir)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

describe('ciLoop', () => {
  test('splitCommand handles quotes and flags', () => {
    expect(splitCommand('bun test')).toEqual({ file: 'bun', args: ['test'] })
    expect(splitCommand('npm run test:ci -- --bail')).toEqual({
      file: 'npm',
      args: ['run', 'test:ci', '--', '--bail'],
    })
  })

  test('summarizeFailure surfaces error lines', () => {
    const log = ['compiling...', 'ok module a', 'Error: expected 2 to equal 3', 'at foo.ts:10'].join('\n')
    const summary = summarizeFailure(log)
    expect(summary).toContain('Error: expected 2 to equal 3')
  })

  test('parseGitStatusChanges detects actual deleted files from porcelain status', () => {
    expect(parseGitStatusChanges(' D src/old.ts\nD  src/staged.ts\n M src/index.ts\n')).toEqual([
      { status: ' D', path: 'src/old.ts', deleted: true },
      { status: 'D ', path: 'src/staged.ts', deleted: true },
      { status: ' M', path: 'src/index.ts', deleted: false },
    ])
  })

  test('runCiLoop heals: fail -> fix -> fail -> fix -> pass', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ur-ci-'))
    const codes = [1, 1, 0]
    let runIdx = 0
    let fixes = 0
    const exec: CommandExec = async () => {
      const code = codes[runIdx++] ?? 0
      return { code, stdout: code === 0 ? 'all good' : 'FAIL: boom', stderr: '' }
    }
    const runner: HeadlessRunner = async () => {
      fixes++
      return { output: 'patched', verdict: 'PASS', isError: false }
    }
    const result = await runCiLoop({ cwd: tmp, command: 'bun test', maxAttempts: 3, exec, runner })
    expect(result.status).toBe('passed')
    expect(result.attempts.length).toBe(3)
    expect(runIdx).toBe(3)
    expect(fixes).toBe(2)
    const failures = findSimilarFailures(tmp, 'bun test', 'FAIL: boom')
    expect(failures.some(record => record.attemptedFix?.includes('patched'))).toBe(true)
    expect(
      failures.some(record =>
        record.finalResolution?.includes('Command passed on attempt 3'),
      ),
    ).toBe(true)
    expect(formatFailureHints(failures)).toContain('resolution:')
    rmSync(tmp, { recursive: true, force: true })
  })

  test('runCiLoop exhausts the retry budget and records cannot-fix', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ur-ci-'))
    const exec: CommandExec = async () => ({ code: 1, stdout: 'still failing', stderr: '' })
    const runner: HeadlessRunner = async () => ({ output: 'tried', verdict: 'FAIL', isError: false })
    const result = await runCiLoop({ cwd: tmp, command: 'bun test', maxAttempts: 2, exec, runner })
    expect(result.status).toBe('cannot-fix')
    expect(result.cannotFixReason).toContain('still failed after 2 attempts')
    rmSync(tmp, { recursive: true, force: true })
  })

  test('runCiLoop does not trust a PASS verdict until the command reruns green', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ur-ci-'))
    const exec: CommandExec = async () => ({ code: 1, stdout: 'still failing after claimed fix', stderr: '' })
    const runner: HeadlessRunner = async () => ({ output: 'VERDICT: PASS', verdict: 'PASS', isError: false })
    const result = await runCiLoop({ cwd: tmp, command: 'bun test', maxAttempts: 2, exec, runner })
    expect(result.status).toBe('cannot-fix')
    expect(result.attempts).toHaveLength(2)
    expect(result.attempts[0].fixVerdict).toBe('PASS')
    rmSync(tmp, { recursive: true, force: true })
  })

  test('runCiLoop surfaces fix-agent failures as cannot-fix', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ur-ci-'))
    const exec: CommandExec = async () => ({ code: 1, stdout: 'FAIL', stderr: '' })
    const runner: HeadlessRunner = async () => ({
      output: 'Error: tool failed before editing',
      verdict: 'FAIL',
      isError: true,
    })
    const result = await runCiLoop({ cwd: tmp, command: 'bun test', maxAttempts: 2, exec, runner })
    expect(result.status).toBe('cannot-fix')
    expect(result.cannotFixReason).toContain('Fix agent failed')
    expect(result.cannotFixReason).toContain('tool failed')
    rmSync(tmp, { recursive: true, force: true })
  })

  test('runCiLoop dry-run does not execute', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ur-ci-'))
    let ran = false
    const exec: CommandExec = async () => {
      ran = true
      return { code: 0, stdout: '', stderr: '' }
    }
    const result = await runCiLoop({ cwd: tmp, command: 'bun test', dryRun: true, exec })
    expect(ran).toBe(false)
    expect(result.attempts[0].summary).toContain('[dry-run]')
    rmSync(tmp, { recursive: true, force: true })
  })

  test('buildFixPrompt embeds constitution and generated-file warning', () => {
    const prompt = buildFixPrompt('bun test', 'FAIL: boom')
    expect(prompt).toContain(AGENT_CONSTITUTION)
    expect(prompt).toContain('NEVER CLAIM TESTS PASSED')
    expect(prompt).toContain('Skip generated/vendor files')
    expect(prompt).toContain('VERDICT: PASS only if you actually ran')
  })

  test('buildFixPrompt omits generated warning when allowGenerated is true', () => {
    const prompt = buildFixPrompt('bun test', 'FAIL: boom', true)
    expect(prompt).toContain(AGENT_CONSTITUTION)
    expect(prompt).not.toContain('Skip generated/vendor files')
  })

  test('detectPublicApiChanges flags index and api-named files', () => {
    expect(detectPublicApiChanges(['src/index.ts', 'src/api.ts', 'src/internal/foo.ts'])).toEqual([
      'src/index.ts',
      'src/api.ts',
    ])
    expect(detectPublicApiChanges(['dist/index.js', 'src/core.ts'])).toEqual([])
  })

  test('runCiLoop blocks commit when generated files change without --allow-generated', async () => {
    await withTempDir(async tmp => {
      let addRan = false
      const exec: CommandExec = async () => ({ code: 1, stdout: 'FAIL', stderr: '' })
      const git: CommandExec = async (file, args) => {
        if (args[0] === 'status') {
          return { code: 0, stdout: ' M dist/cli.js\n M src/fix.ts\n', stderr: '' }
        }
        if (args[0] === 'diff') {
          return { code: 0, stdout: '', stderr: '' }
        }
        if (args[0] === 'add') {
          addRan = true
          return { code: 0, stdout: '', stderr: '' }
        }
        return { code: 0, stdout: '', stderr: '' }
      }
      const runner: HeadlessRunner = async () => ({ output: 'patched', verdict: 'PASS', isError: false })
      const result = await runCiLoop({
        cwd: tmp,
        command: 'bun test',
        maxAttempts: 2,
        exec,
        runner,
        git,
        commit: true,
        allowGenerated: false,
      })
      expect(result.status).toBe('blocked')
      expect(addRan).toBe(false)
    })
  })

  test('runCiLoop blocks generated/vendor edits even without commit mode', async () => {
    await withTempDir(async tmp => {
      let restoreRan = false
      const exec: CommandExec = async () => ({ code: 1, stdout: 'FAIL', stderr: '' })
      const git: CommandExec = async (file, args) => {
        if (args[0] === 'status') {
          return { code: 0, stdout: ' M dist/cli.js\n M src/fix.ts\n', stderr: '' }
        }
        if (args[0] === 'checkout') {
          restoreRan = true
          return { code: 0, stdout: '', stderr: '' }
        }
        if (args[0] === 'diff') {
          return { code: 0, stdout: '', stderr: '' }
        }
        return { code: 0, stdout: '', stderr: '' }
      }
      const runner: HeadlessRunner = async () => ({ output: 'patched', verdict: 'PASS', isError: false })
      const result = await runCiLoop({
        cwd: tmp,
        command: 'bun test',
        maxAttempts: 2,
        exec,
        runner,
        git,
        allowGenerated: false,
      })
      expect(result.status).toBe('blocked')
      expect(result.cannotFixReason).toContain('generated/vendor')
      expect(result.constitutionWarnings).toEqual(
        expect.arrayContaining([expect.stringContaining('dist/cli.js')]),
      )
      expect(restoreRan).toBe(true)
    })
  })

  test('runCiLoop blocks commit when public API files change', async () => {
    await withTempDir(async tmp => {
      let addRan = false
      const exec: CommandExec = async () => ({ code: 1, stdout: 'FAIL', stderr: '' })
      const git: CommandExec = async (file, args) => {
        if (args[0] === 'status') {
          return { code: 0, stdout: ' M src/index.ts\n M src/internal/foo.ts\n', stderr: '' }
        }
        if (args[0] === 'diff') {
          return { code: 0, stdout: '', stderr: '' }
        }
        if (args[0] === 'add') {
          addRan = true
          return { code: 0, stdout: '', stderr: '' }
        }
        return { code: 0, stdout: '', stderr: '' }
      }
      const runner: HeadlessRunner = async () => ({ output: 'patched', verdict: 'PASS', isError: false })
      const result = await runCiLoop({
        cwd: tmp,
        command: 'bun test',
        maxAttempts: 2,
        exec,
        runner,
        git,
        commit: true,
      })
      expect(result.status).toBe('blocked')
      expect(addRan).toBe(false)
    })
  })

  test('runCiLoop allows generated-file commit with --allow-generated', async () => {
    await withTempDir(async tmp => {
      let addRan = false
      const exec: CommandExec = async () => ({ code: 1, stdout: 'FAIL', stderr: '' })
      const git: CommandExec = async (file, args) => {
        if (args[0] === 'status') {
          return { code: 0, stdout: ' M dist/cli.js\n M src/fix.ts\n', stderr: '' }
        }
        if (args[0] === 'diff') {
          return { code: 0, stdout: '', stderr: '' }
        }
        if (args[0] === 'add') {
          addRan = true
          return { code: 0, stdout: '', stderr: '' }
        }
        if (args[0] === 'commit') {
          return { code: 0, stdout: '', stderr: '' }
        }
        return { code: 0, stdout: '', stderr: '' }
      }
      const runner: HeadlessRunner = async () => ({ output: 'patched', verdict: 'PASS', isError: false })
      const result = await runCiLoop({
        cwd: tmp,
        command: 'bun test',
        maxAttempts: 2,
        exec,
        runner,
        git,
        commit: true,
        allowGenerated: true,
      })
      expect(result.status).toBe('cannot-fix')
      expect(addRan).toBe(true)
    })
  })

  test('detectDeletionIntent catches rm, git rm, fs.unlink, rimraf', () => {
    expect(detectDeletionIntent('rm -rf node_modules').detected).toBe(true)
    expect(detectDeletionIntent('git rm src/foo.ts').detected).toBe(true)
    expect(detectDeletionIntent('fs.unlink("path")').detected).toBe(true)
    expect(detectDeletionIntent('rimraf dist').detected).toBe(true)
    expect(detectDeletionIntent('rewrite src/foo.ts').detected).toBe(false)
  })

  test('runCiLoop blocks deletion intent in fix output', async () => {
    await withTempDir(async tmp => {
      const exec: CommandExec = async () => ({ code: 1, stdout: 'FAIL', stderr: '' })
      const runner: HeadlessRunner = async () => ({
        output: 'I will delete the broken test with rm src/foo.test.ts',
        verdict: 'PASS',
        isError: false,
      })
      const result = await runCiLoop({ cwd: tmp, command: 'bun test', maxAttempts: 2, exec, runner })
      expect(result.status).toBe('blocked')
      expect(result.constitutionWarnings).toEqual(
        expect.arrayContaining([expect.stringContaining('rm src/foo.test.ts')]),
      )
    })
  })

  test('runCiLoop blocks actual deleted files even when the fix output does not mention deletion', async () => {
    await withTempDir(async tmp => {
      const exec: CommandExec = async () => ({ code: 1, stdout: 'FAIL', stderr: '' })
      const git: CommandExec = async (file, args) => {
        if (args[0] === 'status') {
          return { code: 0, stdout: ' D src/important.ts\n M src/fix.ts\n', stderr: '' }
        }
        if (args[0] === 'diff') {
          return { code: 0, stdout: '', stderr: '' }
        }
        return { code: 0, stdout: '', stderr: '' }
      }
      const runner: HeadlessRunner = async () => ({ output: 'patched the failing assertion', verdict: 'PASS', isError: false })
      const result = await runCiLoop({ cwd: tmp, command: 'bun test', maxAttempts: 2, exec, runner, git })
      expect(result.status).toBe('blocked')
      expect(result.cannotFixReason).toContain('deleted files without explicit approval')
      expect(result.constitutionWarnings).toEqual(
        expect.arrayContaining([expect.stringContaining('src/important.ts')]),
      )
    })
  })

  test('runCiLoop reports public API changes even when the rerun passes', async () => {
    await withTempDir(async tmp => {
      const codes = [1, 0]
      let runIdx = 0
      const exec: CommandExec = async () => {
        const code = codes[runIdx++] ?? 0
        return { code, stdout: code === 0 ? 'ok' : 'FAIL', stderr: '' }
      }
      const git: CommandExec = async (file, args) => {
        if (args[0] === 'status') {
          return { code: 0, stdout: ' M src/index.ts\n M src/internal/fix.ts\n', stderr: '' }
        }
        if (args[0] === 'diff') {
          return { code: 0, stdout: '', stderr: '' }
        }
        return { code: 0, stdout: '', stderr: '' }
      }
      const runner: HeadlessRunner = async () => ({ output: 'patched', verdict: 'PASS', isError: false })
      const result = await runCiLoop({ cwd: tmp, command: 'bun test', maxAttempts: 2, exec, runner, git })
      expect(result.status).toBe('passed')
      expect(result.constitutionWarnings).toEqual(
        expect.arrayContaining([expect.stringContaining('Public API surface changed')]),
      )
    })
  })

  test('runCiLoop records cannot-fix reason and artifact when exhausted', async () => {
    await withTempDir(async tmp => {
      const exec: CommandExec = async () => ({ code: 1, stdout: 'FAIL', stderr: '' })
      const runner: HeadlessRunner = async () => ({ output: 'tried', verdict: 'FAIL', isError: false })
      const result = await runCiLoop({ cwd: tmp, command: 'bun test', maxAttempts: 2, exec, runner })
      expect(result.status).toBe('cannot-fix')
      expect(result.cannotFixReason).toContain('still failed after 2 attempts')
      // Artifact path is recorded even though the file is not actually written in unit tests.
      expect(result.cannotFixReason).toBeTruthy()
    })
  })
})
