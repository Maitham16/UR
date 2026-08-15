import { beforeEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  REPEATED_FAILURE_DEFAULTS,
  REPEATED_FAILURE_GUARD_LIMITS,
  RepeatedToolFailureAbort,
  callSignature,
  checkRepeatedFailure,
  clearRepeatedFailuresForQuery,
  recordCallFailure,
  recordCallSuccess,
  resetRepeatedFailuresForTesting,
  setRepeatedFailureClockForTesting,
} from '../src/services/tools/repeatedFailureGuard.ts'
import {
  getToolRepeatedFailurePolicy,
  runToolUse,
} from '../src/services/tools/toolExecution.ts'

// A 4B model refused once by the task-list gate replied by emitting `Write`
// with no arguments, over and over, plus `Computer(type 0 chars)`. Nothing
// stopped it. The trajectory grader names this pattern but only after the run
// has ended, so it could grade the wreck and never prevent it.

beforeEach(() => resetRepeatedFailuresForTesting())

// The guard ships disabled; these exercise the mechanism, so they enable it.
const ENABLED = { ...REPEATED_FAILURE_DEFAULTS, enabled: true }

const SIG = 'Write:{}'

test('a call is allowed until it has failed repeatedly', () => {
  expect(checkRepeatedFailure(SIG, ENABLED).action).toBe('allow')
  recordCallFailure(SIG)
  recordCallFailure(SIG)
  // Two failures are plausible: a transient error, then a fix that fails the
  // same way. The third is a loop.
  expect(checkRepeatedFailure(SIG, ENABLED).action).toBe('allow')
  recordCallFailure(SIG)
  expect(checkRepeatedFailure(SIG, ENABLED).action).toBe('refuse')
})

test('the refusal tells the model to change course, not just to stop', () => {
  for (let i = 0; i < REPEATED_FAILURE_DEFAULTS.limit; i++) recordCallFailure(SIG)
  const decision = checkRepeatedFailure(SIG, ENABLED)
  const reason = (decision as { reason: string }).reason
  expect(reason).toContain('Do not retry it unchanged')
  expect(reason).toContain('tell the user')
})

test('persisting past the refusal aborts the turn', () => {
  // Otherwise a model that ignores the refusal loops on the refusal instead.
  for (let i = 0; i < REPEATED_FAILURE_DEFAULTS.abortAfter; i++) {
    recordCallFailure(SIG)
  }
  expect(checkRepeatedFailure(SIG, ENABLED).action).toBe('abort')
})

test('refused unchanged attempts advance to the abort threshold', () => {
  const decisions: string[] = []
  for (let attempt = 0; attempt < REPEATED_FAILURE_DEFAULTS.abortAfter; attempt++) {
    const decision = checkRepeatedFailure(SIG, ENABLED)
    decisions.push(decision.action)
    if (decision.action === 'abort') break
    // Runtime failures and guard refusals both represent an unchanged failed
    // attempt; either one must advance the same counter.
    recordCallFailure(SIG)
  }
  expect(decisions).toEqual([
    'allow',
    'allow',
    'allow',
    'refuse',
    'refuse',
    'refuse',
  ])
  expect(checkRepeatedFailure(SIG, ENABLED).action).toBe('abort')
})

test('a corrected retry is never penalised', () => {
  // This is what a refusal asks the model to do, so blocking it would punish
  // exactly the recovery we want.
  const broken = callSignature('Write', {})
  const fixed = callSignature('Write', { file_path: '/a.ts', content: 'x' })
  for (let i = 0; i < 5; i++) recordCallFailure(broken)
  expect(checkRepeatedFailure(broken, ENABLED).action).not.toBe('allow')
  expect(checkRepeatedFailure(fixed, ENABLED).action).toBe('allow')
})

test('unchanged code edits are bounded and receive a concrete recovery path', () => {
  const policy = getToolRepeatedFailurePolicy('Edit')
  const broken = callSignature('Edit', {
    file_path: '/game.html',
    old_string: 'stale HUD block',
    new_string: 'new HUD block',
  })
  const corrected = callSignature('Edit', {
    file_path: '/game.html',
    old_string: 'exact current HUD block',
    new_string: 'new HUD block',
  })

  expect(policy).toMatchObject({ enabled: true, limit: 2, abortAfter: 3 })
  recordCallFailure(broken)
  recordCallFailure(broken)
  const refusal = checkRepeatedFailure(broken, policy)
  expect(refusal.action).toBe('refuse')
  expect((refusal as { reason: string }).reason).toContain(
    'Read the current target again',
  )
  expect(checkRepeatedFailure(corrected, policy).action).toBe('allow')
  expect(getToolRepeatedFailurePolicy('Bash').enabled).toBe(false)
})

test('signatures ignore key order', () => {
  expect(callSignature('Write', { a: 1, b: 2 })).toBe(
    callSignature('Write', { b: 2, a: 1 }),
  )
})

