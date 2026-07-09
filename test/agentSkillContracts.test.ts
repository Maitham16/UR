import { describe, expect, test } from 'bun:test'
import {
  clearBundledSkills,
  getBundledSkills,
} from '../src/skills/bundledSkills.js'
import { registerBenchmarkSkill } from '../src/skills/bundled/benchmark.js'
import { registerDebugV2Skill } from '../src/skills/bundled/debug-v2.js'
import { registerDockerizeSkill } from '../src/skills/bundled/dockerize.js'
import { registerLatexPaperSkill } from '../src/skills/bundled/latex-paper.js'
import { registerPaperImplementationSkill } from '../src/skills/bundled/paper-implementation.js'
import { registerRefactorSkill } from '../src/skills/bundled/refactor.js'
import { registerSecurityReviewSkill } from '../src/skills/bundled/security-review.js'

const WORKTREE_AGENT_SKILLS = [
  { name: 'debug-v2', register: registerDebugV2Skill },
  { name: 'refactor', register: registerRefactorSkill },
  { name: 'paper-implementation', register: registerPaperImplementationSkill },
  { name: 'benchmark', register: registerBenchmarkSkill },
  { name: 'security-review', register: registerSecurityReviewSkill },
  { name: 'dockerize', register: registerDockerizeSkill },
  { name: 'latex-paper', register: registerLatexPaperSkill },
]

describe('worktree-first agent skill contracts', () => {
  test('all required skills are user-invocable and require isolated PR-style work', async () => {
    clearBundledSkills()
    for (const skill of WORKTREE_AGENT_SKILLS) skill.register()

    const skills = getBundledSkills()
    expect(skills.map(skill => skill.name).sort()).toEqual(
      WORKTREE_AGENT_SKILLS.map(skill => skill.name).sort(),
    )

    for (const skill of skills) {
      expect(skill.userInvocable).toBe(true)
      expect((skill as Extract<typeof skill, { type: 'prompt' }>).allowedTools).toContain('Agent')
      const prompt = await (skill as Extract<typeof skill, { type: 'prompt' }>).getPromptForCommand('contract smoke', {} as never)
      const text = prompt[0]?.type === 'text' ? prompt[0].text : ''
      expect(text).toContain('isolated worktree')
      expect(text).toContain('branch')
      expect(text).toContain('PR')
      expect(text.toLowerCase()).toContain('commit')
      expect(text).toContain('contract smoke')
    }
  })
})
