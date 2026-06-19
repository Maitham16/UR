import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectDoneClaim, evaluateDoneGate } from '../src/services/verifier/doneDetector'
import { ToolEffectLedger } from '../src/services/verifier/ledger'
import { LoopDetector } from '../src/services/verifier/loopDetector'
import {
  loadVerifyConfig,
  pickCommands,
  runGateCommands,
} from '../src/services/verifier/projectGates'
import { Verifier } from '../src/services/verifier'

const TURN = '00000000-0000-0000-0000-000000000001'

function fakeToolUse(name: string, input: any, id = 'tu_1') {
  return { type: 'tool_use', id, name, input } as any
}

describe('ToolEffectLedger', () => {
  test('records mutating effects and ignores read-only', () => {
    const led = new ToolEffectLedger()
    led.record(TURN, fakeToolUse('Read', { file_path: '/a' }), true)
    led.record(TURN, fakeToolUse('Write', { file_path: '/b' }, 'tu_2'), true)
    expect(led.hasMutatingEffect(TURN)).toBe(true)
    expect(led.modifiedFiles(TURN)).toEqual(['/b'])
  })

  test('a failed Write does not count as a mutating effect', () => {
    const led = new ToolEffectLedger()
    led.record(TURN, fakeToolUse('Write', { file_path: '/b' }), false)
    expect(led.hasMutatingEffect(TURN)).toBe(false)
    expect(led.modifiedFiles(TURN)).toEqual([])
  })

  test('ranBash detects successful Bash only', () => {
    const led = new ToolEffectLedger()
    led.record(TURN, fakeToolUse('Bash', { command: 'ls' }), false)
    expect(led.ranBash(TURN)).toBe(false)
    led.record(TURN, fakeToolUse('Bash', { command: 'ls' }, 'tu_2'), true)
    expect(led.ranBash(TURN)).toBe(true)
  })
})

describe('detectDoneClaim', () => {
  test('matches I created / I wrote / I edited', () => {
    expect(detectDoneClaim('I created the file foo.ts')).toBe('write_claim')
    expect(detectDoneClaim("I've added a new module.")).toBe('write_claim')
    expect(detectDoneClaim('I edited the README.')).toBe('edit_claim')
    expect(detectDoneClaim('I fixed the bug.')).toBe('edit_claim')
  })

  test('matches I ran X', () => {
    expect(detectDoneClaim('I ran the tests.')).toBe('run_claim')
    expect(detectDoneClaim('I executed the migration.')).toBe('run_claim')
  })

  test('matches generic done phrases', () => {
    expect(detectDoneClaim('All done.')).toBe('generic_done')
    expect(detectDoneClaim('Task is complete.')).toBe('generic_done')
    expect(detectDoneClaim('That should fix it.')).toBe('generic_done')
  })

  test('does not fire on prose without a claim', () => {
    expect(detectDoneClaim('Here is what I found in the repo.')).toBeNull()
    expect(detectDoneClaim('')).toBeNull()
  })
})

describe('evaluateDoneGate', () => {
  test('write_claim with a mutating effect passes', () => {
    expect(evaluateDoneGate('write_claim', true, false).ok).toBe(true)
  })
  test('write_claim with no mutating effect fails with a reminder', () => {
    const r = evaluateDoneGate('write_claim', false, false)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reminder).toContain('Write')
  })
  test('run_claim requires a Bash success', () => {
    expect(evaluateDoneGate('run_claim', false, false).ok).toBe(false)
    expect(evaluateDoneGate('run_claim', false, true).ok).toBe(true)
  })
  test('generic_done passes if any side effect happened', () => {
    expect(evaluateDoneGate('generic_done', true, false).ok).toBe(true)
    expect(evaluateDoneGate('generic_done', false, true).ok).toBe(true)
    expect(evaluateDoneGate('generic_done', false, false).ok).toBe(false)
  })
})

describe('LoopDetector', () => {
  test('flags identical call after threshold repeats', () => {
    const d = new LoopDetector(3)
    expect(d.observe('Bash', { command: 'ls' })).toBeNull()
    expect(d.observe('Bash', { command: 'ls' })).toBeNull()
    const hit = d.observe('Bash', { command: 'ls' })
    expect(hit?.kind).toBe('repeat')
    if (hit?.kind === 'repeat') {
      expect(hit.toolName).toBe('Bash')
      expect(hit.count).toBe(3)
    }
  })

  test('different inputs reset the slot for that tool', () => {
    const d = new LoopDetector(3)
    d.observe('Bash', { command: 'ls' })
    d.observe('Bash', { command: 'ls' })
    // different command — should reset, no hit
    expect(d.observe('Bash', { command: 'pwd' })).toBeNull()
    expect(d.observe('Bash', { command: 'pwd' })).toBeNull()
    expect(d.observe('Bash', { command: 'pwd' })?.kind).toBe('repeat')
  })

  test('normalizes whitespace so trivially-different strings collapse', () => {
    const d = new LoopDetector(2)
    d.observe('Bash', { command: 'ls -la' })
    expect(d.observe('Bash', { command: '  ls -la  ' })?.kind).toBe('repeat')
  })

  test('parallel reads on different files do not trigger repeat', () => {
    const d = new LoopDetector(3)
    d.observe('Read', { file_path: '/a' })
    d.observe('Read', { file_path: '/b' })
    expect(d.observe('Read', { file_path: '/c' })).toBeNull()
  })

  test('checkEmptyTurn flags only when both text and tool calls absent', () => {
    const d = new LoopDetector()
    expect(d.checkEmptyTurn(false, false)?.kind).toBe('empty_turn')
    expect(d.checkEmptyTurn(true, false)).toBeNull()
    expect(d.checkEmptyTurn(false, true)).toBeNull()
  })
})

