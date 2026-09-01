import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  executeURTmuxCommand,
  getURSocketName,
  type URTmuxCommandResult,
} from '../../utils/tmuxSocket.js'
import { isTungstenEnabled } from './availability.js'

const TUNGSTEN_TOOL_NAME = 'Tungsten'
const SESSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const TARGET_PATTERN = /^(?:%[0-9]+|[A-Za-z0-9][A-Za-z0-9_.:-]{0,127})$/
const DEFAULT_CAPTURE_LINES = 200
const MAX_CAPTURE_LINES = 2_000
const MAX_PERMISSION_TEXT_CHARS = 400
const MAX_PERMISSION_KEYS = 12

const inputSchema = lazySchema(() =>
  z.object({
    action: z
      .enum([
        'create_session',
        'send_keys',
        'capture_pane',
        'list_sessions',
        'kill_session',
      ])
      .describe('Terminal session operation to perform'),
    session_name: z
      .string()
      .optional()
      .describe(
        'tmux session name (letters, numbers, dot, underscore, or hyphen)',
      ),
    target: z
      .string()
      .optional()
      .describe('tmux target such as session:window.pane or %pane_id'),
    cwd: z
      .string()
      .optional()
      .describe('Working directory for a newly created session'),
    text: z
      .string()
      .optional()
      .describe('Literal text to send; tmux key names are not interpreted'),
    keys: z
      .array(z.string().min(1).max(64))
      .max(32)
      .optional()
      .describe('tmux key names such as Enter, C-c, Up, or Down'),
    press_enter: z
      .boolean()
      .optional()
      .describe('After literal text, send Enter (defaults to true)'),
    capture_lines: z
      .number()
      .int()
      .min(1)
      .max(MAX_CAPTURE_LINES)
      .optional()
      .describe(
        `Number of pane history lines to capture (default ${DEFAULT_CAPTURE_LINES})`,
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type TungstenInput = z.infer<InputSchema>

const sessionSchema = z.object({
  name: z.string(),
  windows: z.number().int().nonnegative(),
  attached: z.boolean(),
  managed: z.boolean(),
})

const outputSchema = lazySchema(() =>
  z.object({
    action: z.enum([
      'create_session',
      'send_keys',
      'capture_pane',
      'list_sessions',
      'kill_session',
    ]),
    success: z.boolean(),
    message: z.string(),
    session_name: z.string().optional(),
    target: z.string().optional(),
    content: z.string().optional(),
    sessions: z.array(sessionSchema).optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type TungstenOutput = z.infer<OutputSchema>

export type TungstenTmuxRunner = (
  args: readonly string[],
) => Promise<URTmuxCommandResult>

const sessionsWithTungstenUsage = new Set<string>()

function validationError(input: TungstenInput): string | null {
  const requiresSession =
    input.action === 'create_session' || input.action === 'kill_session'
  if (requiresSession && !input.session_name) {
    return `session_name is required for ${input.action}`
  }
  if (input.action === 'kill_session' && input.session_name === 'base') {
    return 'The base session anchors UR\'s isolated tmux server and cannot be killed directly'
  }
  if (input.session_name && !SESSION_NAME_PATTERN.test(input.session_name)) {
    return 'session_name must start with an alphanumeric character and contain only letters, numbers, dot, underscore, or hyphen (maximum 64 characters)'
  }
  if (input.target && !TARGET_PATTERN.test(input.target)) {
    return 'target must be a tmux pane ID (for example %1) or a session/window/pane target without whitespace'
  }
  if (input.action === 'send_keys') {
    const hasText = input.text !== undefined
    const hasKeys = input.keys !== undefined && input.keys.length > 0
    if (hasText === hasKeys) {
      return 'send_keys requires exactly one of text or keys'
    }
  }
  if (
    input.capture_lines !== undefined &&
    (!Number.isInteger(input.capture_lines) ||
      input.capture_lines < 1 ||
      input.capture_lines > MAX_CAPTURE_LINES)
  ) {
    return `capture_lines must be an integer from 1 to ${MAX_CAPTURE_LINES}`
  }
  return null
}

function resolveTarget(
  input: TungstenInput,
  context: ToolUseContext,
): string | null {
  return (
    input.target ??
    input.session_name ??
    context.getAppState().tungstenActiveSession?.target ??
    null
  )
}

function quotedExcerpt(value: string, limit: number): string {
  const characters = Array.from(value)
  const excerpt = characters.slice(0, limit).join('')
  const omitted = characters.length - Math.min(characters.length, limit)
  return `${JSON.stringify(excerpt)}${omitted > 0 ? ` … (${omitted} more characters)` : ''}`
}

export function formatTungstenPermissionPayload(
  input: Pick<TungstenInput, 'text' | 'keys'>,
): string {
  if (input.text !== undefined) {
    return `text=${quotedExcerpt(input.text, MAX_PERMISSION_TEXT_CHARS)}`
  }
  const keys = input.keys ?? []
  const shown = keys
    .slice(0, MAX_PERMISSION_KEYS)
    .map(key => quotedExcerpt(key, 64))
    .join(', ')
  const omitted = keys.length - Math.min(keys.length, MAX_PERMISSION_KEYS)
  return `keys=[${shown}${omitted > 0 ? `, … (${omitted} more keys)` : ''}]`
}

async function canonicalizeTarget(
  input: TungstenInput,
  target: string,
  runTmux: TungstenTmuxRunner,
): Promise<
  | { success: true; sessionName: string; target: string }
  | { success: false; output: TungstenOutput }
> {
  const result = await runTmux([
    'display-message',
    '-p',
    '-t',
    target,
    '#{session_name}\t#{pane_id}',
  ])
  if (result.code !== 0) {
    return { success: false, output: failed(input, result, target) }
  }

  const [sessionName, paneId] = result.stdout.trim().split('\t')
  if (!sessionName || !paneId || !/^%[0-9]+$/.test(paneId)) {
    return {
      success: false,
      output: {
        action: input.action,
        success: false,
        message: `tmux returned an invalid identity for target ${target}`,
        session_name: input.session_name,
        target,
      },
    }
  }
  if (input.session_name && input.session_name !== sessionName) {
    return {
      success: false,
      output: {
        action: input.action,
        success: false,
        message: `Target ${target} belongs to tmux session "${sessionName}", not "${input.session_name}"`,
        session_name: input.session_name,
        target: paneId,
      },
    }
  }
  return { success: true, sessionName, target: paneId }
}

function failed(
  input: TungstenInput,
  result: URTmuxCommandResult,
  target?: string,
): TungstenOutput {
  const detail = (
    result.stderr ||
    result.stdout ||
    `tmux exited ${result.code}`
  )
    .trim()
    .slice(0, 4_000)
  return {
    action: input.action,
    success: false,
    message: detail,
    session_name: input.session_name,
    target,
  }
}

function activateSession(
  context: ToolUseContext,
  sessionName: string,
  target: string,
  lastCommand?: string,
): void {
  context.setAppState(prev => ({
    ...prev,
    tungstenActiveSession: {
      sessionName,
      socketName: getURSocketName(),
      target,
    },
    tungstenPanelVisible: prev.tungstenPanelVisible ?? true,
    tungstenPanelAutoHidden: false,
    ...(lastCommand
      ? {
          tungstenLastCommand: {
            command: lastCommand,
            timestamp: Date.now(),
          },
        }
      : {}),
  }))
}

function parseSessions(stdout: string): Array<{
  name: string
  windows: number
  attached: boolean
  managed: boolean
}> {
  return stdout
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [name = '', windows = '0', attached = '0'] = line.split('\t')
      return {
        name,
        windows: Number.parseInt(windows, 10) || 0,
        attached: attached === '1',
        managed: sessionsWithTungstenUsage.has(name),
      }
    })
}

/** Execute a validated Tungsten operation. Exported for deterministic tests. */
export async function executeTungstenAction(
  input: TungstenInput,
  context: ToolUseContext,
  runTmux: TungstenTmuxRunner = executeURTmuxCommand,
): Promise<TungstenOutput> {
  const invalid = validationError(input)
  if (invalid) {
    return {
      action: input.action,
      success: false,
      message: invalid,
      session_name: input.session_name,
      target: input.target,
    }
  }

  if (input.action === 'list_sessions') {
    const result = await runTmux([
      'list-sessions',
      '-F',
      '#{session_name}\t#{session_windows}\t#{session_attached}',
    ])
    if (result.code !== 0) return failed(input, result)
    const sessions = parseSessions(result.stdout)
    return {
      action: input.action,
      success: true,
      message: `Found ${sessions.length} tmux session(s) on UR's isolated socket`,
      sessions,
    }
  }

  if (input.action === 'create_session') {
    const sessionName = input.session_name!
    const target = `${sessionName}:0.0`
    const result = await runTmux([
      'new-session',
      '-d',
      '-s',
      sessionName,
      '-c',
      input.cwd ?? getCwd(),
      '-e',
      'UR_CODE_SKIP_PROMPT_HISTORY=true',
    ])
    if (result.code !== 0) return failed(input, result, target)
    sessionsWithTungstenUsage.add(sessionName)
    activateSession(context, sessionName, target)
    return {
      action: input.action,
      success: true,
      message: `Created tmux session "${sessionName}"`,
      session_name: sessionName,
      target,
    }
  }

  if (input.action === 'kill_session') {
    const sessionName = input.session_name!
    const result = await runTmux(['kill-session', '-t', sessionName])
    if (result.code !== 0) return failed(input, result, sessionName)
    sessionsWithTungstenUsage.delete(sessionName)
    context.setAppState(prev =>
      prev.tungstenActiveSession?.sessionName === sessionName
        ? {
            ...prev,
            tungstenActiveSession: undefined,
            tungstenPanelAutoHidden: false,
          }
        : prev,
    )
    return {
      action: input.action,
      success: true,
      message: `Killed tmux session "${sessionName}"`,
      session_name: sessionName,
    }
  }

  const target = resolveTarget(input, context)
  if (!target) {
    return {
      action: input.action,
      success: false,
      message:
        'No target was provided and there is no active Tungsten session. Create a session or pass target.',
    }
  }

  const canonical = await canonicalizeTarget(input, target, runTmux)
  if ('output' in canonical) return canonical.output
  const { sessionName, target: canonicalTarget } = canonical
  if (input.action === 'capture_pane') {
    const lines = input.capture_lines ?? DEFAULT_CAPTURE_LINES
    const result = await runTmux([
      'capture-pane',
      '-p',
      '-J',
      '-S',
      `-${lines}`,
      '-t',
      canonicalTarget,
    ])
    if (result.code !== 0) return failed(input, result, canonicalTarget)
    sessionsWithTungstenUsage.add(sessionName)
    activateSession(context, sessionName, canonicalTarget)
    context.setAppState(prev => ({
      ...prev,
      tungstenLastCapturedTime: Date.now(),
    }))
    return {
      action: input.action,
      success: true,
      message: `Captured the last ${lines} line(s) from ${canonicalTarget}`,
      session_name: sessionName,
      target: canonicalTarget,
      content: result.stdout,
    }
  }

  let result: URTmuxCommandResult
  let commandLabel: string
  if (input.text !== undefined) {
    result = await runTmux([
      'send-keys',
      '-t',
      canonicalTarget,
      '-l',
      input.text,
    ])
    commandLabel = input.text
    if (result.code === 0 && input.press_enter !== false) {
      result = await runTmux(['send-keys', '-t', canonicalTarget, 'Enter'])
      commandLabel += ' + Enter'
    }
  } else {
    const keys = input.keys ?? []
    result = await runTmux(['send-keys', '-t', canonicalTarget, ...keys])
    commandLabel = keys.join(' ')
  }
  if (result.code !== 0) return failed(input, result, canonicalTarget)
  sessionsWithTungstenUsage.add(sessionName)
  activateSession(context, sessionName, canonicalTarget, commandLabel)
  return {
    action: input.action,
    success: true,
    message: `Sent ${commandLabel} to ${canonicalTarget}`,
    session_name: sessionName,
    target: canonicalTarget,
  }
}

export function clearSessionsWithTungstenUsage(): void {
  sessionsWithTungstenUsage.clear()
}

export function resetInitializationState(): void {
  clearSessionsWithTungstenUsage()
}

export const TungstenTool = buildTool({
  name: TUNGSTEN_TOOL_NAME,
  searchHint: 'control persistent interactive tmux terminal sessions',
  permissionRequestKind: 'fallback',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description() {
    return "Create and control persistent terminal sessions on UR's isolated tmux socket"
  },
  async prompt() {
    return `Use Tungsten for persistent interactive terminal sessions. Operations are create_session, send_keys, capture_pane, list_sessions, and kill_session. Literal text is sent with tmux send-keys -l so it cannot be reinterpreted as a tmux key name. Read output with capture_pane after sending commands. Sessions run only on UR's isolated tmux socket.`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return isTungstenEnabled()
  },
  isConcurrencySafe(input) {
    return input.action === 'capture_pane' || input.action === 'list_sessions'
  },
  isReadOnly(input) {
    return input.action === 'capture_pane' || input.action === 'list_sessions'
  },
  isDestructive(input) {
    return input.action === 'kill_session' || input.action === 'send_keys'
  },
  async validateInput(input) {
    const message = validationError(input)
    return message
      ? { result: false, message, errorCode: 2 }
      : { result: true }
  },
  async checkPermissions(input) {
    if (input.action === 'capture_pane' || input.action === 'list_sessions') {
      return { behavior: 'allow', updatedInput: input }
    }
    return {
      behavior: 'ask',
      message:
        input.action === 'send_keys'
          ? `Send ${formatTungstenPermissionPayload(input)} to terminal ${input.target ?? input.session_name ?? 'session'}?`
          : `${input.action.replaceAll('_', ' ')} ${input.session_name ?? ''}`.trim(),
    }
  },
  toAutoClassifierInput(input) {
    return `${input.action} ${input.target ?? input.session_name ?? ''} ${input.text ?? input.keys?.join(' ') ?? ''}`.trim()
  },
  userFacingName() {
    return 'Tungsten terminal'
  },
  renderToolUseMessage(input) {
    const target = input.target ?? input.session_name
    if (input.action === 'send_keys') {
      return `send_keys${target ? ` (${target})` : ''}: ${formatTungstenPermissionPayload(input)}`
    }
    return `${input.action ?? 'terminal operation'}${target ? ` (${target})` : ''}`
  },
  renderToolResultMessage(output) {
    return output.content || output.message
  },
  async call(input, context) {
    return { data: await executeTungstenAction(input, context) }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: jsonStringify(output),
      is_error: !output.success,
    }
  },
} satisfies ToolDef<InputSchema, TungstenOutput>)

export { TungstenLiveMonitor } from './TungstenLiveMonitor.js'
