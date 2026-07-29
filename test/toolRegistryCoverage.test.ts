import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
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

  test('technical reference names every built-in tool in the shipped pool', () => {
    const reference = readFileSync('technical/04-tools.md', 'utf8')
    const names = getAllBaseTools()
      .map(tool => tool.name)
      .filter(name => name !== 'TestingPermission')

    for (const name of names) {
      expect(reference, `technical/04-tools.md is missing ${name}`).toContain(
        `\`${name}\``,
      )
    }
  })
})
