import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
const NEXT_TURN = '00000000-0000-0000-0000-000000000002'

function fakeToolUse(name: string, input: any, id = 'tu_1') {
  return { type: 'tool_use', id, name, input } as any
}

async function writeAutoGateProject(
  cwd: string,
  scripts: Record<string, string>,
): Promise<void> {
  await writeFile(join(cwd, 'package.json'), JSON.stringify({ scripts }))
  await writeFile(join(cwd, 'bun.lock'), '')
}

function appendGateScript(label: string): string {
  return `node -e "require('node:fs').appendFileSync('gate.log', '${label}\\n')"`
}

function failGateScript(message: string): string {
  return `node -e "process.stderr.write('${message}'); process.exit(7)"`
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

  test('matches an immediate file action promised at the end of a turn', () => {
    expect(detectDoneClaim('I have the details. Let me create it now.')).toBe(
      'write_intent',
    )
    expect(detectDoneClaim("Not yet. I'll fix the file now.")).toBe(
      'write_intent',
    )
    expect(detectDoneClaim('Writing it now.')).toBe('write_intent')
  })

  test('matches an immediate command promised at the end of a turn', () => {
    expect(detectDoneClaim('The implementation is ready. I will run the tests now.')).toBe(
      'run_intent',
    )
  })

  test('does not treat conditional or instructional prose as immediate intent', () => {
    expect(detectDoneClaim("If you approve, I'll create the file.")).toBeNull()
    expect(detectDoneClaim('You can create the file with Write.')).toBeNull()
    expect(detectDoneClaim("I'll create it after you provide the path.")).toBeNull()
  })
})

