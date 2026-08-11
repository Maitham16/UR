import { afterEach, describe, expect, test } from 'bun:test'
import {
  consumeScreenReaderAnnouncements,
  describeScreenReaderEdit,
  diffScreenReaderText,
  enableScreenReaderMode,
  resetScreenReaderForTest,
} from '../src/utils/screenReader.js'

describe('screen reader mode', () => {
  afterEach(() => {
    delete process.env.UR_SCREEN_READER
    delete process.env.UR_CODE_ACCESSIBILITY
    resetScreenReaderForTest()
  })

  test('describes typed characters and deletions without exposing the full input', () => {
    expect(describeScreenReaderEdit('hello', 'hello!')).toBe('!')
    expect(describeScreenReaderEdit('hello ', 'hello')).toBe('Deleted space')
    expect(describeScreenReaderEdit('hello', '')).toBe('Deleted 5 characters')
    expect(describeScreenReaderEdit('a', 'xyz')).toBe(
      'Replaced 1 characters with 3',
    )
  })

  test('enables both the professional setting and compatibility behavior', () => {
    enableScreenReaderMode()
    expect(process.env.UR_SCREEN_READER).toBe('1')
    expect(process.env.UR_CODE_ACCESSIBILITY).toBe('1')
    expect(consumeScreenReaderAnnouncements()).toEqual([])
  })

  test('emits only newly appended or changed plain-text lines', () => {
    expect(diffScreenReaderText('', 'UR ready')).toBe('UR ready\n')
    expect(diffScreenReaderText('Answer: hel', 'Answer: hello')).toBe('lo\n')
    expect(diffScreenReaderText('Status: waiting', 'Status: complete')).toBe(
      'Status: complete\n',
    )
    expect(diffScreenReaderText('same', 'same')).toBe('')
  })
})
