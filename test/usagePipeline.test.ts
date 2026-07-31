import { describe, expect, test } from 'bun:test'
import { EMPTY_USAGE } from '../src/services/api/emptyUsage.js'
import { accumulateUsage, updateUsage } from '../src/services/api/ur.js'
import {
  createProgressTracker,
  getProgressUpdate,
  updateProgressFromMessage,
} from '../src/tasks/LocalAgentTask/LocalAgentTask.js'
import { finalizeAgentTool } from '../src/tools/AgentTool/agentToolUtils.js'
import {
  aggregateReportedUsage,
  getReportedSessionTokenTotal,
} from '../src/utils/tokens.js'

function assistant(
  uuid: string,
  responseId: string,
  usage: Record<string, unknown>,
  content: Record<string, unknown>[] = [],
) {
  return {
    type: 'assistant',
    uuid,
    message: {
      id: responseId,
      role: 'assistant',
      model: 'test-model',
      content,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        server_tool_use: {
          web_search_requests: 0,
          web_fetch_requests: 0,
        },
        service_tier: 'standard',
        cache_creation: {
          ephemeral_1h_input_tokens: 0,
          ephemeral_5m_input_tokens: 0,
        },
        ...usage,
      },
    },
  } as never
}

describe('reported usage aggregation', () => {
  test('deduplicates split records and sums sequential responses', () => {
    const firstUsage = {
      input_tokens: 10,
      output_tokens: 5,
      reasoning_tokens: 2,
      provider_total_tokens: 15,
    }
    const messages = [
      assistant('split-a', 'response-1', firstUsage),
      assistant('split-b', 'response-1', firstUsage),
      assistant('turn-2', 'response-2', {
        input_tokens: 20,
        cache_read_input_tokens: 4,
        output_tokens: 3,
        reasoning_tokens: 1,
        provider_total_tokens: 27,
      }),
    ]

    const usage = aggregateReportedUsage(messages)
    expect(usage).toMatchObject({
      input_tokens: 30,
      cache_read_input_tokens: 4,
      output_tokens: 8,
      reasoning_tokens: 3,
      provider_total_tokens: 42,
    })
    expect(getReportedSessionTokenTotal(messages)).toBe(42)
  })

  test('omits a token total when no provider reported usage', () => {
    const messages = [assistant('empty', 'response-empty', {})]
    expect(aggregateReportedUsage(messages)).toBeUndefined()
    expect(getReportedSessionTokenTotal(messages)).toBeNull()
  })
})

describe('agent progress usage', () => {
  test('does not show zero tokens before usage is reported', () => {
    const tracker = createProgressTracker()
    updateProgressFromMessage(
      tracker,
      assistant('tool-only', 'response-tool', {}, [
        { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
      ]),
    )

    expect(getProgressUpdate(tracker)).toMatchObject({ toolUseCount: 1 })
    expect(getProgressUpdate(tracker).tokenCount).toBeUndefined()
  })

  test('counts one usage block for split parallel tool records', () => {
    const tracker = createProgressTracker()
    const usage = { input_tokens: 100, output_tokens: 20 }
    updateProgressFromMessage(tracker, assistant('a', 'same-response', usage))
    updateProgressFromMessage(tracker, assistant('b', 'same-response', usage))

    expect(getProgressUpdate(tracker).tokenCount).toBe(120)
  })

  test('final results aggregate sequential responses and omit unavailable usage', () => {
    const metadata = {
      prompt: 'audit',
      resolvedAgentModel: 'test-model',
      isBuiltInAgent: false,
      startTime: Date.now(),
      agentType: 'general-purpose',
      isAsync: false,
    }
    const reported = finalizeAgentTool(
      [
        assistant('turn-1', 'response-1', { input_tokens: 10, output_tokens: 5 }),
        assistant('turn-2', 'response-2', { input_tokens: 20, output_tokens: 7 }),
      ],
      'agent-reported',
      metadata,
    )
    const unavailable = finalizeAgentTool(
      [assistant('turn-empty', 'response-empty', {})],
      'agent-unavailable',
      metadata,
    )

    expect(reported.totalTokens).toBe(42)
    expect(reported.usage).toMatchObject({ input_tokens: 30, output_tokens: 12 })
    expect(unavailable.totalTokens).toBeUndefined()
    expect(unavailable.usage).toBeUndefined()
  })
})

describe('streaming optional usage fields', () => {
  test('preserves and accumulates reasoning and provider totals', () => {
    const first = updateUsage(EMPTY_USAGE, {
      input_tokens: 10,
      output_tokens: 7,
      reasoning_tokens: 5,
      provider_total_tokens: 17,
    } as never)
    const second = updateUsage(EMPTY_USAGE, {
      input_tokens: 4,
      output_tokens: 3,
      reasoning_tokens: 2,
      provider_total_tokens: 7,
    } as never)
    const total = accumulateUsage(first, second)

    expect(first.reasoning_tokens).toBe(5)
    expect(first.provider_total_tokens).toBe(17)
    expect(total.reasoning_tokens).toBe(7)
    expect(total.provider_total_tokens).toBe(24)
  })
})
