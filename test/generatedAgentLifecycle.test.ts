import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveAgentToFile } from '../src/components/agents/agentFileUtils.js'
import {
  type GeneratedAgent,
  formatGeneratedAgentSystemPrompt,
  parseGeneratedAgent,
} from '../src/components/agents/generateAgent.js'
import {
  buildGeneratedAgentEvalSuite,
  persistGeneratedAgentEvalArtifact,
  runGeneratedAgentEvalsBeforeActivation,
  validateGeneratedAgentEvals,
} from '../src/components/agents/generatedAgentEvals.js'
import type {
  EvalRunner,
  JudgeRunner,
} from '../src/services/agents/evals.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'

const legacyAgent = {
  identifier: 'focused-code-reviewer',
  whenToUse:
    'Use this agent when focused review is needed through Agent. Do not use it to implement changes.',
  systemPrompt:
    'Review only the requested files. Cite concrete evidence, report prioritized findings, verify every claim, and do not edit the project.',
  tools: ['Read', 'Grep'],
  disallowedTools: ['Write'],
  permissionMode: 'plan' as const,
  maxTurns: 12,
  model: 'inherit',
  memory: null,
  background: false,
  evaluationCases: [
    {
      input: 'Review src/auth.ts.',
      successCriteria: ['Cites exact evidence', 'Prioritizes correctness risks'],
      forbiddenBehavior: ['Edits files'],
    },
    {
      input: 'Review an empty diff.',
      successCriteria: ['Reports that there are no findings'],
      forbiddenBehavior: ['Invents defects'],
    },
  ],
}

const generatedAgent: GeneratedAgent = {
  ...legacyAgent,
  personality: 'Be calm, exact, and candid about uncertainty.',
  collaboration:
    'Work independently on the review; escalate when required evidence is unavailable.',
}

describe('generated-agent behavior contracts', () => {
  test('keeps old generated payloads valid while materializing new contracts', () => {
    const parsed = parseGeneratedAgent(legacyAgent, ['Read', 'Grep', 'Write'])
    expect(parsed.personality).toBeUndefined()
    expect(parsed.collaboration).toBeUndefined()

    const prompt = formatGeneratedAgentSystemPrompt(generatedAgent)
    expect(prompt).toContain('## Personality')
    expect(prompt).toContain(generatedAgent.personality!)
    expect(prompt).toContain('## Collaboration contract')
    expect(prompt).toContain(generatedAgent.collaboration!)
  })

  test('persists concise contracts as metadata and runtime prompt text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ur-generated-agent-file-'))
    try {
      const prompt = formatGeneratedAgentSystemPrompt(generatedAgent)
      await runWithCwdOverride(dir, () =>
        saveAgentToFile(
          'projectSettings',
          generatedAgent.identifier,
          generatedAgent.whenToUse,
          generatedAgent.tools,
          prompt,
          true,
          undefined,
          generatedAgent.model,
          undefined,
          undefined,
          generatedAgent.permissionMode,
          generatedAgent.maxTurns,
          generatedAgent.background,
          generatedAgent.disallowedTools,
          generatedAgent.personality,
          generatedAgent.collaboration,
        ),
      )
      const saved = readFileSync(
        join(dir, '.ur', 'agents', `${generatedAgent.identifier}.md`),
        'utf8',
      )
      expect(saved).toContain(
        `personality: ${JSON.stringify(generatedAgent.personality)}`,
      )
      expect(saved).toContain(
        `collaboration: ${JSON.stringify(generatedAgent.collaboration)}`,
      )
      expect(saved).toContain('## Collaboration contract')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('generated-agent eval lifecycle', () => {
  test('builds and persists one deterministic normal eval suite per agent', () => {
    const first = buildGeneratedAgentEvalSuite(generatedAgent)
    const second = buildGeneratedAgentEvalSuite(generatedAgent)
    expect(first).toEqual(second)
    expect(first.name).toBe('agent-focused-code-reviewer')
    expect(first.cases.map(evalCase => evalCase.id)).toEqual([
      'case-01',
      'case-02',
    ])
    expect(first.cases[0]?.expect.judge).toContain('Cites exact evidence')
    expect(first.cases[0]?.expect.judge).toContain('Edits files')
    expect(validateGeneratedAgentEvals(generatedAgent).valid).toBe(true)

    const dir = mkdtempSync(join(tmpdir(), 'ur-generated-agent-evals-'))
    try {
      const artifact = persistGeneratedAgentEvalArtifact(dir, generatedAgent)
      expect(artifact.path).toBe(
        join(dir, '.ur', 'evals', 'agent-focused-code-reviewer.json'),
      )
      const saved = readFileSync(artifact.path, 'utf8')
      expect(saved).toBe(`${JSON.stringify(first, null, 2)}\n`)
      persistGeneratedAgentEvalArtifact(dir, generatedAgent)
      expect(readFileSync(artifact.path, 'utf8')).toBe(saved)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('supports a fail-closed run gate before activation', async () => {
    const runner: EvalRunner = async evalCase => ({
      output: `reviewed: ${evalCase.prompt}`,
    })
    const passingJudge: JudgeRunner = async ({ rubric }) => ({
      pass: rubric.includes('success criterion'),
    })
    const report = await runGeneratedAgentEvalsBeforeActivation(
      generatedAgent,
      runner,
      passingJudge,
    )
    expect(report.passRate).toBe(1)
    expect(report.promptLifecycle?.promptVersion).toBe('1.0.0')
    expect(report.promptLifecycle?.evalSuiteId).toBe('prompt-platform-2026')

    const failingJudge: JudgeRunner = async () => ({ pass: false })
    await expect(
      runGeneratedAgentEvalsBeforeActivation(
        generatedAgent,
        runner,
        failingJudge,
      ),
    ).rejects.toThrow('failed pre-activation evals: case-01, case-02')
  })
})
