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

test('AskUserQuestion allows up to eight professional clarification options', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    question: 'Which professional redesign direction should I take?',
    options: [
      'Minimal',
      'Editorial',
      'Dashboard',
      'Enterprise',
      'Portfolio',
      'Commerce',
      'Documentation',
      'Experimental',
    ],
  })

  expect(parsed.success).toBe(true)
})

test('AskUserQuestion normalizes top-level choices alias into a single-question form', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    question: 'Which language should this task use?',
    choices: ['TypeScript', 'Rust'],
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.questions).toEqual([
    {
      question: 'Which language should this task use?',
      header: 'language',
      options: [
        {
          label: 'TypeScript',
          description: 'TypeScript',
        },
        {
          label: 'Rust',
          description: 'Rust',
        },
      ],
      multiSelect: false,
    },
  ])
})

test('AskUserQuestion normalizes top-level prompt alias question and choices alias', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    prompt: 'Which deployment target?',
    choices: ['Lambda', 'Cloud Run'],
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.questions[0]).toEqual({
    question: 'Which deployment target?',
    header: 'deployment',
    options: [
      { label: 'Lambda', description: 'Lambda' },
      { label: 'Cloud Run', description: 'Cloud Run' },
    ],
    multiSelect: false,
  })
})

test('AskUserQuestion normalizes per-question option aliases', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    questions: [
      {
        question: 'How should we ship?',
        option: [
          { label: 'Release', description: 'Ship now' },
          { label: 'Canary', description: 'Gradual rollout' },
        ],
      },
    ],
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.questions[0]).toEqual({
    question: 'How should we ship?',
    header: 'How',
    options: [
      { label: 'Release', description: 'Ship now' },
      { label: 'Canary', description: 'Gradual rollout' },
    ],
    multiSelect: false,
  })
})

test('AskUserQuestion normalizes questions provided as single-key objects', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    questions: {
      'Which runtime should we use?': ['Node', 'Bun', 'Deno'],
      'Which database should we use?': ['PostgreSQL', 'SQLite'],
    },
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.questions).toEqual([
    {
      question: 'Which runtime should we use?',
      header: 'runtime',
      options: [
        { label: 'Node', description: 'Node' },
        { label: 'Bun', description: 'Bun' },
        { label: 'Deno', description: 'Deno' },
      ],
      multiSelect: false,
    },
    {
      question: 'Which database should we use?',
      header: 'database',
      options: [
        { label: 'PostgreSQL', description: 'PostgreSQL' },
        { label: 'SQLite', description: 'SQLite' },
      ],
      multiSelect: false,
    },
  ])
})

test('AskUserQuestion infers option lists from delimited strings in non-array fields', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    questions: [
      {
        question: 'Which auth strategy?',
        choices: 'JWT|Session|OAuth',
      },
    ],
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.questions[0]).toEqual({
    question: 'Which auth strategy?',
    header: 'auth',
    options: [
      { label: 'JWT', description: 'JWT' },
      { label: 'Session', description: 'Session' },
      { label: 'OAuth', description: 'OAuth' },
    ],
    multiSelect: false,
  })
})

test('AskUserQuestion accepts object-form option lists and q shorthand', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    questions: [
      {
        q: 'Which runtime should we use?',
        options: {
          fast: 'go run',
          durable: 'bun run',
        },
      },
    ],
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.questions[0]).toEqual({
    question: 'Which runtime should we use?',
    header: 'runtime',
    options: [
      { label: 'go run', description: 'go run' },
      { label: 'bun run', description: 'bun run' },
    ],
    multiSelect: false,
  })
})

test('AskUserQuestion infers labels from description-only option objects', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    question: 'References or related work to cite?',
    options: [
      { description: 'No citations needed' },
      { description: 'Use README references' },
      { description: 'Use docs references' },
      { description: 'Use academic papers' },
      { description: 'Use public benchmarks' },
      { description: 'Ask me for sources' },
    ],
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.questions[0]?.options[5]?.label).toBe('Ask me for sources')
})

test('AskUserQuestion rejects unbounded clarification option lists', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    question: 'Which option should fail?',
    options: [
      'One',
      'Two',
      'Three',
      'Four',
      'Five',
      'Six',
      'Seven',
      'Eight',
      'Nine',
    ],
  })

  expect(parsed.success).toBe(false)
})

test('AskUserQuestion still rejects duplicate inferred option labels', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    question: 'Which duplicate option should fail?',
    options: ['Same', 'Same'],
  })

  expect(parsed.success).toBe(false)
})
