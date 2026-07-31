import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  apiKeyInputWasModified,
  describeApiKeyProblem,
  sanitizeApiKeyInput,
} from '../src/services/providers/apiKeyInput.js'
import {
  hasUsableColumns,
  resolveImplicitInputColumns,
} from '../src/components/TextInput.js'
import { Cursor } from '../src/utils/Cursor.js'

const repoRoot = path.resolve(import.meta.dir, '..')

describe('provider API key sanitisation', () => {
  test('a pasted key keeps every non-control character', () => {
    const key = 'sk-proj-AbC123_-xyz.QRS789'
    expect(sanitizeApiKeyInput(key)).toBe(key)
    expect(apiKeyInputWasModified(key)).toBe(false)
  })

  test('trailing newline from a copied line is removed', () => {
    expect(sanitizeApiKeyInput('sk-test-abc\n')).toBe('sk-test-abc')
    expect(sanitizeApiKeyInput('sk-test-abc\r\n')).toBe('sk-test-abc')
    expect(apiKeyInputWasModified('sk-test-abc\n')).toBe(true)
  })

  test('embedded line breaks cannot survive into a stored key', () => {
    expect(sanitizeApiKeyInput('sk-part1\npart2')).toBe('sk-part1part2')
    expect(sanitizeApiKeyInput('sk-a b c')).toBe('sk-abc')
    expect(sanitizeApiKeyInput('sk-a\tb')).toBe('sk-ab')
  })

  test('a long key is never truncated', () => {
    const long = `sk-${'a'.repeat(400)}`
    expect(sanitizeApiKeyInput(long)).toHaveLength(403)
    expect(sanitizeApiKeyInput(`${long}\n`)).toBe(long)
  })

  test('empty and whitespace-only input is reported, not stored', () => {
    expect(sanitizeApiKeyInput('')).toBe('')
    expect(sanitizeApiKeyInput('   \n ')).toBe('')
    expect(describeApiKeyProblem('')).toBe('API key is empty.')
    expect(describeApiKeyProblem('  ')).toBe('API key is empty.')
  })

  test('an interior space is surfaced rather than silently accepted', () => {
    expect(describeApiKeyProblem('sk-abc def')).toMatch(/whitespace/)
    expect(describeApiKeyProblem('sk-abcdef')).toBeNull()
  })
})

describe('text input width resolution', () => {
  test('an omitted width never yields the 1-column wrap', () => {
    // normalizeCursorColumns floors a non-finite width at 2, and Cursor
    // subtracts one for the cursor cell — the exact path that rendered one
    // character per line in the provider key field.
    expect(hasUsableColumns(undefined)).toBe(false)
    expect(hasUsableColumns(0)).toBe(false)
    expect(hasUsableColumns(1)).toBe(false)
    expect(hasUsableColumns(80)).toBe(true)
    expect(resolveImplicitInputColumns(undefined)).toBeGreaterThan(2)
    expect(resolveImplicitInputColumns(100)).toBe(96)
    // A degenerate terminal size still resolves to a usable width.
    expect(resolveImplicitInputColumns(0)).toBeGreaterThanOrEqual(2)
    expect(resolveImplicitInputColumns(-5)).toBeGreaterThanOrEqual(2)
  })

  test('a key rendered at the resolved width stays on one line', () => {
    const key = `sk-proj-${'x'.repeat(40)}`
    const columns = resolveImplicitInputColumns(120)
    const rendered = Cursor.fromText(key, columns, key.length).render('', '*', s => s)
    expect(rendered).not.toContain('\n')
    expect(rendered).toHaveLength(key.length)
  })

  test('the pre-fix width reproduces the one-character-per-line failure', () => {
    // Guards the regression itself: with the old behaviour a 6-char value
    // wrapped into 6 lines. This asserts the broken input still breaks, so a
    // future refactor of normalizeCursorColumns cannot silently mask it.
    const brokenColumns = 2
    const rendered = Cursor.fromText('abcdef', brokenColumns, 6).render('', '', s => s)
    expect(rendered.split('\n')).toHaveLength(6)
  })

  test('typing left to right preserves order at a sane width', () => {
    let cursor = Cursor.fromText('', 80, 0)
    for (const ch of 'sk-abc') {
      cursor = cursor.insert(ch)
    }
    expect(cursor.text).toBe('sk-abc')
  })

  test('a pinned zero offset reverses the value (the offset defect)', () => {
    // Reproduces what an undefined cursorOffset did: every keystroke inserted
    // at the head because the offset was never advanced.
    let text = ''
    for (const ch of 'sk-abc') {
      text = Cursor.fromText(text, 80, 0).insert(ch).text
    }
    expect(text).toBe('cba-ks')
  })
})

describe('TextInput call sites', () => {
  test('every TextInput usage supplies an explicit wrap width', () => {
    // The provider key field regressed precisely because a `@ts-nocheck` file
    // omitted `columns`, which the compiler could not flag.
    const files = new Bun.Glob('src/**/*.tsx').scanSync(repoRoot)
    const offenders: string[] = []
    for (const relative of files) {
      const source = readFileSync(path.join(repoRoot, relative), 'utf8')
      // Match a <TextInput .../> element and check the attribute list.
      const elements = source.match(/<TextInput\b[\s\S]*?\/>/g) ?? []
      for (const element of elements) {
        // A spread carries the width through a typed props object; those are
        // covered by the BaseTextInputProps assertion below.
        if (element.includes('{...')) {
          continue
        }
        if (!/\bcolumns=/.test(element)) {
          offenders.push(relative)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('the spread call site builds a width-carrying typed props object', () => {
    const source = readFileSync(
      path.join(repoRoot, 'src/components/PromptInput/PromptInput.tsx'),
      'utf8',
    )
    expect(source).toContain('const baseProps: BaseTextInputProps = {')
    const block = source.slice(
      source.indexOf('const baseProps: BaseTextInputProps = {'),
    )
    expect(block.slice(0, 2000)).toMatch(/\bcolumns:/)
    expect(block.slice(0, 2000)).toMatch(/\bcursorOffset\b/)
  })

  test('the provider key field passes width, offset and setter explicitly', () => {
    const source = readFileSync(
      path.join(repoRoot, 'src/components/ProviderFirstModelPicker.tsx'),
      'utf8',
    )
    const element = source.match(/<TextInput\b[\s\S]*?\/>/)?.[0] ?? ''
    expect(element).toMatch(/columns=\{keyInputColumns\}/)
    expect(element).toMatch(/cursorOffset=\{apiKeyCursorOffset\}/)
    expect(element).toMatch(/onChangeCursorOffset=\{setApiKeyCursorOffset\}/)
    expect(element).toMatch(/mask="\*"/)
  })
})
