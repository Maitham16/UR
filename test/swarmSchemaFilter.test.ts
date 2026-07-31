import { describe, expect, test } from 'bun:test'
import { AGENT_TOOL_NAME } from '../src/tools/AgentTool/constants.js'
import { filterSwarmFieldsFromSchema } from '../src/utils/api.js'

describe('swarm field schema filtering', () => {
  test('removes hidden fields from properties and required together', () => {
    const filtered = filterSwarmFieldsFromSchema(AGENT_TOOL_NAME, {
      type: 'object',
      properties: {
        description: { type: 'string' },
        name: { type: 'string' },
        team_name: { type: 'string' },
      },
      required: ['description', 'name', 'team_name'],
    })

    expect(filtered.properties).toEqual({ description: { type: 'string' } })
    expect(filtered.required).toEqual(['description'])
  })
})
