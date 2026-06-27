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

test('AskUserQuestion accepts prompt aliases and infers option descriptions', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    questions: [
      {
        prompt: 'Which game should I build from "Mario egg"?',
        options: [
          { label: 'Platformer' },
          { label: 'Egg puzzle' },
          { label: 'Pet sim' },
        ],
      },
      {
        text: 'Which visual style should I use?',
        options: [
          { label: 'Pixel art' },
          { label: 'Cartoon' },
          { label: 'Minimal' },
        ],
      },
    ],
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.questions).toEqual([
    {
      question: 'Which game should I build from "Mario egg"?',
      header: 'game',
      options: [
        { label: 'Platformer', description: 'Platformer' },
        { label: 'Egg puzzle', description: 'Egg puzzle' },
        { label: 'Pet sim', description: 'Pet sim' },
      ],
      multiSelect: false,
    },
    {
      question: 'Which visual style should I use?',
      header: 'visual',
      options: [
        { label: 'Pixel art', description: 'Pixel art' },
        { label: 'Cartoon', description: 'Cartoon' },
        { label: 'Minimal', description: 'Minimal' },
      ],
      multiSelect: false,
    },
  ])
})

test('AskUserQuestion is available without ToolSearch preloading', () => {
  expect(AskUserQuestionTool.shouldDefer).toBe(false)
})

test('AskUserQuestion still rejects duplicate inferred option labels', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    question: 'Which duplicate option should fail?',
    options: ['Same', 'Same'],
  })

  expect(parsed.success).toBe(false)
})
