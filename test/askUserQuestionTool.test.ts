import { expect, test } from 'bun:test'
import { AskUserQuestionTool } from '../src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx'

test('AskUserQuestion infers missing headers and option descriptions', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    questions: [
      {
        question: 'What should the agent clarify first?',
        options: [
          {
            label: 'Requirements',
            value: 'requirements',
          },
          {
            label: 'Implementation approach',
            description: 'Ask about the implementation direction before coding.',
          },
        ],
      },
    ],
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data).toEqual({
    questions: [
      {
        question: 'What should the agent clarify first?',
        header: 'agent',
        options: [
          {
            label: 'Requirements',
            description: 'Requirements',
          },
          {
            label: 'Implementation approach',
            description: 'Ask about the implementation direction before coding.',
          },
        ],
        multiSelect: false,
      },
    ],
  })
})

test('AskUserQuestion accepts a single top-level question with string options', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    question: 'Which direction should I take?',
    options: ['Small fix', 'Larger refactor'],
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.questions).toEqual([
    {
      question: 'Which direction should I take?',
      header: 'direction',
      options: [
        {
          label: 'Small fix',
          description: 'Small fix',
        },
        {
          label: 'Larger refactor',
          description: 'Larger refactor',
        },
      ],
      multiSelect: false,
    },
  ])
})

test('AskUserQuestion still rejects duplicate inferred option labels', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    question: 'Which duplicate option should fail?',
    options: ['Same', 'Same'],
  })

  expect(parsed.success).toBe(false)
})
