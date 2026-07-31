import { expect, test } from 'bun:test'
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
