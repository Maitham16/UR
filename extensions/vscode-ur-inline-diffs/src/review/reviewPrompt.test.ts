import { describe, expect, test } from 'bun:test'
import { buildReviewPrompt, LARGE_DIFF_THRESHOLD } from './reviewPrompt.js'

describe('buildReviewPrompt', () => {
  test('embeds the diff verbatim inside a fenced diff block', () => {
    const diff = 'diff --git a/foo.ts b/foo.ts\n+added line\n-removed line'
    const prompt = buildReviewPrompt(diff)
    expect(prompt).toContain('```diff')
    expect(prompt).toContain(diff)
    expect(prompt).toContain('```')
  })

  test('asks for correctness, style, and bug review', () => {
    const prompt = buildReviewPrompt('some diff')
    expect(prompt.toLowerCase()).toContain('correctness')
    expect(prompt.toLowerCase()).toContain('bug')
  })

  test('does not fabricate a diff when given an empty string', () => {
    const prompt = buildReviewPrompt('')
    expect(prompt).toContain('```diff\n\n```')
  })
})

describe('LARGE_DIFF_THRESHOLD', () => {
  test('is a positive, sane character-count threshold', () => {
    expect(LARGE_DIFF_THRESHOLD).toBeGreaterThan(1000)
    expect(Number.isInteger(LARGE_DIFF_THRESHOLD)).toBe(true)
  })
})
