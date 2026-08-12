import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
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

  it('sanitizes the background-shell detail surface before truncating', () => {
    const source = readFileSync(
      'src/components/tasks/ShellDetailDialog.tsx',
      'utf8',
    )
    expect(source).toContain(
      'truncateToWidth(formatCommandForDisplay(shell.command), 280)',
    )
  })
})
