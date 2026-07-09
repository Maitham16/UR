import { describe, expect, test } from 'bun:test'
import { clearBundledSkills, getBundledSkills } from '../src/skills/bundledSkills.js'
import { registerDockerizeSkill } from '../src/skills/bundled/dockerize.js'

describe('/dockerize bundled skill', () => {
  test('registers and prompt mentions worktree + Dockerfile + PR', async () => {
    clearBundledSkills()
    registerDockerizeSkill()
    const skills = getBundledSkills()
    expect(skills).toHaveLength(1)
    const skill = skills[0]!
    expect(skill.name).toBe('dockerize')
    expect(skill.aliases).toContain('docker')
    expect(skill.userInvocable).toBe(true)

    const prompt = await (skill as Extract<typeof skill, { type: 'prompt' }>).getPromptForCommand('Node.js API service', {} as never)
    const text = prompt[0]!.type === 'text' ? prompt[0]!.text : ''
    expect(text).toContain('worktree')
    expect(text).toContain('Dockerfile')
    expect(text).toContain('PR')
    expect(text).toContain('Node.js API service')
  })
})
