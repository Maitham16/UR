import { describe, expect, test } from 'bun:test'
import {
  formatUpdateAvailableMessage,
  isUpdateAvailable,
} from '../src/utils/updateNotice.js'

describe('update notice', () => {
  test('detects newer versions', () => {
    expect(isUpdateAvailable('1.13.6', '1.13.7')).toBe(true)
    expect(isUpdateAvailable('1.13.6', '1.13.6')).toBe(false)
    expect(isUpdateAvailable('1.13.7', '1.13.6')).toBe(false)
  })

  test('ignores missing registry values', () => {
    expect(isUpdateAvailable('1.13.6', null)).toBe(false)
    expect(isUpdateAvailable(undefined, '1.13.7')).toBe(false)
  })

  test('formats the user-facing release notice', () => {
    expect(formatUpdateAvailableMessage('1.13.6', '1.13.7')).toBe(
      'Update available: 1.13.6 -> 1.13.7',
    )
  })
})
