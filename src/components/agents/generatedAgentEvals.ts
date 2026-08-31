import type {
  EvalReport,
  EvalRunner,
  EvalSuite,
  EvalValidation,
  JudgeRunner,
} from '../../services/agents/evals.js'
import {
  runSuite,
  saveSuite,
  validateEvalSuite,
} from '../../services/agents/evals.js'
import type { GeneratedAgent } from './generateAgent.js'

type GeneratedAgentEvalSpec = Pick<
  GeneratedAgent,
  'identifier' | 'evaluationCases'
>

export type GeneratedAgentEvalArtifact = {
  suite: EvalSuite
  path: string
  created: boolean
}

/** Stable suite name and filename for one generated agent. */
export function generatedAgentEvalSuiteName(identifier: string): string {
  return `agent-${identifier}`
}

function formatJudgeRubric(
  successCriteria: readonly string[],
  forbiddenBehavior: readonly string[],
): string {
  const lines = [
    'Judge the response against this generated-agent contract.',
    'Every success criterion must be satisfied:',
    ...successCriteria.map(criterion => `- ${criterion}`),
  ]
  if (forbiddenBehavior.length > 0) {
    lines.push(
      'The response fails if it exhibits any forbidden behavior:',
      ...forbiddenBehavior.map(behavior => `- ${behavior}`),
    )
  }
  return lines.join('\n')
}

/**
 * Compile generated cases into the public eval-suite schema. The suite has no
 * timestamps or random identifiers, so the same agent spec serializes byte for
 * byte identically on every save.
 */
export function buildGeneratedAgentEvalSuite(
  agent: GeneratedAgentEvalSpec,
): EvalSuite {
  return {
    version: 1,
    name: generatedAgentEvalSuiteName(agent.identifier),
    description: `Pre-activation evaluation suite for generated agent "${agent.identifier}".`,
    cases: agent.evaluationCases.map((evaluationCase, index) => ({
      id: `case-${String(index + 1).padStart(2, '0')}`,
      category: 'generated-agent',
      prompt: evaluationCase.input,
      expect: {
        judge: formatJudgeRubric(
          evaluationCase.successCriteria,
          evaluationCase.forbiddenBehavior,
        ),
      },
    })),
  }
}

export function validateGeneratedAgentEvals(
  agent: GeneratedAgentEvalSpec,
): EvalValidation {
  return validateEvalSuite(buildGeneratedAgentEvalSuite(agent))
}

export function assertGeneratedAgentEvalsValid(
  agent: GeneratedAgentEvalSpec,
): EvalSuite {
  const suite = buildGeneratedAgentEvalSuite(agent)
  const validation = validateEvalSuite(suite)
  if (!validation.valid) {
    throw new Error(
      `Generated agent eval suite is invalid: ${validation.errors.join('; ')}`,
    )
  }
  return suite
}

/** Persist a validated, directly runnable artifact through the normal eval API. */
export function persistGeneratedAgentEvalArtifact(
  cwd: string,
  agent: GeneratedAgentEvalSpec,
): GeneratedAgentEvalArtifact {
  const suite = assertGeneratedAgentEvalsValid(agent)
  const saved = saveSuite(cwd, suite, { force: true })
  return { suite, ...saved }
}

/**
 * Optional pre-activation gate for callers that can run a model. Judge-bearing
 * generated cases fail closed when no judge is provided, as normal evals do.
 */
export async function runGeneratedAgentEvalsBeforeActivation(
  agent: GeneratedAgentEvalSpec,
  runner: EvalRunner,
  judge?: JudgeRunner,
): Promise<EvalReport> {
  const suite = assertGeneratedAgentEvalsValid(agent)
  const report = await runSuite(suite, runner, { judge })
  if (report.failed > 0) {
    const failedIds = report.cases
      .filter(result => !result.passed)
      .map(result => result.id)
      .join(', ')
    throw new Error(
      `Generated agent failed pre-activation evals: ${failedIds || `${report.failed} case(s)`}`,
    )
  }
  return report
}
