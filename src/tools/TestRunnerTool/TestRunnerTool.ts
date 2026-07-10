import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { BashTool } from '../BashTool/BashTool.js'

const TEST_RUNNER_TOOL_NAME = 'TestRunner'

const inputSchema = lazySchema(() =>
  z.strictObject({
    command: z.string().optional().describe('Explicit test command to run'),
    pattern: z.string().optional().describe('Optional file pattern to pass to the test runner'),
    timeout: z.number().int().min(1).max(600).optional().describe('Timeout in seconds (max 600)'),
    watch: z.boolean().optional().describe('Run in watch mode (not supported for all runners)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    command: z.string(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export function detectTestCommand(cwd: string): string | null {
  const packagePath = join(cwd, 'package.json')
  if (existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, string> }
      if (pkg.scripts?.test) return `bun run test`
      if (pkg.scripts?.['test:unit']) return `bun run test:unit`
    } catch {
      // ignore
    }
  }
  if (existsSync(join(cwd, 'Makefile'))) return 'make test'
  if (existsSync(join(cwd, 'Cargo.toml'))) return 'cargo test'
  if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'setup.py'))) return 'pytest'
  if (existsSync(join(cwd, 'go.mod'))) return 'go test ./...'
  return null
}

function buildCommand(input: z.infer<InputSchema>, cwd: string): string {
  if (input.command) return input.command
  const detected = detectTestCommand(cwd)
  if (detected) {
    let cmd = detected
    if (input.pattern) cmd += ` ${input.pattern}`
    return cmd
  }
  return 'bun test'
}

export const TestRunnerTool = buildTool({
  name: TEST_RUNNER_TOOL_NAME,
  searchHint: 'run project test suite',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description() {
    return 'Run the project test suite'
  },
  async prompt() {
    return 'Run project tests. Auto-detects the test command from package.json scripts, Makefile, Cargo.toml, pyproject.toml, or go.mod. Override with command.'
  },
  userFacingName() {
    return 'TestRunner'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  isDestructive() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.command || 'auto-detected tests'
  },
  async checkPermissions(input) {
    const command = buildCommand(input, getCwd())
    return {
      behavior: 'ask',
      updatedInput: input,
      message: `UR wants to run the project test command: ${command}`,
      decisionReason: { type: 'other', reason: 'Test commands execute project-defined code' },
      suggestions: [],
    }
  },
  renderToolUseMessage() {
    return null
  },
  async call(input, context, canUseTool = undefined, parentMessage = undefined) {
    const command = buildCommand(input, getCwd())
    const bashResult = await BashTool.call(
      {
        command,
        description: 'Run project tests',
        timeout: (input.timeout ?? 120) * 1000,
      },
      context,
      canUseTool,
      parentMessage,
    )
    const data = bashResult.data
    const stdout = typeof data?.stdout === 'string' ? data.stdout : ''
    const stderr = typeof data?.stderr === 'string' ? data.stderr : ''
    const interrupted = data?.interrupted === true
    return {
      data: {
        success: !interrupted,
        command,
        stdout,
        stderr,
        error: interrupted ? 'Test command was interrupted' : undefined,
      },
    }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(content),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
