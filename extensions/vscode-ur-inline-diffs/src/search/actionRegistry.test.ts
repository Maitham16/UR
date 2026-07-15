import { describe, expect, test } from 'bun:test'
import { ACTION_REGISTRY } from './actionRegistry.js'

const EXPECTED_LABELS = [
  'New Chat',
  'Open Chat',
  'Explain Selection',
  'Fix Selection',
  'Generate Tests',
  'Review Current Diff',
  'Run Verifier',
  'Provider Status',
  'Agent Status',
  'Agent Options',
  'Pick Model',
  'Open Settings',
  'Open Docs',
  'Open Artifacts',
  'Run Spec',
  'Run Workflow',
  'Start Background Task',
  'Refresh IDE Actions',
]

describe('ACTION_REGISTRY', () => {
  test('contains exactly the required actions', () => {
    expect(ACTION_REGISTRY.map(a => a.label).sort()).toEqual([...EXPECTED_LABELS].sort())
  })

  test('every entry has a stable id, a command id, and a clean label', () => {
    for (const action of ACTION_REGISTRY) {
      expect(action.id.length).toBeGreaterThan(0)
      expect(action.commandId.length).toBeGreaterThan(0)
      expect(action.label.trim()).toBe(action.label)
      expect(action.label.length).toBeGreaterThan(0)
      expect(action.description.length).toBeGreaterThan(0)
    }
  })

  test('ids are unique', () => {
    const ids = ACTION_REGISTRY.map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('command ids are unique', () => {
    const commandIds = ACTION_REGISTRY.map(a => a.commandId)
    expect(new Set(commandIds).size).toBe(commandIds.length)
  })

  test('command ids use the stable urInlineDiffs.* or urActions.* namespaces', () => {
    for (const action of ACTION_REGISTRY) {
      expect(action.commandId.startsWith('urInlineDiffs.') || action.commandId.startsWith('urActions.')).toBe(true)
    }
  })

  test('reuses PR1/PR2 command ids for actions that already exist (no duplicate commands)', () => {
    const byLabel = Object.fromEntries(ACTION_REGISTRY.map(a => [a.label, a.commandId]))
    expect(byLabel['New Chat']).toBe('urInlineDiffs.chat.new')
    expect(byLabel['Open Chat']).toBe('urInlineDiffs.chat.open')
    expect(byLabel['Explain Selection']).toBe('urInlineDiffs.chat.explainSelection')
    expect(byLabel['Fix Selection']).toBe('urInlineDiffs.chat.fixSelection')
    expect(byLabel['Generate Tests']).toBe('urInlineDiffs.chat.generateTests')
    expect(byLabel['Provider Status']).toBe('urInlineDiffs.status')
    expect(byLabel['Pick Model']).toBe('urInlineDiffs.pickModel')
  })
})
