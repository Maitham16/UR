import { expect, test } from 'bun:test'
import { toOllamaChatRequest } from '../src/services/api/ollama.ts'

// A screenshot reached the model as the literal text "[Image output omitted]".
// Every layer above this one was correct: the tool captured the image and
// returned a proper image block. The adapter threw the bytes away on the way
// to the wire, so these tests assert the wire payload, not the tool.

const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function requestWithScreenshot(capabilities: Set<string> | null) {
  return toOllamaChatRequest(
    {
      model: 'kimi-k2.7-code:cloud',
      max_tokens: 100,
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'Computer', input: {} },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: [
                { type: 'text', text: 'screenshot: Captured 7035293 bytes' },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: PIXEL,
                  },
                },
              ],
            },
          ],
        },
      ],
    } as never,
    false,
    capabilities,
  )
}

test('a vision model receives the actual image bytes', () => {
  const request = requestWithScreenshot(new Set(['tools', 'vision']))
  const withImages = request.messages.filter(m => (m.images?.length ?? 0) > 0)
  expect(withImages).toHaveLength(1)
  expect(withImages[0]?.images).toEqual([PIXEL])
  // The tool message keeps the text and points at where the bytes went.
  const tool = request.messages.find(m => m.role === 'tool')
  expect(tool?.content).toContain('Captured 7035293 bytes')
  expect(tool?.content).toContain('following message')
})

test('the bytes are never silently dropped', () => {
  const request = requestWithScreenshot(new Set(['tools', 'vision']))
  expect(JSON.stringify(request)).not.toContain('[Image output omitted]')
})

test('a text-only model is told why it cannot see, and what to do', () => {
  const request = requestWithScreenshot(new Set(['tools']))
  expect(request.messages.some(m => (m.images?.length ?? 0) > 0)).toBe(false)
  const tool = request.messages.find(m => m.role === 'tool')
  // Naming the model matters: the user must know which one to change.
  expect(tool?.content).toContain('kimi-k2.7-code:cloud')
  expect(tool?.content).toContain('does not advertise vision support')
  expect(tool?.content).toContain('/model')
  // The text half of the result must survive regardless.
  expect(tool?.content).toContain('Captured 7035293 bytes')
})

test('an image-free tool result is unchanged', () => {
  const request = toOllamaChatRequest(
    {
      model: 'kimi-k2.7-code:cloud',
      max_tokens: 100,
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu_2', name: 'Bash', input: {} }],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_2',
              content: [{ type: 'text', text: 'total 8\ndrwxr-xr-x' }],
            },
          ],
        },
      ],
    } as never,
    false,
    new Set(['tools']),
  )
  const tool = request.messages.find(m => m.role === 'tool')
  expect(tool?.content).toBe('total 8\ndrwxr-xr-x')
  expect(tool?.tool_name).toBe('Bash')
  expect(request.messages.some(m => (m.images?.length ?? 0) > 0)).toBe(false)
})

test('a string tool result still works', () => {
  const request = toOllamaChatRequest(
    {
      model: 'llama3.2-vision',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_3', content: 'done' },
          ],
        },
      ],
    } as never,
    false,
    null,
  )
  expect(request.messages.find(m => m.role === 'tool')?.content).toBe('done')
})
