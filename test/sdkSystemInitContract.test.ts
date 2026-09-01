import { describe, expect, test } from 'bun:test'
import { AgentInfoSchema } from '../src/entrypoints/sdk/coreSchemas.js'
import { getSdkToolNames } from '../src/utils/messages/systemInit.js'

describe('SDK system/init tool names', () => {
  test('emits canonical runtime names without the retired Task translation', () => {
    expect(getSdkToolNames([{ name: 'Agent' }, { name: 'Bash' }])).toEqual([
      'Agent',
      'Bash',
    ])
  })

  test('documents the canonical Agent invocation name', () => {
    expect(AgentInfoSchema().description).toContain('Agent tool')
    expect(AgentInfoSchema().description).not.toContain('Task tool')
  })
})
