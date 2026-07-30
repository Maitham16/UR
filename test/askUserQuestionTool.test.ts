import { expect, test } from 'bun:test'
import { setQuestionPreviewFormat } from '../src/bootstrap/state.ts'
import { AskUserQuestionTool } from '../src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx'

function validQuestion(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    question: 'Which direction should I take?',
    header: 'Direction',
    options: [
      { label: 'Small fix', description: 'Lower risk and narrower scope.' },
      {
        label: 'Larger refactor',
        description: 'More cleanup now, with a wider review surface.',
      },
    ],
    ...overrides,
  }
}

test('AskUserQuestion infers a header without fabricating descriptions', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    questions: [
      {
        question: 'What should the agent clarify first?',
        options: [
          { label: 'Requirements' },
          {
            label: 'Implementation approach',
            description: 'Clarify the implementation direction before coding.',
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
          { label: 'Requirements' },
          {
            label: 'Implementation approach',
            description: 'Clarify the implementation direction before coding.',
          },
        ],
      },
    ],
  })
})

test('AskUserQuestion normalizes top-level string options losslessly', () => {
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
      options: [{ label: 'Small fix' }, { label: 'Larger refactor' }],
    },
  ])
})

test('AskUserQuestion accepts question aliases without inventing option text', () => {
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
        { label: 'Platformer' },
        { label: 'Egg puzzle' },
        { label: 'Pet sim' },
      ],
    },
    {
      question: 'Which visual style should I use?',
      header: 'visual',
      options: [
        { label: 'Pixel art' },
        { label: 'Cartoon' },
        { label: 'Minimal' },
      ],
    },
  ])
})

test('AskUserQuestion rejects description-only and value-only option objects', () => {
  for (const ambiguousOption of [
    { description: 'No citations needed' },
    { value: 'no-citations' },
  ]) {
    const parsed = AskUserQuestionTool.inputSchema.safeParse({
      question: 'Which citation policy?',
      options: [{ label: 'Use citations' }, ambiguousOption],
    })
    expect(parsed.success).toBe(false)
  }
})

test('AskUserQuestion is available without ToolSearch preloading', () => {
  expect(AskUserQuestionTool.shouldDefer).toBe(false)
})

test('AskUserQuestion enforces question, option, and text bounds', () => {
  const invalidInputs = [
    { questions: [] },
    {
      questions: Array.from({ length: 5 }, (_, index) =>
        validQuestion({
          question: `Question ${index}?`,
          header: `Q${index}`,
        }),
      ),
    },
    {
      questions: [
        validQuestion({ options: [{ label: 'Only choice' }] }),
      ],
    },
    {
      questions: [
        validQuestion({
          options: Array.from({ length: 9 }, (_, index) => ({
            label: `Choice ${index}`,
          })),
        }),
      ],
    },
    { questions: [validQuestion({ question: 'Q'.repeat(501) })] },
    { questions: [validQuestion({ header: 'H'.repeat(13) })] },
    {
      questions: [
        validQuestion({
          options: [{ label: 'L'.repeat(81) }, { label: 'Valid' }],
        }),
      ],
    },
    {
      questions: [
        validQuestion({
          options: [
            { label: 'Verbose', description: 'D'.repeat(501) },
            { label: 'Valid' },
          ],
        }),
      ],
    },
    {
      questions: [
        validQuestion({
          options: [
            { label: 'Long preview', preview: 'P'.repeat(16 * 1024 + 1) },
            { label: 'Valid' },
          ],
        }),
      ],
    },
  ]

  for (const input of invalidInputs) {
    expect(AskUserQuestionTool.inputSchema.safeParse(input).success).toBe(false)
  }
})

test('AskUserQuestion accepts the canonical four-question and eight-option maxima', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    questions: Array.from({ length: 4 }, (_, questionIndex) =>
      validQuestion({
        question: `Question ${questionIndex}?`,
        header: `Q${questionIndex}`,
        options: Array.from({ length: 8 }, (_, optionIndex) => ({
          label: `Q${questionIndex} choice ${optionIndex}`,
        })),
      }),
    ),
  })

  expect(parsed.success).toBe(true)
})

test('AskUserQuestion rejects duplicate questions and option labels case-insensitively', () => {
  const duplicateQuestions = AskUserQuestionTool.inputSchema.safeParse({
    questions: [
      validQuestion({ question: 'Which database?' }),
      validQuestion({
        question: 'WHICH DATABASE?',
        header: 'Database 2',
      }),
    ],
  })
  expect(duplicateQuestions.success).toBe(false)

  const duplicateOptions = AskUserQuestionTool.inputSchema.safeParse({
    questions: [
      validQuestion({
        options: [{ label: 'PostgreSQL' }, { label: 'postgresql' }],
      }),
    ],
  })
  expect(duplicateOptions.success).toBe(false)
})

