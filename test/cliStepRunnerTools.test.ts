import { expect, test } from 'bun:test'
import {
  buildCliStepArgs,
  extractVerdict,
} from '../src/services/agents/cliStepRunner.js'
import { WORKER_AGENT } from '../src/tools/AgentTool/built-in/generalPurposeAgent.js'
import { getBuiltInAgents } from '../src/tools/AgentTool/builtInAgents.js'

test('CLI workflow steps expose only their declared tool pool', () => {
  const args = buildCliStepArgs(
    {
      step: {
        id: 'audit',
        name: 'Audit',
        agent: 'worker',
        prompt: 'Audit the repository.',
        allowedTools: ['Read', 'Grep', 'mcp__docs__search'],
      },
      priorOutputs: {},
      iteration: 1,
    },
    {
      cwd: '/workspace',
      bin: { file: 'node', baseArgs: ['bin/ur.js'] },
    },
  )
  expect(args).toEqual([
    'bin/ur.js',
    '-p',
    '--output-format',
    'json',
    '--agent',
    'worker',
    'Audit the repository.',
    '--tools',
    'Read,Grep,mcp__docs__search',
  ])
  expect(args.indexOf('Audit the repository.')).toBeLessThan(
    args.indexOf('--tools'),
  )
  expect(args.slice(args.indexOf('--agent'), args.indexOf('--agent') + 2)).toEqual(
    ['--agent', 'worker'],
  )
})

test('the workflow worker spelling resolves to an executable built-in agent', () => {
  expect(getBuiltInAgents().map(agent => agent.agentType)).toContain('worker')
  expect(WORKER_AGENT.agentType).toBe('worker')
  expect(WORKER_AGENT.tools).toEqual(['*'])
  expect(
    WORKER_AGENT.getSystemPrompt({ toolUseContext: { options: {} as never } }),
  ).toContain('Complete the task fully')
})

test('verdict parsing accepts one standalone control line and rejects ambiguity', () => {
  expect(extractVerdict('Work complete.\nVERDICT: PASS')).toBe('PASS')
  expect(extractVerdict('Details follow.\n**VERDICT: FAIL**\nreason')).toBe(
    'FAIL',
  )
  expect(extractVerdict('Work complete — VERDICT: PASS')).toBeNull()
  expect(
    extractVerdict('VERDICT: FAIL\nretry succeeded\nVERDICT: PASS'),
  ).toBeNull()
  expect(extractVerdict('No explicit result')).toBeNull()
})
