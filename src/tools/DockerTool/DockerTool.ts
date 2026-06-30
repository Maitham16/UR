import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { lazySchema } from '../../utils/lazySchema.js'

const DOCKER_TOOL_NAME = 'Docker'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum([
        'ps',
        'build',
        'run',
        'exec',
        'logs',
        'stop',
        'rm',
        'compose_up',
        'compose_down',
      ])
      .describe('Docker action to perform'),
    image: z.string().optional().describe('Image name for build/run'),
    container: z.string().optional().describe('Container name or id'),
    command: z.string().optional().describe('Command to run inside container'),
    args: z.string().optional().describe('Additional space-separated docker arguments'),
    file: z.string().optional().describe('Dockerfile path for build'),
    detach: z.boolean().optional().describe('Run container in background'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

const READ_ONLY_ACTIONS = new Set(['ps', 'logs'])
const DESTRUCTIVE_ACTIONS = new Set(['run', 'exec', 'stop', 'rm', 'compose_up', 'compose_down', 'build'])

function splitArgs(args: string | undefined): string[] {
  if (!args) return []
  return args.split(/\s+/).filter(Boolean)
}

async function runDocker(args: string[]): Promise<Output> {
  const result = await execFileNoThrow('docker', args, { timeout: 120_000 })
  return {
    success: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.code !== 0 ? result.error || result.stderr : undefined,
  }
}

async function dispatch(input: z.infer<InputSchema>): Promise<Output> {
  switch (input.action) {
    case 'ps':
      return runDocker(['ps', ...splitArgs(input.args)])
    case 'build': {
      const args = ['build']
      if (input.file) args.push('-f', input.file)
      if (input.image) args.push('-t', input.image)
      args.push(...splitArgs(input.args), '.')
      return runDocker(args)
    }
    case 'run': {
      const args = ['run']
      if (input.detach) args.push('-d')
      if (input.container) args.push('--name', input.container)
      args.push(...splitArgs(input.args))
      if (input.image) args.push(input.image)
      if (input.command) args.push(input.command)
      return runDocker(args)
    }
    case 'exec': {
      if (!input.container) {
        return { success: false, error: 'container is required for exec' }
      }
      const args = ['exec', input.container]
      if (input.command) args.push(...splitArgs(input.command))
      return runDocker(args)
    }
    case 'logs': {
      if (!input.container) {
        return { success: false, error: 'container is required for logs' }
      }
      return runDocker(['logs', input.container, ...splitArgs(input.args)])
    }
    case 'stop': {
      if (!input.container) {
        return { success: false, error: 'container is required for stop' }
      }
      return runDocker(['stop', input.container, ...splitArgs(input.args)])
    }
    case 'rm': {
      if (!input.container) {
        return { success: false, error: 'container is required for rm' }
      }
      return runDocker(['rm', input.container, ...splitArgs(input.args)])
    }
    case 'compose_up':
      return runDocker(['compose', 'up', '-d', ...splitArgs(input.args)])
    case 'compose_down':
      return runDocker(['compose', 'down', ...splitArgs(input.args)])
    default:
      return { success: false, error: `unsupported action: ${input.action}` }
  }
}

export const DockerTool = buildTool({
  name: DOCKER_TOOL_NAME,
  searchHint: 'manage Docker containers and images',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description(input) {
    return `Run docker ${input.action}`
  },
  async prompt() {
    return 'Run Docker commands: ps, build, run, exec, logs, stop, rm, compose_up, compose_down.'
  },
  userFacingName() {
    return 'Docker'
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
  isReadOnly(input) {
    return READ_ONLY_ACTIONS.has(input.action)
  },
  isDestructive(input) {
    return DESTRUCTIVE_ACTIONS.has(input.action)
  },
  toAutoClassifierInput(input) {
    return `${input.action} ${input.container || input.image || ''}`
  },
  async checkPermissions(input) {
    return {
      behavior: 'ask',
      message: `UR wants to run docker ${input.action}`,
      updatedInput: input,
    }
  },
  renderToolUseMessage() {
    return null
  },
  async call(input) {
    const result = await dispatch(input)
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
