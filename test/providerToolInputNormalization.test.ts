import { expect, test } from 'bun:test'
import { parseOpenAICompatibleResponse } from '../src/services/api/openaiCompatible.js'
import { normalizeContentFromAPI } from '../src/utils/messages.ts'

test('streamed tool input conservatively repairs local-model JSON', () => {
  const content = normalizeContentFromAPI(
    [
      {
        type: 'tool_use',
        id: 'repairable',
        name: 'Write',
        input: '{"file_path":"/tmp/a","content":"line 1\nline 2",}',
      },
    ] as never,
    [] as never,
  )
  expect(content[0]).toMatchObject({
    type: 'tool_use',
    input: {
      file_path: '/tmp/a',
      content: 'line 1\nline 2',
    },
  })
})

test('irreparable streamed tool JSON is never collapsed to an empty call', () => {
  expect(() =>
    normalizeContentFromAPI(
      [
        {
          type: 'tool_use',
          id: 'broken',
          name: 'Write',
          input: '{"file_path":',
        },
      ] as never,
      [] as never,
    ),
  ).toThrow('not valid JSON after conservative repair')
})

test('provider tool input must decode to an object', () => {
  for (const input of ['[]', '"text"', '1', 'null']) {
    expect(() =>
      normalizeContentFromAPI(
        [
          {
            type: 'tool_use',
            id: `primitive-${input}`,
            name: 'Write',
            input,
          },
        ] as never,
        [] as never,
      ),
    ).toThrow('must be a JSON object')
  }
})

test('buffered OpenAI-compatible arguments receive the same conservative repair', () => {
  const result = parseOpenAICompatibleResponse(
    {
      id: 'repair-buffered',
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: 'repair-call',
                type: 'function',
                function: {
                  name: 'Write',
                  arguments:
                    '```json\n{"file_path":"/tmp/a","content":"line 1\nline 2",}\n```',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    },
    'local-model',
  )

  expect(result.content[0]).toMatchObject({
    type: 'tool_use',
    input: {
      file_path: '/tmp/a',
      content: 'line 1\nline 2',
    },
  })
})

test('buffered OpenAI-compatible arguments still reject irreparable input', () => {
  expect(() =>
    parseOpenAICompatibleResponse(
      {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: 'irreparable-call',
                  type: 'function',
                  function: {
                    name: 'Write',
                    arguments: '{"file_path":',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      'local-model',
    ),
  ).toThrow('not valid JSON after conservative repair')
})
