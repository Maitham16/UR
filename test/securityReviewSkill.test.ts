import { describe, expect, test } from 'bun:test'
import { clearBundledSkills, getBundledSkills } from '../src/skills/bundledSkills.js'
import { registerSecurityReviewSkill } from '../src/skills/bundled/security-review.js'

describe('/security-review bundled skill', () => {
  test('registers and prompt mentions worktree + OWASP + PR', async () => {
    clearBundledSkills()
    registerSecurityReviewSkill()
    const skills = getBundledSkills()
    expect(skills).toHaveLength(1)
    const skill = skills[0]!
    expect(skill.name).toBe('security-review')
    expect(skill.aliases).toContain('security')
    expect(skill.userInvocable).toBe(true)

    const prompt = await (skill as Extract<typeof skill, { type: 'prompt' }>).getPromptForCommand('auth and input validation', {} as never)
    const text = prompt[0]!.type === 'text' ? prompt[0]!.text : ''
    expect(text).toContain('worktree')
    expect(text).toContain('OWASP')
    expect(text).toContain('PR')
    expect(text).toContain('auth and input validation')
  })
})
