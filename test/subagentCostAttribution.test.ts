import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  formatSubagentCosts,
  summarizeSubagentCosts,
} from '../src/services/agents/inspector.ts'

// stats.ts already read {sessionId}/subagents/agent-*.jsonl, but only to fold
// those tokens into one total — so a fan-out that burned most of the budget
// looked the same as one that did not. Attribution is by filename: the Agent
// tool's input carries no agent id, so joining turns back to the spawning
// tool_use would be a guess.

function turn(model: string, input: number, output: number): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      model,
      content: [{ type: 'text', text: 'x' }],
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  })
}

function fixture(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'ur-cost-')), 'subagents')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'agent-a1b2.jsonl'),
    [turn('m', 12_000, 3_000), turn('m', 4_000, 900)].join('\n'),
  )
  writeFileSync(join(dir, 'agent-c3d4.jsonl'), turn('m', 5_000, 1_200))
  writeFileSync(join(dir, 'notes.txt'), 'not a transcript')
  return dir
}

test('each subagent gets its own row, summed across its turns', () => {
  const rows = summarizeSubagentCosts(fixture())
  expect(rows).toHaveLength(2)
  const a = rows.find(row => row.agentId === 'a1b2')
  expect(a?.inputTokens).toBe(16_000)
  expect(a?.outputTokens).toBe(3_900)
  expect(a?.messages).toBe(2)
})

test('non-transcript files in the directory are ignored', () => {
  expect(
    summarizeSubagentCosts(fixture()).map(row => row.agentId).sort(),
  ).toEqual(['a1b2', 'c3d4'])
})

test('a missing directory reports nothing rather than throwing', () => {
  expect(summarizeSubagentCosts('/nonexistent/subagents')).toEqual([])
  expect(formatSubagentCosts([], false)).toContain('No subagent transcripts')
})

test('rows total to the same tokens the aggregate would report', () => {
  // A breakdown that loses spend is worse than no breakdown.
  const rows = summarizeSubagentCosts(fixture())
  const total = rows.reduce((sum, r) => sum + r.inputTokens + r.outputTokens, 0)
  expect(total).toBe(16_000 + 3_900 + 5_000 + 1_200)
})

test('cost is omitted on a local runtime instead of printing $0.00', () => {
  // calculateUSDCost returns 0 for Ollama, so a money column would be a wall
  // of zeroes and read as a broken feature. Tokens are the real unit there.
  const rendered = formatSubagentCosts(summarizeSubagentCosts(fixture()), false)
  expect(rendered).not.toContain('$0.00')
  expect(rendered).toContain('local and unbilled')
  expect(rendered).toContain('16000 in')
})

test('cost is shown when a provider actually billed', () => {
  const rendered = formatSubagentCosts(
    [
      {
        agentId: 'a1',
        model: 'm',
        messages: 1,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: 0.42,
      },
    ],
    false,
  )
  expect(rendered).toContain('$0.42')
  expect(rendered).not.toContain('unbilled')
})

test('json mode emits the raw rows', () => {
  const parsed = JSON.parse(
    formatSubagentCosts(summarizeSubagentCosts(fixture()), true),
  )
  expect(parsed.subagents).toHaveLength(2)
  expect(parsed.subagents[0]).toHaveProperty('agentId')
})

test('the shipped CLI accepts --costs, not just the source', () => {
  // Asserting on source strings passed while `ur agent-inspect --costs` still
  // died with "unknown option": the Commander tree in main.tsx is a separate
  // registration from the command module. Drive the real binary instead.
  const dir = fixture()
  const result = spawnSync(
    'node',
    ['./bin/ur.js', 'agent-inspect', '--costs', dir, '--json'],
    { encoding: 'utf8', timeout: 60_000 },
  )
  expect(result.stderr).not.toContain('unknown option')
  expect(result.status).toBe(0)
  const parsed = JSON.parse(result.stdout)
  expect(parsed.subagents.map((row: { agentId: string }) => row.agentId).sort()).toEqual([
    'a1b2',
    'c3d4',
  ])
}, 90_000)

test('an empty result names the directory it searched', () => {
  // "No subagent transcripts found for this session" is indistinguishable from
  // having resolved the wrong path. Say where you looked.
  const rendered = formatSubagentCosts([], false, '/some/session/subagents')
  expect(rendered).toContain('/some/session/subagents')
  expect(rendered).toContain('not where they were written')
})
