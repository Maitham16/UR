import { describe, expect, test } from 'bun:test'
import {
  clearBundledSkills,
  getBundledSkills,
  registerBundledSkill,
  type BundledSkillDefinition,
} from '../src/skills/bundledSkills.js'
import { registerDebugV2Skill } from '../src/skills/bundled/debug-v2.js'

describe('/debug-v2 bundled skill', () => {
  test('registers with required fields and prompt mentions worktree + PR', async () => {
    clearBundledSkills()
    registerDebugV2Skill()
    const skills = getBundledSkills()
    expect(skills).toHaveLength(1)
    const skill = skills[0]!
    expect(skill.name).toBe('debug-v2')
    expect(skill.aliases).toContain('debug2')
    expect(skill.userInvocable).toBe(true)
    expect(skill.allowedTools).toContain('Agent')

    const prompt = await skill.getPromptForCommand('parser crashes on empty input', {} as never)
    expect(prompt).toHaveLength(1)
    expect(prompt[0]!.type).toBe('text')
    const text = prompt[0]!.type === 'text' ? prompt[0]!.text : ''
    expect(text).toContain('worktree')
    expect(text).toContain('branch')
    expect(text).toContain('PR')
    expect(text).toContain('parser crashes on empty input')
  })
})
