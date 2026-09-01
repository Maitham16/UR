import { describe, expect, test } from 'bun:test'
import {
  CONFIG_ASSIGNMENT_HELP,
  parseConfigAssignments,
  resolveConfigAssignmentKey,
} from '../src/commands/config/configAssignments.js'
import { listCliConfigEntries } from '../src/cli/handlers/config.js'

describe('/config assignments', () => {
  test('parses clear, case-insensitive key=value assignments', () => {
    expect(
      parseConfigAssignments(
        'thinking=false screen-reader=on reducedMotion=disabled editor=vim vimEscape=jj',
      ),
    ).toEqual({
      assignments: [
        { key: 'thinking', value: false },
        { key: 'screenReader', value: true },
        { key: 'reducedMotion', value: false },
        { key: 'editor', value: 'vim' },
        { key: 'vimEscape', value: 'jj' },
      ],
    })
  })

  test('rejects unknown keys and ambiguous values', () => {
    expect(parseConfigAssignments('mcp2026=true')).toEqual({
      error: "Unknown setting 'mcp2026'.",
    })
    expect(parseConfigAssignments('thinking=maybe')).toEqual({
      error: 'thinking must be true or false.',
    })
  })

  test('help uses user-facing names and avoids protocol version jargon', () => {
    expect(CONFIG_ASSIGNMENT_HELP).toContain('/config <key>=<value>')
    expect(CONFIG_ASSIGNMENT_HELP).toContain('screenReader')
    expect(CONFIG_ASSIGNMENT_HELP).not.toMatch(/mcp2026|v1|v2/i)
  })

  test('shares accessibility and editor keys with the standalone CLI', () => {
    expect(resolveConfigAssignmentKey('screen-reader')).toBe('screenReader')
    expect(resolveConfigAssignmentKey('vimEscape')).toBe('vimEscape')

    const entries = listCliConfigEntries()
    const keys = entries.map(entry => entry.key)
    expect(keys).toContain('screenReader')
    expect(keys).toContain('vimEscape')
    expect(keys).toContain('provider')
    expect(keys).toContain('responses.tool_search')
    expect(keys).toContain('anthropic.speed')
    expect(new Set(keys).size).toBe(keys.length)
  })
})
