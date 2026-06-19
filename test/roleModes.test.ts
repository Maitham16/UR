import { expect, test } from 'bun:test'
import {
  getMode,
  listModeNames,
  renderModeAgent,
  ROLE_MODES,
} from '../src/commands/role-mode/modes.ts'

test('ships the four canonical role modes', () => {
  expect(listModeNames().sort()).toEqual(['architect', 'ask', 'code', 'debug'])
})

test('read-only modes do not grant Edit/Write/Bash', () => {
  for (const name of ['architect', 'ask']) {
    const mode = getMode(name)!
    expect(mode.tools).toBeDefined()
    expect(mode.tools).not.toContain('Edit')
    expect(mode.tools).not.toContain('Write')
    expect(mode.tools).not.toContain('Bash')
  }
})

test('code mode grants all tools (no tools restriction)', () => {
  expect(getMode('code')!.tools).toBeUndefined()
})

test('debug mode can run Bash and Edit but not Write', () => {
  const debug = getMode('debug')!
  expect(debug.tools).toContain('Bash')
  expect(debug.tools).toContain('Edit')
  expect(debug.tools).not.toContain('Write')
})

test('renderModeAgent emits valid agent frontmatter', () => {
  const md = renderModeAgent(getMode('architect')!)
  expect(md.startsWith('---\n')).toBe(true)
  expect(md).toContain('name: architect')
  expect(md).toContain('model: inherit')
  expect(md).toContain('permissionMode: plan')
  expect(md).toContain('tools: Read, Grep, Glob, CodeSearch, WebSearch, WebFetch, TodoWrite')
  // body present after frontmatter
  expect(md).toContain('Architect** mode')
})

test('code mode frontmatter omits the tools line', () => {
  const md = renderModeAgent(getMode('code')!)
  expect(md).not.toContain('\ntools:')
})

test('getMode is case-insensitive and returns undefined for unknown', () => {
  expect(getMode('ARCHITECT')?.name).toBe('architect')
  expect(getMode('nope')).toBeUndefined()
})

test('every mode has a non-empty description and body', () => {
  for (const mode of ROLE_MODES) {
    expect(mode.description.length).toBeGreaterThan(10)
    expect(mode.body.trim().length).toBeGreaterThan(20)
  }
})
