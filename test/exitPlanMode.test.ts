import { expect, test } from 'bun:test'
import { ExitPlanModeV2Tool } from '../src/tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts'

test('ExitPlanMode accepts allowedPrompts as strings', () => {
  const parsed = ExitPlanModeV2Tool.inputSchema.safeParse({
    allowedPrompts: [
      'Generate the HTML file and all required assets for the one-level Mario game',
      'Test the game by opening it in a browser or running a local server',
    ],
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.allowedPrompts).toEqual([
    {
      tool: 'Bash',
      prompt:
        'Generate the HTML file and all required assets for the one-level Mario game',
    },
    {
      tool: 'Bash',
      prompt:
        'Test the game by opening it in a browser or running a local server',
    },
  ])
})

test('ExitPlanMode accepts a single allowed prompt string', () => {
  const parsed = ExitPlanModeV2Tool.inputSchema.safeParse({
    allowedPrompts: 'Run the test suite',
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.allowedPrompts).toEqual([
    {
      tool: 'Bash',
      prompt: 'Run the test suite',
    },
  ])
})

test('ExitPlanMode accepts command-like allowed prompt objects', () => {
  const parsed = ExitPlanModeV2Tool.inputSchema.safeParse({
    allowedPrompts: [
      {
        tool: 'BashTool',
        command: 'bun test',
      },
      {
        description: 'Run typecheck before finishing',
      },
    ],
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.allowedPrompts).toEqual([
    {
      tool: 'Bash',
      prompt: 'bun test',
    },
    {
      tool: 'Bash',
      prompt: 'Run typecheck before finishing',
    },
  ])
})

test('ExitPlanMode accepts allowed prompt maps and filters non-Bash tools', () => {
  const parsed = ExitPlanModeV2Tool.inputSchema.safeParse({
    allowed_prompts: {
      Bash: ['Run tests', 'Install dependencies'],
      Edit: ['Modify source files'],
    },
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.allowedPrompts).toEqual([
    {
      tool: 'Bash',
      prompt: 'Run tests',
    },
    {
      tool: 'Bash',
      prompt: 'Install dependencies',
    },
  ])
})

test('ExitPlanMode tolerates null allowed prompts', () => {
  const parsed = ExitPlanModeV2Tool.inputSchema.safeParse({
    allowedPrompts: null,
  })

  expect(parsed.success).toBe(true)
  if (!parsed.success) return
  expect(parsed.data.allowedPrompts).toEqual([])
})