test('AskUserQuestion rejects reserved question keys', () => {
  for (const question of [
    '__proto__',
    'constructor',
    'prototype',
    'toString',
    'valueOf',
  ]) {
    const parsed = AskUserQuestionTool.inputSchema.safeParse({
      questions: [validQuestion({ question })],
    })
    expect(parsed.success).toBe(false)
  }
})

test('model input schema exposes request fields only and accurate required fields', () => {
  const schema = AskUserQuestionTool.inputJSONSchema as {
    required?: string[]
    properties?: Record<string, any>
  }
  expect(schema.required).toEqual(['questions'])
  expect(schema.properties).not.toHaveProperty('answers')
  expect(schema.properties).not.toHaveProperty('annotations')

  const questions = schema.properties?.questions
  expect(questions.minItems).toBe(1)
  expect(questions.maxItems).toBe(4)
  const question = questions.items
  expect([...question.required].sort()).toEqual([
    'header',
    'options',
    'question',
  ])
  expect(question.required).not.toContain('multiSelect')
  expect(question.properties.options.minItems).toBe(2)
  expect(question.properties.options.maxItems).toBe(8)
  expect(question.properties.options.items.required).toEqual(['label'])
  expect(
    question.properties.options.items.required,
  ).not.toContain('description')
})

test('HTML previews are escaped before validation and raw bypasses are rejected', async () => {
  setQuestionPreviewFormat('html')
  try {
    const rawPreview = '<img src="x" onerror="alert(1)">'
    const parsed = AskUserQuestionTool.inputSchema.safeParse({
      questions: [
        validQuestion({
          options: [
            { label: 'Preview', preview: rawPreview },
            { label: 'No preview' },
          ],
        }),
      ],
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return

    const preview = parsed.data.questions[0]?.options[0]?.preview
    expect(preview).toStartWith('<pre data-ur-preview="text">')
    expect(preview).toContain('&lt;img')
    expect(preview).not.toContain('<img')
    await expect(
      AskUserQuestionTool.validateInput?.(
        parsed.data,
        {} as never,
      ),
    ).resolves.toEqual({ result: true })

    const rawBypass = {
      ...parsed.data,
      questions: [
        {
          ...parsed.data.questions[0]!,
          options: [
            { label: 'Preview', preview: rawPreview },
            { label: 'No preview' },
          ],
        },
      ],
    }
    await expect(
      AskUserQuestionTool.validateInput?.(
        rawBypass,
        {} as never,
      ),
    ).resolves.toMatchObject({
      result: false,
      message: expect.stringContaining('raw model-provided HTML'),
    })
  } finally {
    setQuestionPreviewFormat('markdown')
  }
})

test('AskUserQuestion rejects previews on multi-select questions', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    questions: [
      validQuestion({
        multiSelect: true,
        options: [
          { label: 'One', preview: 'Preview one' },
          { label: 'Two' },
        ],
      }),
    ],
  })
  expect(parsed.success).toBe(false)
})

test('AskUserQuestion separates initial request validation from trusted answers', async () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    questions: [validQuestion()],
  })
  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  const questionText = parsed.data.questions[0]!.question

  await expect(
    AskUserQuestionTool.validateInput?.(
      parsed.data,
      {} as never,
    ),
  ).resolves.toEqual({ result: true })

  await expect(
    AskUserQuestionTool.validateInput?.(
      {
        ...parsed.data,
        answers: { [questionText]: 'Small fix' },
      },
      {} as never,
    ),
  ).resolves.toMatchObject({
    result: false,
    message: expect.stringContaining('response fields'),
  })

  await expect(
    AskUserQuestionTool.validateInput?.(
      parsed.data,
      { validationPhase: 'post-permission' } as never,
    ),
  ).resolves.toMatchObject({
    result: false,
    message: expect.stringContaining('No verified user answers'),
  })

  await expect(
    AskUserQuestionTool.validateInput?.(
      {
        ...parsed.data,
        answers: { [questionText]: 'Small fix' },
      },
      { validationPhase: 'post-permission' } as never,
    ),
  ).resolves.toEqual({ result: true })

  await expect(
    AskUserQuestionTool.validateInput?.(
      {
        ...parsed.data,
        answers: { 'Unexpected question': 'Small fix' },
      },
      { validationPhase: 'post-permission' } as never,
    ),
  ).resolves.toMatchObject({
    result: false,
    message: expect.stringContaining(
      'exactly one entry for every question',
    ),
  })
})
