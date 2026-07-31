import { describe, expect, test } from 'bun:test'
import { getAllBaseTools } from '../src/tools.js'

describe('built-in tool registry coverage', () => {
  test('includes MCP-exposed external, filesystem, terminal, and test tools', () => {
    const names = getAllBaseTools().map(tool => tool.name)

    for (const name of [
      'GitHub',
      'Api',
      'Browser',
      'Docker',
      'TestRunner',
      'Database',
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'Bash',
      'WebFetch',
      'WebSearch',
    ]) {
      expect(names).toContain(name)
    }
  })
})
