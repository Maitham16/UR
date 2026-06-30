import { describe, expect, test } from 'bun:test'
import { clearBundledSkills, getBundledSkills } from '../src/skills/bundledSkills.js'
import { registerBenchmarkSkill } from '../src/skills/bundled/benchmark.js'

describe('/benchmark bundled skill', () => {
  test('registers and prompt mentions worktree + results + PR', async () => {
    clearBundledSkills()
    registerBenchmarkSkill()
    const skills = getBundledSkills()
    expect(skills).toHaveLength(1)
    const skill = skills[0]!
    expect(skill.name).toBe('benchmark')
    expect(skill.aliases).toContain('bench')
    expect(skill.userInvocable).toBe(true)

    const prompt = await skill.getPromptForCommand('parser throughput', {} as never)
    const text = prompt[0]!.type === 'text' ? prompt[0]!.text : ''
    expect(text).toContain('worktree')
    expect(text).toContain('results')
    expect(text).toContain('PR')
    expect(text).toContain('parser throughput')
  })
})
