// Non-interactive integration harness.
//
// Replays the verifier API in the order queryLoop would call it during a
// real session, so regressions in the wiring contract (turn ids, ledger
// keys, reminder injection order) get caught in CI instead of in a live
// Ollama session.

import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Verifier } from '../src/services/verifier'
import { stripSystemReminders } from '../src/utils/systemReminderFilter'
import trace from '../src/commands/trace'
import verify from '../src/commands/verify'

const TURN = '00000000-0000-0000-0000-aaaaaaaaaaaa'

function toolUse(name: string, input: any, id: string) {
  return { type: 'tool_use', id, name, input } as any
}

describe('integration: queryLoop replay', () => {
  test('false done-claim turn → reject → retry with effect → pass → L2 nudge', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-int-'))
    try {
      const v = new Verifier({ cwd })
      v.beginTurn(TURN, 'add a hello function to README.md')

      // Iteration 1: model says "I added it" without writing anything
      const r1 = await v.checkTurn(TURN, 'I added the function.', false)
      expect(r1.ok).toBe(false)

      // queryLoop would inject the reminder and re-enter
      // Iteration 2: model actually writes the file
      v.recordToolCall(TURN, toolUse('Write', { file_path: '/README.md', content: 'x' }, 'tu_1'), true)
      const r2 = await v.checkTurn(TURN, 'Wrote it.', false)
      expect(r2.ok).toBe(true)

      // L2: after L1 passes, nudge for verification subagent
      const nudge = v.shouldNudgeSubagent(TURN, false)
      expect(nudge).not.toBeNull()
      expect(nudge?.reminder).toContain('verification')
      expect(nudge?.reminder).toContain('add a hello function to README.md')

      v.markSubagentNudged(TURN)
      // Iteration 3: model ignores the nudge and re-finishes
      // (nudge does not fire again)
      expect(v.shouldNudgeSubagent(TURN, false)).toBeNull()

      v.endTurn(TURN)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('read-only research turn produces no nudge', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-int-'))
    try {
      const v = new Verifier({ cwd })
      v.beginTurn(TURN, 'where is the auth code')
      v.recordToolCall(TURN, toolUse('Read', { file_path: '/auth.ts' }, 'tu_1'), true)
      v.recordToolCall(TURN, toolUse('Grep', { pattern: 'login' }, 'tu_2'), true)
      const r = await v.checkTurn(TURN, 'It lives in src/auth/login.ts.', false)
      expect(r.ok).toBe(true)
      expect(v.shouldNudgeSubagent(TURN, false)).toBeNull()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('UR_VERIFIER_MODE=off short-circuits everything', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ur-int-'))
    const prev = process.env.UR_VERIFIER_MODE
    process.env.UR_VERIFIER_MODE = 'off'
    try {
      const v = new Verifier({ cwd })
      v.beginTurn(TURN)
      const r = await v.checkTurn(TURN, 'I did it.', false)
      expect(r.ok).toBe(true)
      v.recordToolCall(TURN, toolUse('Write', { file_path: '/a' }, 'tu_1'), true)
      expect(v.shouldNudgeSubagent(TURN, false)).toBeNull()
    } finally {
      if (prev === undefined) delete process.env.UR_VERIFIER_MODE
      else process.env.UR_VERIFIER_MODE = prev
      await rm(cwd, { recursive: true, force: true })
    }
  })
})

describe('integration: slash commands', () => {
  test('/verify returns a prompt block that names the verification subagent', async () => {
    if (verify.type !== 'prompt') throw new Error('expected prompt command')
    const blocks = await verify.getPromptForCommand('the new endpoint', {} as any)
    expect(blocks.length).toBe(1)
    expect((blocks[0] as { type: string }).type).toBe('text')
    const text = (blocks[0] as { text: string }).text
    expect(text).toContain('subagent_type="verification"')
    expect(text).toContain('the new endpoint')
    expect(text).toContain('VERDICT')
  })

  test('/trace renders the most recent N messages with verdict extraction', async () => {
    if (trace.type !== 'local') throw new Error('expected local command')
    const mod = await trace.load()
    const ctx = {
      messages: [
        { type: 'user', uuid: '11111111-2222-3333-4444-555555555555', message: { role: 'user', content: 'fix it' } },
        { type: 'assistant', uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', message: { role: 'assistant', content: [
          { type: 'text', text: 'On it.' },
          { type: 'tool_use', name: 'Edit', input: { file_path: '/x.ts' } },
        ] } },
        { type: 'assistant', uuid: 'cccccccc-dddd-eeee-ffff-000000000000', message: { role: 'assistant', content: [
          { type: 'text', text: 'Done.\n\nVERDICT: PASS' },
        ] } },
      ],
    } as any
    const out = await mod.call('', ctx)
    if (out.type !== 'text') throw new Error('expected text')
    expect(out.value).toContain('verdict: PASS')
    expect(out.value).toContain('tool_use: Edit')
  })
})

describe('integration: render-time reminder filter', () => {
  test('strips a verifier reminder if the model echoes it', () => {
    const sample =
      'Sure, here is what I did.\n' +
      '<system-reminder>You claimed completion but never wrote.</system-reminder>\n' +
      'The file is at /README.md.'
    const cleaned = stripSystemReminders(sample)
    expect(cleaned).not.toContain('<system-reminder>')
    expect(cleaned).not.toContain('claimed completion')
    expect(cleaned).toContain('/README.md')
  })
})
