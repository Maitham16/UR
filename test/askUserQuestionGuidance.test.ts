import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  ASK_USER_QUESTION_TOOL_PROMPT,
  DESCRIPTION,
} from '../src/tools/AskUserQuestionTool/prompt.ts'

// Choice menus were arriving with all three fields saying the same thing: the
// header restated the question and the description paraphrased the label, so
// the only field with room to be informative carried nothing. The schema and
// prompt never said the fields must differ, so the model had no reason to
// make them differ.

const SCHEMA = readFileSync(
  'src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx',
  'utf8',
)
const SYSTEM_PROMPT_SOURCE = readFileSync('src/constants/prompts.ts', 'utf8')

test('the prompt states the three fields must carry different information', () => {
  expect(ASK_USER_QUESTION_TOOL_PROMPT).toContain('DIFFERENT information')
  // Naming the failure explicitly is what stops it; a vague "be descriptive"
  // is what produced the restatements in the first place.
  expect(ASK_USER_QUESTION_TOOL_PROMPT).toContain('must not paraphrase the label')
})

test('the prompt shows a worked bad and good example', () => {
  // An abstract rule is easy to satisfy nominally. A contrasted pair is not.
  expect(ASK_USER_QUESTION_TOOL_PROMPT).toContain('Bad')
  expect(ASK_USER_QUESTION_TOOL_PROMPT).toContain('Good')
  const bad = ASK_USER_QUESTION_TOOL_PROMPT.indexOf('Bad')
  const good = ASK_USER_QUESTION_TOOL_PROMPT.indexOf('Good')
  expect(good).toBeGreaterThan(bad)
  // The good example must demonstrate a real trade-off, not just be shorter.
  expect(ASK_USER_QUESTION_TOOL_PROMPT).toContain('no concurrent writers')
})

test('the description field asks for consequences, not a restatement', () => {
  const line = SCHEMA.split('\n').find(l => l.includes('description: z.string()'))
  expect(line).toBeDefined()
  expect(line).toContain('What actually happens if this is chosen')
  expect(line).toContain('NOT restate the label')
})

test('the label field says to name the choice, not echo the question', () => {
  const line = SCHEMA.split('\n').find(l => l.includes('label: z.string()'))
  expect(line).toContain('do not restate the question')
})

test('the header field says to name the dimension', () => {
  const line = SCHEMA.split('\n').find(l => l.includes('header: z.string()'))
  expect(line).toContain('Name the dimension')
})

test('choice-based questions are required to use the tool', () => {
  expect(DESCRIPTION).toContain('mandatory for every user-facing question')
  expect(ASK_USER_QUESTION_TOOL_PROMPT).toContain(
    'REQUIRED for every real user-facing question',
  )
  expect(ASK_USER_QUESTION_TOOL_PROMPT).toContain(
    'Never ask such a question in plain assistant text',
  )
  expect(SYSTEM_PROMPT_SOURCE).toContain(
    'MANDATORY for every real user-facing question',
  )
  expect(SYSTEM_PROMPT_SOURCE).toContain(
    'NEVER write such a question or its choices as plain prose',
  )
})

test('plain text is reserved for questions with no concrete choices', () => {
  expect(DESCRIPTION).toContain(
    'genuinely open-ended and no useful concrete choices can be formed',
  )
  expect(ASK_USER_QUESTION_TOOL_PROMPT).toContain(
    'genuinely open-ended and no meaningful concrete choices can be formed',
  )
  expect(SYSTEM_PROMPT_SOURCE).toContain(
    'genuinely open-ended and no meaningful concrete choices can be formed',
  )
})

test('large legitimate choice sets are preserved', () => {
  expect(ASK_USER_QUESTION_TOOL_PROMPT).toContain(
    'include every meaningful option when a legitimate decision has more than eight',
  )
  expect(SYSTEM_PROMPT_SOURCE).toContain(
    'preserve every meaningful option when a legitimate decision has more than eight',
  )
})