test('signatures canonicalize nested objects without collapsing distinct calls', () => {
  expect(
    callSignature('Write', {
      payload: { beta: 2, alpha: { y: 2, x: 1 } },
    }),
  ).toBe(
    callSignature('Write', {
      payload: { alpha: { x: 1, y: 2 }, beta: 2 },
    }),
  )
  expect(callSignature('Write', { payload: { x: 1 } })).not.toBe(
    callSignature('Write', { payload: { y: 1 } }),
  )
  expect(callSignature('Write', { payload: { x: 1 } })).not.toBe(
    callSignature('Write', { payload: { x: 2 } }),
  )
})

test('signatures keep array ordering and primitive types distinct', () => {
  expect(callSignature('Write', { values: [1, 2] })).not.toBe(
    callSignature('Write', { values: [2, 1] }),
  )
  expect(callSignature('Write', { value: 1 })).not.toBe(
    callSignature('Write', { value: '1' }),
  )
  expect(callSignature('Write', { value: '\ud800' })).not.toBe(
    callSignature('Write', { value: '\ud801' }),
  )
})

test('signatures are fixed-size digests and retain no raw tool input', () => {
  const marker = 'private-marker-that-must-not-be-retained'
  const signature = callSignature(
    'SensitiveCustomTool',
    { content: `${marker}:${'x'.repeat(200_000)}` },
    'query:secret-chain',
  )

  expect(signature.length).toBeLessThan(220)
  expect(signature).not.toContain(marker)
  expect(signature).not.toContain('SensitiveCustomTool')
  expect(signature).not.toContain('secret-chain')
})

test('large caller-supplied signatures retain threshold compatibility', () => {
  const legacySignature = `legacy:${'x'.repeat(200_000)}`
  for (let i = 0; i < REPEATED_FAILURE_DEFAULTS.limit; i++) {
    recordCallFailure(legacySignature)
  }
  expect(checkRepeatedFailure(legacySignature, ENABLED).action).toBe('refuse')
  recordCallSuccess(legacySignature)
  expect(checkRepeatedFailure(legacySignature, ENABLED).action).toBe('allow')
})

test('canonical digests handle cycles deterministically', () => {
  const first: Record<string, unknown> = { value: 1 }
  first.self = first
  const second: Record<string, unknown> = { value: 1 }
  second.self = second

  expect(callSignature('Write', first)).toBe(callSignature('Write', second))
})

test('failure histories are isolated by query-chain scope', () => {
  const firstTurn = callSignature('Write', {}, 'chain-a')
  const secondTurn = callSignature('Write', {}, 'chain-b')
  for (let i = 0; i < REPEATED_FAILURE_DEFAULTS.limit; i++) {
    recordCallFailure(firstTurn)
  }
  expect(checkRepeatedFailure(firstTurn, ENABLED).action).toBe('refuse')
  expect(checkRepeatedFailure(secondTurn, ENABLED).action).toBe('allow')
})

test('serialization failures do not throw or collapse into one signature', () => {
  const hostile = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error('no enumeration')
      },
    },
  )
  let first = ''
  let second = ''
  expect(() => {
    first = callSignature('Write', hostile)
    second = callSignature('Write', hostile)
  }).not.toThrow()
  expect(first).not.toBe(second)
})

test('over-budget traversals fail open without conflating calls', () => {
  let deep: Record<string, unknown> = { leaf: true }
  for (
    let depth = 0;
    depth <= REPEATED_FAILURE_GUARD_LIMITS.maxCanonicalDepth;
    depth++
  ) {
    deep = { next: deep }
  }

  expect(callSignature('Write', deep)).not.toBe(callSignature('Write', deep))
})

test('query cleanup clears only the completed query chain', () => {
  const completed = callSignature('Write', {}, 'query:completed-chain')
  const active = callSignature('Write', {}, 'query:active-chain')
  for (let i = 0; i < REPEATED_FAILURE_DEFAULTS.limit; i++) {
    recordCallFailure(completed)
    recordCallFailure(active)
  }

  expect(clearRepeatedFailuresForQuery('completed-chain')).toBe(1)
  expect(checkRepeatedFailure(completed, ENABLED).action).toBe('allow')
  expect(checkRepeatedFailure(active, ENABLED).action).toBe('refuse')
})

test('stale failure history expires after the configured TTL', () => {
  let now = 10_000
  setRepeatedFailureClockForTesting(() => now)
  const signature = callSignature('Write', {}, 'query:ttl-chain')
  for (let i = 0; i < REPEATED_FAILURE_DEFAULTS.limit; i++) {
    recordCallFailure(signature)
  }

  now += REPEATED_FAILURE_GUARD_LIMITS.entryTtlMs - 1
  expect(checkRepeatedFailure(signature, ENABLED).action).toBe('refuse')
  now++
  expect(checkRepeatedFailure(signature, ENABLED).action).toBe('allow')
  expect(recordCallFailure(signature)).toBe(1)
})

