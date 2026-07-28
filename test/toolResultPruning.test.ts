import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { clearOldToolResults } from '../src/services/compact/microCompact.ts'
import {
  TOOL_RESULT_PRUNING_DEFAULTS,
  getToolResultPruningConfig,
} from '../src/services/compact/toolResultPruningConfig.ts'

// UR had the clearing machinery but nothing external could reach it: cached
// microcompact is internal-only, and the time-based trigger needs an hour
// idle AND a GrowthBook flag a local install never receives. So an active
// session pruned nothing and went straight to autocompact, which replaces the
// entire history with a summary.

function conversation(toolCount: number, resultSize = 4000) {
  const messages: unknown[] = []
  for (let i = 0; i < toolCount; i++) {
    messages.push({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: `t${i}`, name: 'Read', input: { file_path: `/f${i}.ts` } },
        ],
      },
    })
    messages.push({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: `t${i}`, content: 'x'.repeat(resultSize) },
        ],
      },
    })
  }
  return messages as never
}

test('old tool results are cleared, recent ones are protected', () => {
  const result = clearOldToolResults(conversation(20), 8)
  expect(result).not.toBeNull()
  // 20 results, keep the last 8 → 12 cleared.
  expect(result!.cleared).toBe(12)
  expect(result!.tokensSaved).toBeGreaterThan(0)
})

test('the protected zone really survives', () => {
  const result = clearOldToolResults(conversation(12), 5)!
  const cleared = JSON.stringify(result.messages).split('tool_result').length - 1
  expect(cleared).toBe(12)
  // The last five results must still hold their original content.
  const text = JSON.stringify(result.messages)
  for (const id of ['t7', 't8', 't9', 't10', 't11']) {
    const index = text.indexOf(`"tool_use_id":"${id}"`)
    expect(text.slice(index, index + 200)).toContain('xxxx')
  }
})

test('keepRecent is floored at 1, so a session is never fully blanked', () => {
  // slice(-0) returns the whole array, and clearing everything leaves the
  // model with no working context at all. Both degenerates are wrong.
  const result = clearOldToolResults(conversation(6), 0)!
  expect(result.cleared).toBe(5)
})

test('nothing to clear returns null rather than churning the messages', () => {
  expect(clearOldToolResults(conversation(3), 8)).toBeNull()
  expect(clearOldToolResults(conversation(0), 8)).toBeNull()
})

test('clearing is idempotent — a second pass frees nothing', () => {
  const first = clearOldToolResults(conversation(20), 8)!
  expect(clearOldToolResults(first.messages, 8)).toBeNull()
})

test('defaults are on, with a threshold that spares short sessions', () => {
  // Pruning invalidates the cached prefix, so a small cleanup costs more than
  // it reclaims. Only act when the saving is large.
  expect(TOOL_RESULT_PRUNING_DEFAULTS.enabled).toBe(true)
  expect(TOOL_RESULT_PRUNING_DEFAULTS.minTokensFreed).toBe(20_000)
  expect(TOOL_RESULT_PRUNING_DEFAULTS.keepRecent).toBe(8)
})

test('config comes from settings, not GrowthBook', () => {
  // The existing time-based config reads tengu_slate_heron and defaults to
  // disabled, which is why it never once fired for a real user.
  const source = readFileSync(
    'src/services/compact/toolResultPruningConfig.ts',
    'utf8',
  )
  expect(source).not.toContain('getFeatureValue')
  expect(source).toContain('getInitialSettings')
  expect(getToolResultPruningConfig().enabled).toBe(true)
})

test('a partial or nonsense setting falls back per field', () => {
  const source = readFileSync(
    'src/services/compact/toolResultPruningConfig.ts',
    'utf8',
  )
  // Setting only keepRecent must not silently disable pruning, and a bad
  // value must not clear everything.
  expect(source).toContain('Number.isInteger(configured.keepRecent)')
  expect(source).toContain('configured.keepRecent >= 1')
})

test('the size trigger is actually wired into microcompact', () => {
  // The whole defect was machinery with no reachable caller.
  const source = readFileSync('src/services/compact/microCompact.ts', 'utf8')
  const index = source.indexOf('maybeSizeBasedMicrocompact(messages, querySource)')
  expect(index).toBeGreaterThan(-1)
  // It must run before the external-build early return, or it is dead again.
  expect(index).toBeLessThan(source.indexOf('return { messages }\n}'))
})
