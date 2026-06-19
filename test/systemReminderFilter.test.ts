import { describe, expect, test } from 'bun:test'
import { stripSystemReminders } from '../src/utils/systemReminderFilter'

describe('stripSystemReminders', () => {
  test('removes a complete reminder block', () => {
    const input =
      'Hello.\n<system-reminder>You did not write any files.</system-reminder>\nMore text.'
    expect(stripSystemReminders(input)).toBe('Hello.\nMore text.')
  })

  test('removes multiple reminder blocks', () => {
    const input =
      '<system-reminder>one</system-reminder><system-reminder>two</system-reminder>actual content'
    expect(stripSystemReminders(input)).toBe('actual content')
  })

  test('drops an unclosed reminder tail to avoid leaking half the prompt', () => {
    const input = 'Visible.\n<system-reminder>oops the model never closed this'
    expect(stripSystemReminders(input)).toBe('Visible.')
  })

  test('preserves angle brackets that are not the tag', () => {
    const input = 'Compare a<b and c>d in the code.'
    expect(stripSystemReminders(input)).toBe('Compare a<b and c>d in the code.')
  })

  test('returns empty string when input is empty', () => {
    expect(stripSystemReminders('')).toBe('')
  })

  test('collapses 3+ consecutive blank lines created by removal', () => {
    const input =
      'A\n\n\n<system-reminder>x</system-reminder>\n\n\nB'
    expect(stripSystemReminders(input)).toBe('A\n\nB')
  })

  test('is case-insensitive on the tag name', () => {
    const input = 'A<System-Reminder>x</System-Reminder>B'
    expect(stripSystemReminders(input)).toBe('AB')
  })
})
