import { describe, expect, test } from 'bun:test'
import { clearBundledSkills, getBundledSkills } from '../src/skills/bundledSkills.js'
import { registerPaperImplementationSkill } from '../src/skills/bundled/paper-implementation.js'

describe('/paper-implementation bundled skill', () => {
  test('registers and prompt mentions worktree + tests with explicit publishing', async () => {
    clearBundledSkills()
    registerPaperImplementationSkill()
    const skills = getBundledSkills()
    expect(skills).toHaveLength(1)
    const skill = skills[0]!
    expect(skill.name).toBe('paper-implementation')
    expect(skill.aliases).toEqual(['implement-paper'])
    expect(skill.userInvocable).toBe(true)

    const prompt = await (skill as Extract<typeof skill, { type: 'prompt' }>).getPromptForCommand('https://arxiv.org/abs/1234.5678', {} as never)
    const text = prompt[0]!.type === 'text' ? prompt[0]!.text : ''
    expect(text).toContain('worktree')
    expect(text).toContain('tests')
    expect(text).toContain('AskUserQuestion')
    expect(text).toContain('Do not commit, push, or open a PR')
    expect(text).toContain('https://arxiv.org/abs/1234.5678')
  })
})
