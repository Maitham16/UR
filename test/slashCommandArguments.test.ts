import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { parseArguments } from '../src/utils/argumentSubstitution.ts'

// `/btw what is left?` arrived as "what is". shell-quote classifies `left?` as
// a glob and `&`, `>`, `(` as operators, and parseArguments kept only string
// tokens — so any question mark silently truncated the user's message. These
// are command arguments, usually plain English, not a shell pipeline.

test('a trailing question mark no longer truncates the message', () => {
  expect(parseArguments('what is left?')).toEqual(['what', 'is', 'left?'])
  expect(parseArguments('why does this fail?')).toEqual([
    'why',
    'does',
    'this',
    'fail?',
  ])
})

test('a question mark mid-message does not drop that word', () => {
  expect(parseArguments('is it done? tell me')).toEqual([
    'is',
    'it',
    'done?',
    'tell',
    'me',
  ])
})

test('glob-looking text survives as typed', () => {
  // Previously returned just ['read'] — the path vanished entirely.
  expect(parseArguments('read src/*.ts')).toEqual(['read', 'src/*.ts'])
})

test('shell operators the user typed as prose are kept', () => {
  expect(parseArguments('compare A & B')).toEqual(['compare', 'A', '&', 'B'])
  expect(parseArguments('cost > budget')).toEqual(['cost', '>', 'budget'])
  expect(parseArguments('fix the bug (urgent)')).toEqual([
    'fix',
    'the',
    'bug',
    '(',
    'urgent',
    ')',
  ])
})

test('ordinary and quoted arguments are unchanged', () => {
  expect(parseArguments('plain words here')).toEqual([
    'plain',
    'words',
    'here',
  ])
  expect(parseArguments('"quoted phrase" tail')).toEqual([
    'quoted phrase',
    'tail',
  ])
  expect(parseArguments('')).toEqual([])
  expect(parseArguments('   ')).toEqual([])
})

test('btw sends the question verbatim rather than rejoined tokens', () => {
  // Even with every token preserved, tokens.join(' ') collapses whitespace and
  // respaces punctuation — "the bug (urgent)" would become "the bug ( urgent )".
  // Only the subcommand needs tokenizing.
  const source = readFileSync('src/commands/btw/btw.tsx', 'utf8')
  expect(source).toContain('question = raw')
  expect(source).not.toContain("question = tokens.join(' ')")
  expect(source).not.toContain("tokens.slice(2).join(' ')")
})
