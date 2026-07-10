import { describe, expect, test } from 'bun:test'
import { clearBundledSkills, getBundledSkills } from '../src/skills/bundledSkills.js'
import { registerRefactorSkill } from '../src/skills/bundled/refactor.js'

describe('/refactor bundled skill', () => {
  test('registers and prompt keeps final verification and publishing explicit', async () => {
    clearBundledSkills()
    registerRefactorSkill()
    const skills = getBundledSkills()
    expect(skills).toHaveLength(1)
    const skill = skills[0]!
    expect(skill.name).toBe('refactor')
    expect(skill.userInvocable).toBe(true)

    const prompt = await (skill as Extract<typeof skill, { type: 'prompt' }>).getPromptForCommand('extract validation helpers', {} as never)
    const text = prompt[0]!.type === 'text' ? prompt[0]!.text : ''
    expect(text).toContain('worktree')
    expect(text).toContain('AskUserQuestion')
    expect(text).toContain('Do not commit, push, or open a PR')
    expect(text).toContain('extract validation helpers')
  })
})
