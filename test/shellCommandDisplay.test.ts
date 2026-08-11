import { describe, expect, it } from 'bun:test'
import { formatCommandForDisplay } from '../src/utils/shell/visibleCommand.js'

describe('shell command display hardening', () => {
  it('renders tabs and control bytes visibly', () => {
    expect(formatCommandForDisplay('git status\t&&\tcurl bad\u0007')).toBe(
      'git status\\t&&\\tcurl bad\\x07',
    )
  })

  it('renders zero-width and bidirectional controls visibly', () => {
    expect(formatCommandForDisplay('echo safe\u200B; rm -rf x\u202Etxt')).toBe(
      'echo safe\\u{200B}; rm -rf x\\u{202E}txt',
    )
  })

  it('preserves ordinary Unicode and line breaks', () => {
    expect(formatCommandForDisplay('printf "مرحبا 🐦"\necho done')).toBe(
      'printf "مرحبا 🐦"\necho done',
    )
  })
})
