import { expect, test } from 'bun:test'
import {
  AskUserQuestionTool,
  normalizeAskUserQuestionInput,
} from '../src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx'
import {
  describeQuestionPayloadProblems,
  describeQuestionPayloadShape,
} from '../src/tools/AskUserQuestionTool/normalizeQuestions.js'

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

test('AskUserQuestion drops malformed question entries but keeps valid ones', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    questions: [
      null,
      { question: 'Which engine?', options: ['Pygame', 'Unity'] },
      '',
      { foo: 'bar' },
      { text: 'Which language?', choices: ['TypeScript', 'Python'] },
    ],
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.questions).toEqual([
    {
      question: 'Which engine?',
      header: 'engine',
      options: [
        { label: 'Pygame', description: 'Pygame' },
        { label: 'Unity', description: 'Unity' },
      ],
      multiSelect: false,
    },
    {
      question: 'Which language?',
      header: 'language',
      options: [
        { label: 'TypeScript', description: 'TypeScript' },
        { label: 'Python', description: 'Python' },
      ],
      multiSelect: false,
    },
  ])
})

test('AskUserQuestion fails fast when every question entry is malformed', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    questions: [null, '', { foo: 'bar' }],
  })
  expect(parsed.success).toBe(false)
})

// An unrepairable payload must still be reported as what the model sent.
// Returning null instead erased it, so the model was told its `questions`
// array was missing when the array was there and one entry lacked options —
// a diagnosis it could not act on.
test('AskUserQuestion reports the real defect when repair is impossible', () => {
  const input = {
    questions: [{ question: 'What should I do next?', header: 'Next' }],
  }

  expect(normalizeAskUserQuestionInput(input)).not.toBeNull()
  expect(describeQuestionPayloadProblems(normalizeAskUserQuestionInput(input))).toEqual([
    'questions[0].options must be an array.',
  ])
  // The shape is reported separately, so the problem list stays a list of
  // problems and callers can keep asserting its length.
  expect(
    describeQuestionPayloadShape(normalizeAskUserQuestionInput(input)),
  ).toContain('has keys: question, header')
})

// Models routinely flatten one question's choices straight into `questions`,
// so six options arrive as six question objects carrying a label and a
// description and no question text. That produced a paired "question must be a
// non-empty string / options must be an array" error for every entry.
test('AskUserQuestion folds flattened option lists back into one question', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    question: 'Which areas should I audit next?',
    questions: [
      { label: 'Providers', description: 'Audit every provider adapter' },
      { label: 'UI', description: 'Audit terminal UI components' },
      { label: 'Workflows', description: 'Audit workflow execution' },
      { label: 'Memory', description: 'Audit context and memory' },
      { label: 'Plugins', description: 'Audit plugin loading' },
      { label: 'Sessions', description: 'Audit session persistence' },
    ],
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.questions).toHaveLength(1)
  expect(parsed.data.questions[0]!.question).toBe(
    'Which areas should I audit next?',
  )
  // The model's own labels, carried through untouched.
  expect(parsed.data.questions[0]!.options.map(o => o.label)).toEqual([
    'Providers',
    'UI',
    'Workflows',
    'Memory',
    'Plugins',
    'Sessions',
  ])
})

// `header` is this tool's word for a short label, so a model naming a choice
// reaches for it. Eight options arrived as eight question objects carrying a
// header and a description — every entry reporting a missing question and
// missing options, and never a missing header, which is what identified it.
test('AskUserQuestion folds header-labelled choices back into one question', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    question: 'Which area should I take next?',
    questions: Array.from({ length: 8 }, (_, i) => ({
      header: `Area${i + 1}`,
      description: `Audit area ${i + 1}`,
    })),
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.questions).toHaveLength(1)
  expect(parsed.data.questions[0]!.options).toHaveLength(8)
  expect(parsed.data.questions[0]!.options[0]).toMatchObject({
    label: 'Area1',
    description: 'Audit area 1',
  })
})

// Naming what arrived is the one fact that separates an unrepairable payload
// from a repairable shape the normalizer has not been taught yet.
test('AskUserQuestion reports the keys it actually received', () => {
  const normalized = normalizeAskUserQuestionInput({
    questions: [{ header: 'A', description: 'a' }],
  })

  expect(describeQuestionPayloadProblems(normalized).length).toBeGreaterThan(0)
  expect(describeQuestionPayloadShape(normalized)).toContain(
    'has keys: header, description',
  )
})

test('AskUserQuestion recovery never retargets a genuine multi-question payload', () => {
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    questions: [
      {
        question: 'Which DB?',
        header: 'DB',
        options: [
          { label: 'PG', description: 'x' },
          { label: 'SQLite', description: 'y' },
        ],
      },
      {
        question: 'Which language?',
        header: 'Lang',
        options: [
          { label: 'TypeScript', description: 'x' },
          { label: 'Go', description: 'y' },
        ],
      },
    ],
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.questions).toHaveLength(2)
})

test('AskUserQuestion renders flattened choices when question text is omitted', () => {
  // Exact production failure: eight entries with these three keys produced a
  // missing-question and missing-options pair for every entry.
  const parsed = AskUserQuestionTool.inputSchema.safeParse({
    questions: Array.from({ length: 8 }, (_, index) => ({
      description: `Description ${index + 1}`,
      header: `Header ${index + 1}`,
      label: `Option ${index + 1}`,
    })),
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.questions).toHaveLength(1)
  expect(parsed.data.questions[0]).toMatchObject({
    question: 'Which option should I choose?',
    header: 'option',
  })
  expect(parsed.data.questions[0]!.options).toHaveLength(8)
  expect(parsed.data.questions[0]!.options[0]).toEqual({
    label: 'Option 1',
    description: 'Description 1',
  })
})

test('AskUserQuestion preserves an unrecognized payload shape for diagnosis', () => {
  for (const input of [{}, { questions: [] }, { questions: 'what next?' }]) {
    const normalized = normalizeAskUserQuestionInput(input)
    expect(normalized).not.toBeNull()
    expect(describeQuestionPayloadProblems(normalized)).toEqual([
      '`questions` must be a non-empty array.',
    ])
  }
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
