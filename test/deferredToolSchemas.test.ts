import { expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { buildSchemaNotSentHint } from '../src/services/tools/toolExecution.ts'
import {
  modelSupportsToolReference,
  supportsToolReferenceExpansion,
} from '../src/utils/toolSearch.ts'

// A mis-shaped Computer call was answered with "this tool's schema was not
// sent to the API" and told to call ToolSearch. Both claims were false: tool
// search is off on every UR runtime, so all schemas *are* sent and ToolSearch
// isn't even in the tool list. The model believed the hint and lost a turn.
// A wrong explanation is worse than none — the Zod error already names the
// bad field.

const DEFERRED_TOOL = {
  name: 'Computer',
  shouldDefer: true,
  inputSchema: z.object({
    action: z.enum(['screenshot', 'click', 'type']),
  }),
} as never

const TOOLS = [{ name: 'ToolSearch' }, { name: 'Computer' }]

test('no UR runtime can expand tool references', () => {
  // tool_reference is a URHQ-native beta block. UR runs on Ollama,
  // OpenAI-compatible servers and vendor CLIs — none of them expand it.
  expect(supportsToolReferenceExpansion()).toBe(false)
})

test('tool search stays off regardless of model name', () => {
  // Previously only Ollama was excluded, so LM Studio, vLLM and llama.cpp
  // enabled tool search and got tool_reference blocks they cannot expand —
  // which strands every deferred tool permanently.
  for (const model of ['kimi-k2.7-code:cloud', 'qwen2.5-coder', 'gpt-4o']) {
    expect(modelSupportsToolReference(model)).toBe(false)
  }
})

test('a bad tool call is not blamed on a missing schema', () => {
  // Tool search is off, so the schema was sent and the model simply got the
  // arguments wrong. Adding an explanation here would be inventing a cause.
  expect(buildSchemaNotSentHint(DEFERRED_TOOL, [], TOOLS)).toBeNull()
})

test('the hint is suppressed before the discovery check, not after', () => {
  // Reaching extractDiscoveredToolNames at all means the earlier gates let a
  // non-first-party runtime through. An empty history is the case that used to
  // produce the false hint, so it must stay null.
  expect(buildSchemaNotSentHint(DEFERRED_TOOL, [], TOOLS)).toBeNull()
  expect(
    buildSchemaNotSentHint(DEFERRED_TOOL, [], [{ name: 'Computer' }]),
  ).toBeNull()
})

test('a non-deferred tool never gets the hint', () => {
  expect(
    buildSchemaNotSentHint(
      { name: 'Bash', shouldDefer: false, inputSchema: z.object({}) } as never,
      [],
      TOOLS,
    ),
  ).toBeNull()
})