test('one scope cannot retain more than its bounded entry allowance', () => {
  const scope = 'query:bounded-scope'
  const oldest = callSignature('Write', { index: 0 }, scope)
  for (let i = 0; i < REPEATED_FAILURE_DEFAULTS.limit; i++) {
    recordCallFailure(oldest)
  }

  let newest = ''
  for (
    let index = 1;
    index <= REPEATED_FAILURE_GUARD_LIMITS.maxEntriesPerScope;
    index++
  ) {
    newest = callSignature('Write', { index }, scope)
    recordCallFailure(newest)
  }

  expect(checkRepeatedFailure(oldest, ENABLED).action).toBe('allow')
  recordCallFailure(newest)
  recordCallFailure(newest)
  expect(checkRepeatedFailure(newest, ENABLED).action).toBe('refuse')
})

test('total retained entries are globally bounded across scopes', () => {
  const oldest = callSignature('Write', { index: 0 }, 'query:scope-0')
  for (let i = 0; i < REPEATED_FAILURE_DEFAULTS.limit; i++) {
    recordCallFailure(oldest)
  }

  let newest = ''
  for (
    let index = 1;
    index <= REPEATED_FAILURE_GUARD_LIMITS.maxEntries;
    index++
  ) {
    newest = callSignature(
      'Write',
      { index },
      `query:scope-${index}`,
    )
    recordCallFailure(newest)
  }

  expect(checkRepeatedFailure(oldest, ENABLED).action).toBe('allow')
  recordCallFailure(newest)
  recordCallFailure(newest)
  expect(checkRepeatedFailure(newest, ENABLED).action).toBe('refuse')
})

test('success clears the history for that call', () => {
  for (let i = 0; i < REPEATED_FAILURE_DEFAULTS.limit; i++) recordCallFailure(SIG)
  expect(checkRepeatedFailure(SIG, ENABLED).action).toBe('refuse')
  recordCallSuccess(SIG)
  expect(checkRepeatedFailure(SIG, ENABLED).action).toBe('allow')
})

test('the gate and validation both feed the guard', () => {
  // The observed loop was rejected by input validation every time. If those
  // rejections are not recorded, the guard never counts and never fires.
  const source = readFileSync('src/services/tools/toolExecution.ts', 'utf8')
  const gateAt = source.indexOf('if (gate.allowed === false)')
  const validationAt = source.indexOf('if (!parsedInput.success)')
  expect(source.slice(gateAt, gateAt + 300)).toContain('recordCallFailure')
  expect(source.slice(validationAt, validationAt + 300)).toContain(
    'recordCallFailure',
  )
  const refusalAt = source.indexOf("if (repeat.action === 'abort')")
  expect(source.slice(refusalAt, refusalAt + 700)).toContain(
    'recordCallFailure(callSig)',
  )
  expect(source).toContain('recordCallSuccess(callSig)')
  expect(source).toContain('error instanceof RepeatedToolFailureAbort')
  expect(source).toContain('getToolRepeatedFailurePolicy(tool.name)')
})

test('an unavailable tool is recoverable once and then bounded', async () => {
  const context = {
    abortController: new AbortController(),
    options: { tools: [], mcpClients: [] },
    queryTracking: { chainId: 'repeat-integration', depth: 0 },
  } as never
  const assistantMessage = {
    type: 'assistant',
    uuid: 'assistant-repeat-test',
    message: {
      id: 'message-repeat-test',
      content: [],
    },
  } as never
  const toolUse = {
    type: 'tool_use',
    id: 'missing-tool-call',
    name: 'DefinitelyMissingTool',
    input: { nested: { value: 1 } },
  } as never

  const first = await Array.fromAsync(
    runToolUse(toolUse, assistantMessage, (() => {}) as never, context),
  )
  expect(JSON.stringify(first)).toContain('UnavailableTool')
  expect(JSON.stringify(first)).toContain('Do not retry this tool unchanged')

  const second = await Array.fromAsync(
    runToolUse(toolUse, assistantMessage, (() => {}) as never, context),
  )
  expect(JSON.stringify(second)).toContain('RepeatedFailure')

  await Array.fromAsync(
    runToolUse(toolUse, assistantMessage, (() => {}) as never, context),
  )
  await expect(
    Array.fromAsync(
      runToolUse(toolUse, assistantMessage, (() => {}) as never, context),
    ),
  ).rejects.toThrow('Repeated tool failure')
  expect(REPEATED_FAILURE_DEFAULTS.enabled).toBe(false)
  expect(RepeatedToolFailureAbort.prototype).toBeInstanceOf(Error)
})

test('an alias cannot revive a tool omitted from the active profile', async () => {
  const output = await Array.fromAsync(
    runToolUse(
      {
        type: 'tool_use',
        id: 'omitted-alias-call',
        name: 'KillShell',
        input: { shell_id: 'task-that-must-not-be-touched' },
      } as never,
      {
        type: 'assistant',
        uuid: 'assistant-omitted-alias',
        message: { id: 'message-omitted-alias', content: [] },
      } as never,
      (() => {}) as never,
      {
        abortController: new AbortController(),
        options: { tools: [], mcpClients: [] },
        queryTracking: { chainId: 'omitted-alias', depth: 0 },
      } as never,
    ),
  )

  expect(JSON.stringify(output)).toContain('UnavailableTool')
  expect(JSON.stringify(output)).toContain('KillShell')
})
