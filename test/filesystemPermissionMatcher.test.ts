import { describe, expect, test } from 'bun:test'
import { matchingRuleForInput, checkReadPermissionForTool } from '../src/utils/permissions/filesystem.js'
import { getEmptyToolPermissionContext, type Tool } from '../src/Tool.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'
import ignore from 'ignore'

function context(rules: string[], behavior: 'deny' | 'ask' = 'deny') {
  return { ...getEmptyToolPermissionContext(), [behavior === 'deny' ? 'alwaysDenyRules' : 'alwaysAskRules']: { session: rules } }
}
function rule(path: string, rules: string[], behavior: 'deny' | 'ask' = 'deny') {
  return runWithCwdOverride('/workspace/project', () => matchingRuleForInput(path, context(rules, behavior), 'read', behavior))
}

describe('filesystem rules with the declared ignore API', () => {
  test('does not require optional rule metadata absent in ignore6', () => {
    expect(ignore().add('*.env').test('local.env').ignored).toBe(true)
    expect(rule('/workspace/project/local.env', ['Read(*.env)'])?.ruleValue.ruleContent).toBe('*.env')
    expect(rule('/private/config/local.env', ['Read(//private/config/local.env)'])?.ruleValue.ruleContent).toBe('//private/config/local.env')
  })
  test('Read deny and ask produce real permission decisions before implicit workspace allow', () => {
    const tool = { name: 'Read', getPath: (input: { file_path: string }) => input.file_path } as unknown as Tool
    for (const behavior of ['deny', 'ask'] as const) {
      const decision = runWithCwdOverride('/workspace/project', () => checkReadPermissionForTool(tool, { file_path: '/workspace/project/private.env' }, context(['Read(*.env)'], behavior)))
      expect(decision.behavior).toBe(behavior)
    }
  })
  test('ordered negations and repeated patterns retain their intended override order', () => {
    expect(rule('/workspace/project/allowed.txt', ['Read(*.txt)', 'Read(!allowed.txt)'])).toBeNull()
    expect(rule('/workspace/project/other.txt', ['Read(*.txt)', 'Read(!allowed.txt)'])?.ruleValue.ruleContent).toBe('*.txt')
    expect(rule('/workspace/project/allowed.txt', ['Read(allowed.txt)', 'Read(!allowed.txt)', 'Read(allowed.txt)'])?.ruleValue.ruleContent).toBe('allowed.txt')
    expect(rule('/workspace/project/allowed.txt', ['Read(allowed.txt)', 'Read(!allowed.txt)', 'Read(allowed.txt)', 'Read(!allowed.txt)'])).toBeNull()
  })
  test('relative globs are scoped to the current workspace and absolute rules retain their root', () => {
    expect(rule('/workspace/project/src/a.ts', ['Read(src/**)'])?.ruleValue.ruleContent).toBe('src/**')
    expect(rule('/workspace/other/src/a.ts', ['Read(src/**)'])).toBeNull()
    expect(rule('/workspace/other/src/a.ts', ['Read(//workspace/other/src/**)'])?.ruleValue.ruleContent).toBe('//workspace/other/src/**')
    expect(runWithCwdOverride('/workspace/project', () => matchingRuleForInput('/workspace/project/a.ts', context(['Edit(*.ts)']), 'edit', 'deny'))?.ruleValue.toolName).toBe('Edit')
  })
})
