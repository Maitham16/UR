import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { lazySchema } from '../../utils/lazySchema.js'

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

async function runTest(command: string, timeout: number): Promise<Output> {
  const [file, ...args] = command.split(/\s+/).filter(Boolean)
  const result = await execFileNoThrow(file || 'bun', args.length > 0 ? args : ['test'], {
    timeout: timeout * 1000,
    preserveOutputOnError: true,
  })
  return {
    success: result.code === 0,
    command,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.code !== 0 ? result.error || result.stderr : undefined,
  }
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
    return true
  },
  toAutoClassifierInput(input) {
    return input.command || 'auto-detected tests'
  },
  async checkPermissions(input) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Test commands are read-only' },
    }
  },
  renderToolUseMessage() {
    return null
  },
  async call(input, context) {
    const cwd = context.options.commands?.[0]?.name ? process.cwd() : process.cwd()
    const command = buildCommand(input, cwd)
    const result = await runTest(command, input.timeout ?? 120)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(content),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