describe('evaluateDoneGate', () => {
  test('write_claim with a mutating effect passes', () => {
    expect(evaluateDoneGate('write_claim', true, false).ok).toBe(true)
  })
  test('write_claim with no mutating effect fails with a reminder', () => {
    const r = evaluateDoneGate('write_claim', false, false)
    expect(r.ok).toBe(false)
    if (r.ok === false) expect(r.reminder).toContain('Write')
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
  test('write_intent requires a mutating effect', () => {
    expect(evaluateDoneGate('write_intent', false, false).ok).toBe(false)
    expect(evaluateDoneGate('write_intent', true, false).ok).toBe(true)
  })
  test('run_intent requires a successful Bash call', () => {
    expect(evaluateDoneGate('run_intent', false, false).ok).toBe(false)
    expect(evaluateDoneGate('run_intent', false, true).ok).toBe(true)
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
      if (r.ok === false) {
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
      if (r.ok === false) expect(r.reminder).toContain('Write')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('rejects when the agent promises to write but ends without a tool call', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      const v = new Verifier({ cwd })
      v.beginTurn(TURN)
      const r = await v.checkTurn(TURN, 'Let me create index.html now.', false)
      expect(r.ok).toBe(false)
      if (r.ok === false) expect(r.reminder).toContain('actual tool call')
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
      if (r.ok === false) expect(r.reminder).toContain('Empty')
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
      if (r.ok === false) expect(r.reminder).toContain('FAILED')
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

  test('asks for project-gate approval only once per user turn', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      await mkdir(join(cwd, '.ur'), { recursive: true })
      await writeFile(
        join(cwd, '.ur', 'verify.json'),
        JSON.stringify({ afterEdit: ['bun test'] }),
      )
      const v = new Verifier({ cwd, askBeforeGates: true })
      v.beginTurn(TURN)
      v.recordToolCall(
        TURN,
        fakeToolUse('Write', { file_path: join(cwd, 'a.ts') }),
        true,
      )

      const first = await v.checkTurn(TURN, 'Implementation ready.', true)
      expect(first.ok).toBe(false)
      if (first.ok === false) expect(first.reminder).toContain('AskUserQuestion')

      const repeated = await v.checkTurn(TURN, 'Waiting for your decision.', false)
      expect(repeated.ok).toBe(true)

      v.endTurn(TURN)
      v.beginTurn(NEXT_TURN)
      v.recordToolCall(
        NEXT_TURN,
        fakeToolUse('Write', { file_path: join(cwd, 'b.ts') }, 'tu_2'),
        true,
      )
      const nextTask = await v.checkTurn(
        NEXT_TURN,
        'The next implementation is ready.',
        true,
      )
      expect(nextTask.ok).toBe(false)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('auto-detects and runs compile, test, and lint after edits without installed gates', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      await writeAutoGateProject(cwd, {
        typecheck: appendGateScript('typecheck'),
        test: appendGateScript('test'),
        lint: appendGateScript('lint'),
      })
      const v = new Verifier({ cwd })
      v.beginTurn(TURN)
      v.recordToolCall(
        TURN,
        fakeToolUse('Write', { file_path: join(cwd, 'src', 'a.ts') }),
        true,
      )
      const r = await v.checkTurn(TURN, 'I edited the file.', true)
      expect(r.ok).toBe(true)
      expect(await readFile(join(cwd, 'gate.log'), 'utf8')).toBe(
        'typecheck\ntest\nlint\n',
      )
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('auto-detected gates reject completion when a detected command fails', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      await writeAutoGateProject(cwd, {
        typecheck: failGateScript('auto gate failed'),
        test: appendGateScript('test'),
        lint: appendGateScript('lint'),
      })
      const v = new Verifier({ cwd })
      v.beginTurn(TURN)
      v.recordToolCall(
        TURN,
        fakeToolUse('Write', { file_path: join(cwd, 'src', 'a.ts') }),
        true,
      )
      const r = await v.checkTurn(TURN, 'I edited the file.', true)
      expect(r.ok).toBe(false)
      if (r.ok === false) {
        expect(r.reminder).toContain('bun run typecheck')
        expect(r.reminder).toContain('auto gate failed')
      }
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('configured edit gates take precedence over auto-detected gates', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      await writeAutoGateProject(cwd, {
        typecheck: failGateScript('should not run'),
        test: failGateScript('should not run'),
        lint: failGateScript('should not run'),
      })
      await mkdir(join(cwd, '.ur'), { recursive: true })
      await writeFile(
        join(cwd, '.ur', 'verify.json'),
        JSON.stringify({ afterEdit: ['true'] }),
      )
      const v = new Verifier({ cwd })
      v.beginTurn(TURN)
      v.recordToolCall(
        TURN,
        fakeToolUse('Write', { file_path: join(cwd, 'src', 'a.ts') }),
        true,
      )
      const r = await v.checkTurn(TURN, 'I edited the file.', true)
      expect(r.ok).toBe(true)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('ignorePatterns also suppress auto-detected gates for absolute edit paths', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      await writeAutoGateProject(cwd, {
        typecheck: failGateScript('ignored file should not run gates'),
      })
      await mkdir(join(cwd, '.ur'), { recursive: true })
      await writeFile(
        join(cwd, '.ur', 'verify.json'),
        JSON.stringify({ ignorePatterns: ['docs/**'] }),
      )
      const v = new Verifier({ cwd })
      v.beginTurn(TURN)
      v.recordToolCall(
        TURN,
        fakeToolUse('Write', { file_path: join(cwd, 'docs', 'notes.md') }),
        true,
      )
      const r = await v.checkTurn(TURN, 'I edited the docs.', true)
      expect(r.ok).toBe(true)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('Verifier L2 subagent nudge', () => {
  test('does NOT nudge by default — deep verification is opt-in / manual via /verify', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    const prev = process.env.UR_VERIFIER_AUTO_SUBAGENT
    delete process.env.UR_VERIFIER_AUTO_SUBAGENT
    try {
      const v = new Verifier({ cwd })
      v.beginTurn(TURN, 'please fix bug X')
      v.recordToolCall(TURN, fakeToolUse('Write', { file_path: '/a.ts' }), true)
      expect(v.shouldNudgeSubagent(TURN, false)).toBeNull()
    } finally {
      if (prev !== undefined) process.env.UR_VERIFIER_AUTO_SUBAGENT = prev
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('nudges when UR_VERIFIER_AUTO_SUBAGENT opts in', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    const prev = process.env.UR_VERIFIER_AUTO_SUBAGENT
    process.env.UR_VERIFIER_AUTO_SUBAGENT = '1'
    try {
      const v = new Verifier({ cwd })
      v.beginTurn(TURN, 'please fix bug X')
      v.recordToolCall(TURN, fakeToolUse('Write', { file_path: '/a.ts' }), true)
      expect(v.shouldNudgeSubagent(TURN, false)).not.toBeNull()
    } finally {
      if (prev === undefined) delete process.env.UR_VERIFIER_AUTO_SUBAGENT
      else process.env.UR_VERIFIER_AUTO_SUBAGENT = prev
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('nudges once when the turn modified files and no tool call is queued', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    try {
      const v = new Verifier({ cwd, enableSubagentNudge: true })
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
      const v = new Verifier({ cwd, enableSubagentNudge: true })
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
      const v = new Verifier({ cwd, enableSubagentNudge: true })
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
      const v = new Verifier({ cwd, enableSubagentNudge: true })
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

  test('mode=loose does not auto-nudge by default but allows the nudge when enabled', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-verifier-'))
    const prev = process.env.UR_VERIFIER_AUTO_SUBAGENT
    delete process.env.UR_VERIFIER_AUTO_SUBAGENT
    try {
      // Default (opt-in off): loose does not auto-spawn the subagent.
      const off = new Verifier({ cwd, mode: 'loose' })
      off.beginTurn(TURN, 'fix bug X')
      off.recordToolCall(TURN, fakeToolUse('Write', { file_path: '/a' }), true)
      expect(off.shouldNudgeSubagent(TURN, false)).toBeNull()

      // Unlike mode=off, loose still permits L2 when explicitly enabled.
      const on = new Verifier({ cwd, mode: 'loose', enableSubagentNudge: true })
      on.beginTurn(TURN, 'fix bug X')
      on.recordToolCall(TURN, fakeToolUse('Write', { file_path: '/a' }), true)
      expect(on.shouldNudgeSubagent(TURN, false)).not.toBeNull()
    } finally {
      if (prev !== undefined) process.env.UR_VERIFIER_AUTO_SUBAGENT = prev
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
