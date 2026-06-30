import { describe, expect, test } from 'bun:test'
import { clearBundledSkills, getBundledSkills } from '../src/skills/bundledSkills.js'
import { registerLatexPaperSkill } from '../src/skills/bundled/latex-paper.js'

describe('/latex-paper bundled skill', () => {
  test('registers and prompt mentions worktree + build + PR', async () => {
    clearBundledSkills()
    registerLatexPaperSkill()
    const skills = getBundledSkills()
    expect(skills).toHaveLength(1)
    const skill = skills[0]!
    expect(skill.name).toBe('latex-paper')
    expect(skill.aliases).toContain('latex')
    expect(skill.userInvocable).toBe(true)

    const prompt = await skill.getPromptForCommand('survey of local-first agents', {} as never)
    const text = prompt[0]!.type === 'text' ? prompt[0]!.text : ''
    expect(text).toContain('worktree')
    expect(text).toContain('build')
    expect(text).toContain('PR')
    expect(text).toContain('survey of local-first agents')
  })
})
