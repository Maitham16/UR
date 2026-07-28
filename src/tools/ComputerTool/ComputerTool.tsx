import { existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../types/permissions.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import {
  actionRequiresApproval,
  buildClickCommand,
  buildScreenshotCommand,
  buildTypeCommand,
  type ComputerCommand,
  type ComputerPlatform,
  describeAction,
  isPointWithin,
  MAX_TYPE_CHARS,
} from '../../utils/computerUse/commands.js'
import {
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'

export const COMPUTER_TOOL_NAME = 'Computer'

const inputSchema = lazySchema(() =>
  z.object({
    action: z
      .enum(['screenshot', 'click', 'type'])
      .describe('What to do: read the screen, click a point, or type text'),
    x: z.number().int().optional().describe('X coordinate, required for click'),
    y: z.number().int().optional().describe('Y coordinate, required for click'),
    button: z
      .enum(['left', 'right'])
      .optional()
      .describe('Mouse button for click (default left)'),
    text: z
      .string()
      .optional()
      .describe(`Text to type, required for type (max ${MAX_TYPE_CHARS} chars)`),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    action: z.string(),
    ok: z.boolean(),
    detail: z.string(),
    screenshotPath: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function supportedPlatform(): ComputerPlatform | null {
  return process.platform === 'darwin' || process.platform === 'linux'
    ? (process.platform as ComputerPlatform)
    : null
}

async function run(command: ComputerCommand): Promise<string | null> {
  const result = await execFileNoThrow(command.file, command.args, {
    input: command.stdin,
    stdin: command.stdin === undefined ? 'ignore' : 'pipe',
    timeout: 30_000,
    preserveOutputOnError: true,
  })
  if (result.code === 0) return null
  return /not found|ENOENT/i.test(result.stderr)
    ? `${command.file} is not installed. Install "${command.requires}".`
    : result.stderr.trim() || `${command.file} exited ${result.code}`
}

async function screenSize(
  platform: ComputerPlatform,
): Promise<{ width: number; height: number } | null> {
  if (platform === 'darwin') {
    const result = await execFileNoThrow('system_profiler', [
      'SPDisplaysDataType',
    ])
    const match = result.stdout.match(/Resolution:\s*(\d+)\s*x\s*(\d+)/)
    return match
      ? { width: Number(match[1]), height: Number(match[2]) }
      : null
  }
  const result = await execFileNoThrow('xdotool', ['getdisplaygeometry'])
  const [width, height] = result.stdout.trim().split(/\s+/).map(Number)
  return Number.isFinite(width) && Number.isFinite(height)
    ? { width: width!, height: height! }
    : null
}

/**
 * Desktop control as a tool the model can call.
 *
 * The `/computer` command exposes the same primitives to the human. This is the
 * agent-facing half, and it is deliberately stricter: clicks and keystrokes go
 * through the normal permission engine rather than a `--yes` flag, because the
 * model is choosing the coordinates, and a coordinate it invented is not
 * something the user has seen.
 */
export const ComputerTool = buildTool({
  name: COMPUTER_TOOL_NAME,
  searchHint: 'take a screenshot, click, or type on the desktop',
  shouldDefer: true,
  maxResultSizeChars: 4_000,
  async prompt() {
    return [
      'Control the desktop: screenshot, click, or type.',
      '',
      'screenshot reads the screen and needs no approval. click and type change',
      'the machine and always ask, because you are choosing the coordinates and',
      'the user has not seen them. Take a screenshot first and read it before',
      'clicking; never guess a coordinate. Clicks outside the real screen are',
      'refused, and typing is capped at ' + String(MAX_TYPE_CHARS) + ' characters.',
    ].join('\n')
  },
  toAutoClassifierInput(input) {
    return input.action
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async description(input) {
    const { action } = input as { action: string }
    return action === 'screenshot'
      ? 'UR wants to capture the screen'
      : `UR wants to ${action} on your desktop`
  },
  userFacingName() {
    return 'Computer'
  },
  getActivityDescription(input) {
    const { action } = input as { action: string }
    return action === 'screenshot' ? 'Capturing screen' : `Desktop ${action}`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    // Input events go to whichever window has focus; two at once interleave.
    return false
  },
  isReadOnly() {
    // Screenshots read, but the tool as a whole can type and click.
    return false
  },
  isEnabled() {
    return supportedPlatform() !== null
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    const { action } = input as { action: 'screenshot' | 'click' | 'type' }
    // Reading the screen is recoverable; a stray click is not.
    if (!actionRequiresApproval({ type: 'screenshot' }) && action === 'screenshot') {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: { type: 'other', reason: 'Screen read is read-only' },
      }
    }
    return {
      behavior: 'ask',
      message: describeAction(
        action === 'click'
          ? {
              type: 'click',
              point: {
                x: (input as { x?: number }).x ?? 0,
                y: (input as { y?: number }).y ?? 0,
              },
            }
          : { type: 'type', text: (input as { text?: string }).text ?? '' },
      ),
    }
  },
  async call(input) {
    const platform = supportedPlatform()
    if (!platform) {
      return {
        data: {
          action: input.action,
          ok: false,
          detail: `Desktop control is not supported on ${process.platform}.`,
        },
      }
    }

    if (input.action === 'screenshot') {
      const path = join(tmpdir(), `ur-screenshot-${Date.now()}.png`)
      const error = await run(buildScreenshotCommand(platform, path))
      if (error) {
        return { data: { action: 'screenshot', ok: false, detail: error } }
      }
      if (!existsSync(path)) {
        return {
          data: {
            action: 'screenshot',
            ok: false,
            detail:
              'Screenshot reported success but wrote no file. On macOS, grant ' +
              'Screen Recording permission to the terminal.',
          },
        }
      }
      return {
        data: {
          action: 'screenshot',
          ok: true,
          detail: `Captured ${statSync(path).size} bytes`,
          screenshotPath: path,
        },
      }
    }

    if (input.action === 'click') {
      const point = { x: input.x ?? Number.NaN, y: input.y ?? Number.NaN }
      const screen = await screenSize(platform)
      if (!screen) {
        return {
          data: {
            action: 'click',
            ok: false,
            detail:
              'Screen geometry unavailable, so the target cannot be validated. ' +
              'Refusing rather than clicking blind.',
          },
        }
      }
      if (!isPointWithin(point, screen)) {
        return {
          data: {
            action: 'click',
            ok: false,
            detail: `Point ${point.x},${point.y} is outside the ${screen.width}x${screen.height} screen.`,
          },
        }
      }
      const error = await run(
        buildClickCommand(platform, point, input.button ?? 'left'),
      )
      return {
        data: {
          action: 'click',
          ok: !error,
          detail: error ?? `Clicked at ${point.x},${point.y}`,
        },
      }
    }

    const command = buildTypeCommand(platform, input.text ?? '')
    if (!command) {
      return {
        data: {
          action: 'type',
          ok: false,
          detail: `text must be 1–${MAX_TYPE_CHARS} characters.`,
        },
      }
    }
    const error = await run(command)
    return {
      data: {
        action: 'type',
        ok: !error,
        detail: error ?? `Typed ${(input.text ?? '').length} characters`,
      },
    }
  },
  mapToolResultToToolResultBlockParam({ action, ok, detail }, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `${action}: ${ok ? 'ok' : 'failed'} — ${detail}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
