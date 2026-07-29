import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { call as modeCommand } from '../src/commands/mode/mode.ts'
import {
  getWorkingModePrompt,
  loadWorkingMode,
  saveWorkingMode,
  workingModePath,
} from '../src/services/agents/workingMode.js'
import { runWithCwdOverride } from '../src/utils/cwd.ts'

const dirs: string[] = []

function tempProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-working-mode-'))
  dirs.push(cwd)
  return cwd
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('working mode prompt', () => {
  test('defaults to code and provides executable guidance', () => {
    const cwd = tempProject()
    expect(loadWorkingMode(cwd)).toBe('code')
    expect(getWorkingModePrompt(cwd)).toContain('# Working mode: code')
    expect(getWorkingModePrompt(cwd)).toContain('inspect before editing')
  })

  test('loads a valid persisted mode into mode-specific guidance', () => {
    const cwd = tempProject()
    mkdirSync(join(cwd, '.ur'), { recursive: true })
    writeFileSync(workingModePath(cwd), 'research\n')
    const prompt = getWorkingModePrompt(cwd)
    expect(loadWorkingMode(cwd)).toBe('research')
    expect(prompt).toContain('# Working mode: research')
    expect(prompt).toContain('prefer primary sources')
    expect(prompt).toContain('distinguish observations from inference')
  })

  test('fails closed to code for a corrupt or unsupported marker', () => {
    const cwd = tempProject()
    mkdirSync(join(cwd, '.ur'), { recursive: true })
    writeFileSync(workingModePath(cwd), 'invented-mode\n')
    expect(loadWorkingMode(cwd)).toBe('code')
  })

  test('persists atomically and refuses symlinked project storage', () => {
    const cwd = tempProject()
    saveWorkingMode(cwd, 'debug')
    expect(loadWorkingMode(cwd)).toBe('debug')
    expect(readFileSync(workingModePath(cwd), 'utf8')).toBe('debug\n')

    const linked = tempProject()
    const outside = tempProject()
    symlinkSync(outside, join(linked, '.ur'))
    expect(() => saveWorkingMode(linked, 'research')).toThrow(
      'regular workspace directory',
    )
    expect(loadWorkingMode(linked)).toBe('code')
  })

  test('normal, minimal, and proactive prompt paths include working mode', () => {
    const source = readFileSync('src/constants/prompts.ts', 'utf8')
    expect(source.match(/getWorkingModePrompt\(/g)?.length).toBe(3)
    expect(source).toContain(
      "systemPromptSection('working_mode', () => getWorkingModePrompt(cwd))",
    )
  })

  test('mode command reports invalid input and persistence failures honestly', async () => {
    const cwd = tempProject()
    const invalid = await runWithCwdOverride(cwd, () =>
      modeCommand('invented', {} as never),
    )
    expect(invalid.exitCode).toBe(2)

    writeFileSync(join(cwd, '.ur'), 'blocks mode storage\n')
    const failed = await runWithCwdOverride(cwd, () =>
      modeCommand('research', {} as never),
    )
    expect(failed.exitCode).toBe(1)
    expect((failed as { value: string }).value).toContain(
      'Failed to set mode',
    )
  })
})
