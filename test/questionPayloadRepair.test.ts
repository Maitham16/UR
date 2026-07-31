import { describe, expect, test } from 'bun:test'
import {
  dedupeOptions,
  dedupeQuestions,
  describeQuestionPayloadProblems,
  duplicateKey,
} from '../src/tools/AskUserQuestionTool/normalizeQuestions.js'
import { _sdkInputSchema } from '../src/tools/AskUserQuestionTool/AskUserQuestionTool.js'

function option(label: string, description = `about ${label}`) {
  return { label, description }
}

function question(text: string, labels: string[], extra: Record<string, unknown> = {}) {
  return {
    question: text,
    header: 'Topic',
    options: labels.map(l => option(l)),
    ...extra,
  }
}

describe('duplicate keys', () => {
  test('case and whitespace do not create distinct choices', () => {
    expect(duplicateKey('PostgreSQL')).toBe(duplicateKey('  postgresql '))
    expect(duplicateKey('Use  Postgres')).toBe('use postgres')
  })
})

describe('option de-duplication', () => {
  test('a repeated label is dropped, first occurrence kept', () => {
    const out = dedupeOptions([
      option('PostgreSQL', 'first'),
      option('postgresql', 'second'),
      option('SQLite'),
    ])
    expect(out).toHaveLength(2)
    expect((out[0] as { description: string }).description).toBe('first')
  })

  test('empty labels are dropped rather than rendered blank', () => {
    expect(dedupeOptions([option(''), option('  '), option('Real')])).toHaveLength(1)
  })

  test('malformed entries are left for the schema to report', () => {
    const out = dedupeOptions([null, 'raw-string', option('Real')])
    expect(out).toHaveLength(3)
  })
})

describe('question de-duplication', () => {
  test('a repeated question is asked once', () => {
    const out = dedupeQuestions([
      question('Which database?', ['PostgreSQL', 'SQLite']),
      question('which database?', ['MySQL', 'Oracle']),
    ])
    expect(out).toHaveLength(1)
    expect((out[0] as { options: unknown[] }).options).toHaveLength(2)
  })

  test('nested option duplicates are cleaned at the same time', () => {
    const out = dedupeQuestions([
      question('Which database?', ['PostgreSQL', 'PostgreSQL', 'SQLite']),
    ])
    expect((out[0] as { options: unknown[] }).options).toHaveLength(2)
  })

  test('distinct questions are all preserved in order', () => {
    const out = dedupeQuestions([
      question('A?', ['1', '2']),
      question('B?', ['3', '4']),
      question('C?', ['5', '6']),
    ])
    expect(out.map(q => (q as { question: string }).question)).toEqual(['A?', 'B?', 'C?'])
  })
})

describe('payload problems are described before rendering', () => {
  test('a renderable payload reports no problems', () => {
    expect(
      describeQuestionPayloadProblems({ questions: [question('Which DB?', ['A', 'B'])] }),
    ).toEqual([])
  })

  test('a missing header is named specifically', () => {
    const problems = describeQuestionPayloadProblems({
      questions: [{ question: 'Which DB?', options: [option('A'), option('B')] }],
    })
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('questions[0].header')
  })

  test('an open-ended question is called out as unaskable', () => {
    const problems = describeQuestionPayloadProblems({
      questions: [question('What should I do?', ['Only one'])],
    })
    expect(problems[0]).toContain('at least 2 distinct labels')
  })

  test('duplicate-only options count as a single distinct label', () => {
    const problems = describeQuestionPayloadProblems({
      questions: [question('Which DB?', ['Same', 'same'])],
    })
    expect(problems[0]).toContain('at least 2 distinct labels')
  })

  test('non-object and empty input are reported, not thrown', () => {
    expect(describeQuestionPayloadProblems(null)[0]).toContain('must be an object')
    expect(describeQuestionPayloadProblems({ questions: [] })[0]).toContain('non-empty array')
  })
})

describe('schema accepts payloads that previously required a retry', () => {
  const schema = _sdkInputSchema()

  test('a duplicated option label now parses instead of failing', () => {
    const result = schema.safeParse({
      questions: [question('Which database?', ['PostgreSQL', 'PostgreSQL', 'SQLite'])],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.questions[0]!.options).toHaveLength(2)
    }
  })

  test('a duplicated question now parses instead of failing', () => {
    const result = schema.safeParse({
      questions: [
        question('Which database?', ['PostgreSQL', 'SQLite']),
        question('Which database?', ['MySQL', 'Oracle']),
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.questions).toHaveLength(1)
    }
  })

  test('titles, descriptions, defaults and multiSelect survive the repair', () => {
    const result = schema.safeParse({
      questions: [
        {
          question: 'Which features?',
          header: 'Features',
          multiSelect: true,
          options: [
            { label: 'Auth', description: 'Adds login; needs a session store.' },
            { label: 'Auth', description: 'duplicate that should vanish' },
            { label: 'Billing', description: 'Adds invoices; needs a payment key.' },
          ],
        },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      const q = result.data.questions[0]!
      expect(q.question).toBe('Which features?')
      expect(q.header).toBe('Features')
      expect(q.multiSelect).toBe(true)
      expect(q.options.map(o => o.label)).toEqual(['Auth', 'Billing'])
      expect(q.options[0]!.description).toBe('Adds login; needs a session store.')
    }
  })

  test('multiSelect still defaults to false when omitted', () => {
    const result = schema.safeParse({ questions: [question('Which DB?', ['A', 'B'])] })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.questions[0]!.multiSelect).toBe(false)
    }
  })

  test('a genuinely unaskable question is still rejected', () => {
    // Repair must not manufacture a second choice.
    const result = schema.safeParse({
      questions: [question('What should I do?', ['Only one'])],
    })
    expect(result.success).toBe(false)
  })

  test('the alias and JSON-string forms still parse', () => {
    const result = schema.safeParse({
      questions: JSON.stringify([
        {
          prompt: 'Which database?',
          choices: [
            { label: 'PostgreSQL', description: 'Relational; needs a server.' },
            { label: 'SQLite', description: 'Embedded; single file.' },
          ],
        },
      ]),
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.questions[0]!.question).toBe('Which database?')
      expect(result.data.questions[0]!.header.length).toBeGreaterThan(0)
    }
  })

  test('top-level prompt + choices aliases are normalized', () => {
    const result = schema.safeParse({
      prompt: 'Which deployment target should we use?',
      choices: ['Lambda', 'Cloud Run'],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.questions).toEqual([
        {
          question: 'Which deployment target should we use?',
          header: 'deployment',
          options: [
            { label: 'Lambda', description: 'Lambda' },
            { label: 'Cloud Run', description: 'Cloud Run' },
          ],
          multiSelect: false,
        },
      ])
    }
  })

  test('per-question option alias is normalized', () => {
    const result = schema.safeParse({
      questions: [
        {
          question: 'Which rollout style?',
          option: [
            { label: 'Canary', description: 'Gradual users.' },
            { label: 'Blue/Green' },
          ],
        },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.questions[0]!.options).toHaveLength(2)
      expect(result.data.questions[0]!.options[0]!.label).toBe('Canary')
      expect(result.data.questions[0]!.options[1]!.label).toBe('Blue/Green')
    }
  })

  test('previews are preserved through the repair', () => {
    const result = schema.safeParse({
      questions: [
        {
          question: 'Which layout?',
          header: 'Layout',
          options: [
            { label: 'Grid', description: 'Even columns.', preview: '<grid/>' },
            { label: 'List', description: 'One per row.', preview: '<list/>' },
          ],
        },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.questions[0]!.options[0]!.preview).toBe('<grid/>')
    }
  })
})
