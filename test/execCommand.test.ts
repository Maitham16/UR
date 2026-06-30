import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call, readPrompts, runExecPool } from '../src/commands/exec/exec.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('ur exec command', () => {
  test('readPrompts returns positional prompts', async () => {
    const prompts = await readPrompts(['hello', 'world'])
    expect(prompts).toEqual(['hello', 'world'])
  })

  test('readPrompts reads prompts from JSONL file', async () => {
    const dir = tempDir('ur-exec-')
    try {
      const file = join(dir, 'prompts.jsonl')
      writeFileSync(file, '{"prompt": "one"}\n{"prompt": "two"}\nplain line\n')
      const prompts = await readPrompts(['--file', file])
      expect(prompts).toEqual(['one', 'two', 'plain line'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('runExecPool dry-run returns commands without spawning', () => {
    const dir = tempDir('ur-exec-')
    try {
      const results = runExecPool(['add tests', 'fix bug'], {
        cwd: dir,
        concurrency: 2,
        dryRun: true,
      })
      expect(results).toHaveLength(2)
      expect(results[0]!.dryRun).toBe(true)
      expect(results[0]!.command.join(' ')).toContain('-p')
      expect(results[0]!.command.join(' ')).toContain('add tests')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('call returns usage when no prompts provided', async () => {
    const result = await call('')
    expect(result.type).toBe('text')
    if (result.type === 'text') {
      expect(result.value).toContain('Usage:')
    }
  })

  test('call dry-runs multiple prompts with concurrency', async () => {
    const dir = tempDir('ur-exec-')
    try {
      const result = await runWithCwdOverride(dir, () =>
        call('"add tests" "fix bug" --concurrency 2 --dry-run --json'),
      )
      expect(result.type).toBe('text')
      if (result.type !== 'text') throw new Error('expected text')
      const parsed = JSON.parse(result.value) as Array<{ index: number; prompt: string; status: string }>
      expect(parsed).toHaveLength(2)
      expect(parsed[0]!.prompt).toBe('add tests')
      expect(parsed[1]!.prompt).toBe('fix bug')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