describe('projectGates', () => {
  test('loadVerifyConfig returns null when file is absent', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      const cfg = await loadVerifyConfig(cwd)
      expect(cfg).toBeNull()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('loadVerifyConfig parses a well-formed file', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      await mkdir(join(cwd, '.ur'), { recursive: true })
      await writeFile(
        join(cwd, '.ur', 'verify.json'),
        JSON.stringify({
          afterEdit: ['true'],
          ignorePatterns: ['**/*.md'],
          timeoutMs: 5000,
        }),
      )
      const cfg = await loadVerifyConfig(cwd)
      expect(cfg?.afterEdit).toEqual(['true'])
      expect(cfg?.ignorePatterns).toEqual(['**/*.md'])
      expect(cfg?.timeoutMs).toBe(5000)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('pickCommands picks afterEdit when files were modified', () => {
    const cmds = pickCommands(
      { afterEdit: ['lint'], afterBash: ['shellcheck'] },
      ['src/a.ts'],
      false,
    )
    expect(cmds).toEqual(['lint'])
  })

  test('pickCommands picks afterBash when only bash ran', () => {
    const cmds = pickCommands(
      { afterEdit: ['lint'], afterBash: ['shellcheck'] },
      [],
      true,
    )
    expect(cmds).toEqual(['shellcheck'])
  })

  test('pickCommands respects ignorePatterns', () => {
    const cmds = pickCommands(
      { afterEdit: ['lint'], ignorePatterns: ['**/*.md'] },
      ['docs/notes.md'],
      false,
    )
    expect(cmds).toBeNull()
  })

  test('runGateCommands returns ok on zero-exit', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      const r = await runGateCommands(['true'], cwd, 5000)
      expect(r.ok).toBe(true)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('runGateCommands returns reminder on non-zero exit', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      const r = await runGateCommands(['false'], cwd, 5000)
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.command).toBe('false')
        expect(r.reminder).toContain('FAILED')
      }
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('Verifier integration', () => {
  test('passes when the agent claimed work and actually did it', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      const v = new Verifier({ cwd })
      v.beginTurn(TURN)
      v.recordToolCall(TURN, fakeToolUse('Write', { file_path: '/x' }), true)
      const r = await v.checkTurn(TURN, 'I created the file.', true)
      expect(r.ok).toBe(true)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('rejects when the agent claims work but never wrote anything', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      const v = new Verifier({ cwd })
      v.beginTurn(TURN)
      const r = await v.checkTurn(TURN, 'I created the file.', false)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reminder).toContain('Write')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('rejects an empty turn', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      const v = new Verifier({ cwd })
      v.beginTurn(TURN)
      const r = await v.checkTurn(TURN, '', false)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reminder).toContain('Empty')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('bail-out after maxRejectionsPerTurn so the agent does not loop forever', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      const v = new Verifier({ cwd, maxRejectionsPerTurn: 2 })
      v.beginTurn(TURN)
      // First two empty turns rejected
      expect((await v.checkTurn(TURN, '', false)).ok).toBe(false)
      expect((await v.checkTurn(TURN, '', false)).ok).toBe(false)
      // Third should bail out and allow it through to surface to user
      expect((await v.checkTurn(TURN, '', false)).ok).toBe(true)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('runs project gate on file edits and rejects on non-zero exit', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      await mkdir(join(cwd, '.ur'), { recursive: true })
      await writeFile(
        join(cwd, '.ur', 'verify.json'),
        JSON.stringify({ afterEdit: ['false'] }),
      )
      const v = new Verifier({ cwd })
      v.beginTurn(TURN)
      v.recordToolCall(
        TURN,
        fakeToolUse('Write', { file_path: join(cwd, 'a.ts') }),
        true,
      )
      const r = await v.checkTurn(TURN, 'I created the file.', true)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reminder).toContain('FAILED')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('project gate passes when configured command exits zero', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      await mkdir(join(cwd, '.ur'), { recursive: true })
      await writeFile(
        join(cwd, '.ur', 'verify.json'),
        JSON.stringify({ afterEdit: ['true'] }),
      )
      const v = new Verifier({ cwd })
      v.beginTurn(TURN)
      v.recordToolCall(
        TURN,
        fakeToolUse('Write', { file_path: join(cwd, 'a.ts') }),
        true,
      )
      const r = await v.checkTurn(TURN, 'I created the file.', true)
      expect(r.ok).toBe(true)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('Verifier L2 subagent nudge', () => {
  test('nudges once when the turn modified files and no tool call is queued', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      const v = new Verifier({ cwd })
      v.beginTurn(TURN, 'please fix bug X')
      v.recordToolCall(TURN, fakeToolUse('Write', { file_path: '/a.ts' }), true)
      const nudge = v.shouldNudgeSubagent(TURN, false)
      expect(nudge).not.toBeNull()
      expect(nudge?.reminder).toContain('verification')
      expect(nudge?.reminder).toContain('/a.ts')
      expect(nudge?.reminder).toContain('please fix bug X')
      v.markSubagentNudged(TURN)
      // Second call returns null
      expect(v.shouldNudgeSubagent(TURN, false)).toBeNull()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('does not nudge when the turn still has tool calls queued', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      const v = new Verifier({ cwd })
      v.beginTurn(TURN)
      v.recordToolCall(TURN, fakeToolUse('Write', { file_path: '/a' }), true)
      expect(v.shouldNudgeSubagent(TURN, true)).toBeNull()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('does not nudge for read-only turns', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      const v = new Verifier({ cwd })
      v.beginTurn(TURN)
      v.recordToolCall(TURN, fakeToolUse('Read', { file_path: '/a' }), true)
      v.recordToolCall(TURN, fakeToolUse('Grep', { pattern: 'x' }, 'tu_2'), true)
      expect(v.shouldNudgeSubagent(TURN, false)).toBeNull()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('respects enableSubagentNudge=false', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      const v = new Verifier({ cwd, enableSubagentNudge: false })
      v.beginTurn(TURN)
      v.recordToolCall(TURN, fakeToolUse('Write', { file_path: '/a' }), true)
      expect(v.shouldNudgeSubagent(TURN, false)).toBeNull()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('nudge resets after endTurn so the next turn can nudge again', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      const v = new Verifier({ cwd })
      v.beginTurn(TURN)
      v.recordToolCall(TURN, fakeToolUse('Write', { file_path: '/a' }), true)
      v.markSubagentNudged(TURN)
      v.endTurn(TURN)
      v.beginTurn(TURN)
      v.recordToolCall(TURN, fakeToolUse('Write', { file_path: '/b' }, 'tu_2'), true)
      expect(v.shouldNudgeSubagent(TURN, false)).not.toBeNull()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('Verifier mode', () => {
  test('mode=off skips all checks and disables the nudge', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      const v = new Verifier({ cwd, mode: 'off' })
      v.beginTurn(TURN)
      // Lying about work in off mode passes
      const r = await v.checkTurn(TURN, 'I created the file.', false)
      expect(r.ok).toBe(true)
      // Empty turn passes too
      const r2 = await v.checkTurn(TURN, '', false)
      expect(r2.ok).toBe(true)
      // Nudge stays off even after a Write
      v.recordToolCall(TURN, fakeToolUse('Write', { file_path: '/a' }), true)
      expect(v.shouldNudgeSubagent(TURN, false)).toBeNull()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('mode=loose keeps empty-turn check but skips done-claim and project gates', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      await mkdir(join(cwd, '.ur'), { recursive: true })
      await writeFile(
        join(cwd, '.ur', 'verify.json'),
        JSON.stringify({ afterEdit: ['false'] }),
      )
      const v = new Verifier({ cwd, mode: 'loose' })
      v.beginTurn(TURN)
      // Lying about work — done-claim is OFF in loose, this passes
      const lyingResult = await v.checkTurn(TURN, 'I created the file.', false)
      expect(lyingResult.ok).toBe(true)
      // Empty turn still rejected
      const emptyResult = await v.checkTurn(TURN, '', false)
      expect(emptyResult.ok).toBe(false)
      // Project gates are off in loose — Write + failing gate command still passes
      v.recordToolCall(
        TURN,
        fakeToolUse('Write', { file_path: join(cwd, 'a.ts') }),
        true,
      )
      const gateResult = await v.checkTurn(TURN, 'edited file', true)
      expect(gateResult.ok).toBe(true)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('mode=loose still nudges the subagent on mutating turns', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      const v = new Verifier({ cwd, mode: 'loose' })
      v.beginTurn(TURN, 'fix bug X')
      v.recordToolCall(TURN, fakeToolUse('Write', { file_path: '/a' }), true)
      expect(v.shouldNudgeSubagent(TURN, false)).not.toBeNull()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
