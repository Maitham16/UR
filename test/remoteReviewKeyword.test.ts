import { describe, expect, test } from 'bun:test'
import { findRemoteReviewTriggerPositions } from '../src/utils/remoteReviewKeyword.js'

describe('remote review keyword detection', () => {
  test('preserves active ultrareview prompt highlighting', () => {
    expect(findRemoteReviewTriggerPositions('please ultrareview these changes')).toEqual([
      { word: 'ultrareview', start: 7, end: 18 },
    ])
    expect(findRemoteReviewTriggerPositions('ULTRAREVIEW!')).toEqual([
      { word: 'ULTRAREVIEW', start: 0, end: 11 },
    ])
  })

  test('ignores quoted, path-like, question, and slash-command mentions', () => {
    for (const input of [
      '`ultrareview`',
      '"ultrareview"',
      'src/ultrareview/index.ts',
      '--ultrareview-mode',
      'ultrareview.tsx',
      'ultrareview?',
      '/rename ultrareview session',
    ]) {
      expect(findRemoteReviewTriggerPositions(input)).toEqual([])
    }
  })
})
