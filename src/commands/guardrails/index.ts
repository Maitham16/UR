import type { Command } from '../../types/command.js'

const guardrails = {
  type: 'local',
  name: 'guardrails',
  aliases: ['guardrail'],
  description:
    'Declarative input/output guardrails (.ur/guardrails/): regex/contains/PII/length/JSON-schema/LLM rules with tripwires that layer onto the self-review gate',
  argumentHint: 'list|init|validate|check "<text>" [--phase input|output] [--tool name] [--json]',
  supportsNonInteractive: true,
  load: () => import('./guardrails.js'),
} satisfies Command

export default guardrails
