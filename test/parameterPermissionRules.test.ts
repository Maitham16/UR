import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import {
  getEmptyToolPermissionContext,
  type Tool,
  type ToolUseContext,
} from '../src/Tool.js'
import {
  hasPermissionsToUseTool,
  getParameterRuleForToolInput,
} from '../src/utils/permissions/permissions.js'
import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from '../src/utils/permissions/permissionRuleParser.js'

const tool = {
  name: 'Agent',
  inputSchema: z.object({
    model: z.string().optional(),
    timeout: z.number().optional(),
    options: z.object({ effort: z.string() }).optional(),
  }),
  async checkPermissions() {
    return { behavior: 'passthrough', message: 'approval required' } as const
  },
} as unknown as Tool

function contextWithRules(options: {
  allow?: string[]
  ask?: string[]
  deny?: string[]
  mode?: 'default' | 'bypassPermissions'
}) {
  const permissionContext = {
    ...getEmptyToolPermissionContext(),
    mode: options.mode ?? 'default',
    alwaysAllowRules: { userSettings: options.allow ?? [] },
    alwaysAskRules: { userSettings: options.ask ?? [] },
    alwaysDenyRules: { userSettings: options.deny ?? [] },
  }
  return {
    abortController: new AbortController(),
    getAppState: () => ({ toolPermissionContext: permissionContext }),
  } as unknown as ToolUseContext
}

describe('Tool(parameter:value) permission rules', () => {
  test('parses structured parameter rules without removing legacy content', () => {
    const parsed = permissionRuleValueFromString('Agent(model:opus)')
    expect(parsed).toEqual({
      toolName: 'Agent',
      ruleContent: 'model:opus',
      ruleParameter: { name: 'model', valuePattern: 'opus' },
    })
    expect(permissionRuleValueToString(parsed)).toBe('Agent(model:opus)')
  })

  test('keeps ordinary Tool(content) rules unstructured', () => {
    expect(permissionRuleValueFromString('Agent(researcher)')).toEqual({
      toolName: 'Agent',
      ruleContent: 'researcher',
    })
  })

  test('deny rules match exact values before bypassPermissions', async () => {
    const result = await hasPermissionsToUseTool(
      tool,
      { model: 'opus' },
      contextWithRules({
        deny: ['Agent(model:opus)'],
        mode: 'bypassPermissions',
      }),
      undefined as never,
      'tool-use-parameter-deny',
    )
    expect(result.behavior).toBe('deny')
    expect(result.decisionReason).toMatchObject({
      type: 'rule',
      rule: { ruleValue: { ruleContent: 'model:opus' } },
    })
  })

  test('allow and ask rules apply only when the named input is present', async () => {
    const allowed = await hasPermissionsToUseTool(
      tool,
      { timeout: 30 },
      contextWithRules({ allow: ['Agent(timeout:*)'] }),
      undefined as never,
      'tool-use-parameter-allow',
    )
    expect(allowed.behavior).toBe('allow')

    const missing = await hasPermissionsToUseTool(
      tool,
      { model: 'sonnet' },
      contextWithRules({ allow: ['Agent(timeout:*)'] }),
      undefined as never,
      'tool-use-parameter-missing',
    )
    expect(missing.behavior).toBe('ask')

    const asked = await hasPermissionsToUseTool(
      tool,
      { model: 'opus-4.7' },
      contextWithRules({ ask: ['Agent(model:opus-*)'] }),
      undefined as never,
      'tool-use-parameter-ask',
    )
    expect(asked.behavior).toBe('ask')
    expect(asked.decisionReason?.type).toBe('rule')
  })

  test('supports nested input paths and wildcard values', () => {
    const context = contextWithRules({
      deny: ['Agent(options.effort:x*)'],
    }).getAppState().toolPermissionContext
    expect(
      getParameterRuleForToolInput(
        context,
        tool,
        { options: { effort: 'xhigh' } },
        'deny',
      )?.ruleValue.ruleContent,
    ).toBe('options.effort:x*')
  })
})
