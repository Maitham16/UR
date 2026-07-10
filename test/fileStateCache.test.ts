import { describe, expect, test } from 'bun:test'
import { fileStateMatchesContent, type FileState } from '../src/utils/fileStateCache.ts'

function state(content: string, offset?: number, limit?: number): FileState {
  return { content, timestamp: 1, offset, limit }
}

describe('fileStateMatchesContent', () => {
  test('matches and rejects full snapshots by content, independent of timestamps', () => {
    expect(fileStateMatchesContent('alpha\nbeta', state('alpha\nbeta'))).toBe(true)
    expect(fileStateMatchesContent('alpha\nchanged', state('alpha\nbeta'))).toBe(false)
  })

  test('compares the exact one-based line range for partial reads', () => {
    const partial = state('beta\ngamma', 2, 2)
    expect(fileStateMatchesContent('alpha\nbeta\ngamma\ndelta', partial)).toBe(true)
    expect(fileStateMatchesContent('alpha\nbeta\nchanged\ndelta', partial)).toBe(false)
  })

  test('never treats auto-injected partial views as editable snapshots', () => {
    expect(fileStateMatchesContent('same', { ...state('same'), isPartialView: true })).toBe(false)
  })
})
