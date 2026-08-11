import { describe, expect, test } from 'bun:test'
import {
  advanceInsertModeEscapeSequence,
  isValidVimEscapeSequence,
} from '../src/vim/insertModeRemap.js'

describe('Vim insert-mode escape sequence', () => {
  test('matches a configured multi-key sequence without delaying input', () => {
    const first = advanceInsertModeEscapeSequence('', 'j', 'jj')
    expect(first).toEqual({ buffer: 'j', matched: false })
    expect(advanceInsertModeEscapeSequence(first.buffer, 'j', 'jj')).toEqual({
      buffer: '',
      matched: true,
      removeFromExisting: 1,
      insertBeforeEscape: '',
    })
  })

  test('preserves pasted text before a trailing escape sequence', () => {
    expect(advanceInsertModeEscapeSequence('', 'hellojj', 'jj')).toEqual({
      buffer: '',
      matched: true,
      removeFromExisting: 0,
      insertBeforeEscape: 'hello',
    })
  })

  test('keeps only a useful partial suffix and validates safe sequences', () => {
    expect(advanceInsertModeEscapeSequence('j', 'x', 'jj')).toEqual({
      buffer: '',
      matched: false,
    })
    expect(isValidVimEscapeSequence('jk')).toBe(true)
    expect(isValidVimEscapeSequence('j')).toBe(false)
    expect(isValidVimEscapeSequence('j j')).toBe(false)
  })
})
