import { expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { formatZodValidationError } from '../src/utils/toolErrors.ts'

const askInputSchema = z.strictObject({
  questions: z
    .array(
      z.strictObject({
        question: z.string(),
        header: z.string(),
        options: z
          .array(
            z.strictObject({
              label: z.string(),
              description: z.string().optional(),
            }),
          )
          .min(2)
          .max(8),
      }),
    )
    .min(1)
    .max(4),
})

test('AskUserQuestion validation compacts repeated indexed omissions', () => {
  const parsed = askInputSchema.safeParse({
    questions: Array.from({ length: 14 }, (_, index) => ({
      header: `Q${index}`,
      prompt: `Question ${index}`,
    })),
  })
  expect(parsed.success).toBe(false)
  if (parsed.success) return

  const message = formatZodValidationError(
    'AskUserQuestion',
    parsed.error,
  )

  expect(message).toContain(
    'The parameter `questions` must contain at most 4 items',
  )
  expect(message).toContain(
    'The required fields `question` and `options` are missing from `questions[0..13]`',
  )
  expect(message).not.toContain('questions[13].question')
  expect(message).toContain('1-4 complete question objects')
  expect(message).toContain('2-8 objects containing `label`')
  expect(message).toContain(
    'Do not invent missing choices or truncate question/option content',
  )
  expect(message).toContain('Overlong UI headers are compacted automatically')
  expect(message).toContain('do not repeat the unchanged call')
  expect(message.split('\n').length).toBeLessThanOrEqual(7)
})

test('validation formatting includes lower size constraints', () => {
  const parsed = z
    .strictObject({
      options: z.array(z.string()).min(2),
    })
    .safeParse({ options: ['only one'] })
  expect(parsed.success).toBe(false)
  if (parsed.success) return

  expect(formatZodValidationError('ExampleTool', parsed.error)).toContain(
    'The parameter `options` must contain at least 2 items',
  )
})

test('Ask-specific correction is not added to unrelated tools', () => {
  const parsed = z
    .strictObject({ command: z.string() })
    .safeParse({})
  expect(parsed.success).toBe(false)
  if (parsed.success) return

  const message = formatZodValidationError('Bash', parsed.error)
  expect(message).toContain('The required parameter `command` is missing')
  expect(message).not.toContain('AskUserQuestion requires')
})

test('Write missing-content errors state that no write occurred and never infer prose', () => {
  const parsed = z
    .strictObject({
      file_path: z.string(),
      content: z.string(),
    })
    .safeParse({
      file_path: '/Users/maith/Desktop/space/index.html',
    })
  expect(parsed.success).toBe(false)
  if (parsed.success) return

  const message = formatZodValidationError('Write', parsed.error)
  expect(message).toContain('The required parameter `content` is missing')
  expect(message).toContain('No file was written')
  expect(message).toContain(
    'both `file_path` and `content` in the same structured tool call',
  )
  expect(message).toContain(
    'Assistant prose outside the call is not file content',
  )
  expect(message).toContain(
    'do not repeat the unchanged call or claim the file was created',
  )
})
