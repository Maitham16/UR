import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  CHOICE_LIST_CHROME_ROWS,
  MIN_VISIBLE_CHOICES,
  visibleChoiceCount,
} from '../src/components/permissions/AskUserQuestionPermissionRequest/choiceListLayout.js'

const repoRoot = path.resolve(import.meta.dir, '..')

describe('question choice list sizing', () => {
  test('four choices plus Other stay in one continuous list', () => {
    // The select default of 5 windowed this exact case, detaching the tail.
    expect(visibleChoiceCount(5, 40)).toBe(5)
  })

  test('more than four choices are not windowed on a normal terminal', () => {
    for (const count of [5, 6, 7, 8, 9, 10]) {
      expect(visibleChoiceCount(count, 40)).toBe(count)
    }
  })

  test('a short terminal windows rather than overflowing', () => {
    const rows = CHOICE_LIST_CHROME_ROWS + 4
    expect(visibleChoiceCount(20, rows)).toBeLessThan(20)
    expect(visibleChoiceCount(20, rows)).toBeGreaterThanOrEqual(MIN_VISIBLE_CHOICES)
  })

  test('a very short terminal still shows a navigable minimum', () => {
    expect(visibleChoiceCount(12, 4)).toBe(MIN_VISIBLE_CHOICES)
    expect(visibleChoiceCount(12, 1)).toBe(MIN_VISIBLE_CHOICES)
  })

  test('an unknown terminal height falls back without windowing small lists', () => {
    expect(visibleChoiceCount(5, undefined)).toBe(5)
  })

  test('never returns more entries than the list holds', () => {
    expect(visibleChoiceCount(2, 200)).toBe(2)
    expect(visibleChoiceCount(1, 200)).toBe(1)
  })

  test('degenerate counts are clamped, not thrown', () => {
    expect(visibleChoiceCount(0, 40)).toBe(MIN_VISIBLE_CHOICES)
    expect(visibleChoiceCount(-3, 40)).toBe(MIN_VISIBLE_CHOICES)
    expect(visibleChoiceCount(Number.NaN, 40)).toBe(MIN_VISIBLE_CHOICES)
  })

  test('an extra description row per option shrinks the budget', () => {
    const rows = CHOICE_LIST_CHROME_ROWS + 8
    expect(visibleChoiceCount(8, rows, 0)).toBe(8)
    expect(visibleChoiceCount(8, rows, 1)).toBeLessThan(8)
  })
})

describe('question view wiring', () => {
  test('both select modes receive the computed count', () => {
    const source = readFileSync(
      path.join(
        repoRoot,
        'src/components/permissions/AskUserQuestionPermissionRequest/QuestionView.tsx',
      ),
      'utf8',
    )
    const occurrences = source.match(/visibleOptionCount=\{choiceCount\}/g) ?? []
    // One for SelectMulti, one for Select.
    expect(occurrences).toHaveLength(2)
    expect(source).toContain('visibleChoiceCount(options.length')
  })
})
