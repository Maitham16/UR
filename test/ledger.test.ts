import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { filesFromArgs, markToolStart, readActions, recordAction, summarize, takeToolDuration } from '../src/stability/ledger.ts'

test('evidence ledger record/read + firewall flags', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'urt-'))
  for (let i = 0; i < 3; i++) recordAction(tmp, { ts: 't', tool: 'run_shell', args: { command: 'pytest' }, ok: false, durationMs: 40000 })
  const recs = readActions(tmp, 100)
  expect(recs.length).toBe(3)
  const s = summarize(recs)
  expect(s.failures).toBe(3)
  expect(s.flags.length).toBeGreaterThan(0)
  rmSync(tmp, { recursive: true, force: true })
})

test('latency capture + filesFromArgs', () => {
  markToolStart('x')
  expect(typeof takeToolDuration('x')).toBe('number')
  expect(takeToolDuration('x')).toBeUndefined()
  expect(filesFromArgs({ path: 'a.ts' })).toEqual(['a.ts'])
})
