import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  ASK_USER_QUESTION_TOOL_PROMPT,
  PREVIEW_FEATURE_PROMPT,
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

test('the prompt specifies the nested bounds and a canonical JSON input', () => {
  expect(ASK_USER_QUESTION_TOOL_PROMPT).toContain('1-4 complete question objects')
  expect(ASK_USER_QUESTION_TOOL_PROMPT).toContain(
    'an `options` array with 2-8 option objects',
  )
  expect(ASK_USER_QUESTION_TOOL_PROMPT).toContain(
    'Never put option rows directly in the top-level `questions` array',
  )

  const canonical = ASK_USER_QUESTION_TOOL_PROMPT.match(
    /\n(\{"questions":\[[^\n]+\]\})\n/,
  )?.[1]
  expect(canonical).toBeDefined()
  expect(() => JSON.parse(canonical!)).not.toThrow()
})

test('the prompt limits questions to material blocking decisions', () => {
  expect(ASK_USER_QUESTION_TOOL_PROMPT).toContain('Do not over-question')
  expect(ASK_USER_QUESTION_TOOL_PROMPT).toContain(
    'ask the most blocking 1-4 first',
  )
  expect(ASK_USER_QUESTION_TOOL_PROMPT).toContain(
    'ask the remainder in a later round',
  )
})

test('HTML previews are documented as escaped inert text', () => {
  expect(PREVIEW_FEATURE_PROMPT.html).toContain('raw HTML is not accepted')
  expect(PREVIEW_FEATURE_PROMPT.html).toContain(
    'escaped and rendered as inert preformatted text',
  )
  expect(PREVIEW_FEATURE_PROMPT.html).toContain(
    'Do not include HTML tags, attributes, URLs, scripts, styles, event handlers',
  )
  expect(PREVIEW_FEATURE_PROMPT.html).not.toContain('use inline style attributes')
})

test('the description field asks for consequences, not a restatement', () => {
  const line = SCHEMA.split('\n').find(l =>
    l.includes('description: boundedText'),
  )
  expect(line).toBeDefined()
  expect(line).toContain('consequence, trade-off, or limitation')
  expect(line).toContain('never duplicate the label')
})

test('the label field says to name the choice, not echo the question', () => {
  expect(SCHEMA).toContain('concise name of this choice')
  expect(ASK_USER_QUESTION_TOOL_PROMPT).toContain(
    'It is not a restatement of the question',
  )
})

test('the header field says to name the dimension', () => {
  const line = SCHEMA.split('\n').find(l => l.includes('header: boundedText'))
  expect(line).toContain('naming the decision dimension')
  expect(line).toContain('not a shortened question')
})
