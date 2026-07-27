/**
 * Desktop control primitives.
 *
 * Command construction is pure so it can be tested without a display; the exec
 * and the screen are only touched at run time. Coordinates and text are passed
 * as separate argv elements or on stdin — never concatenated into a shell
 * string — because a model-authored click target must not be able to become a
 * command.
 */

export type ComputerPlatform = 'darwin' | 'linux'

export type ComputerCommand = {
  file: string
  args: string[]
  stdin?: string
  /** Tool that must be installed for this command to work. */
  requires: string
}

export type Point = { x: number; y: number }

export const MAX_TYPE_CHARS = 2000

/** Screen bounds are validated so a hallucinated coordinate cannot click blind. */
export function isPointWithin(
  point: Point,
  screen: { width: number; height: number },
): boolean {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isInteger(point.x) &&
    Number.isInteger(point.y) &&
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < screen.width &&
    point.y < screen.height
  )
}

export function buildScreenshotCommand(
  platform: ComputerPlatform,
  outputPath: string,
): ComputerCommand {
  switch (platform) {
    case 'darwin':
      // -x silences the shutter; -o omits window shadows.
      return {
        file: 'screencapture',
        args: ['-x', '-o', outputPath],
        requires: 'screencapture',
      }
    case 'linux':
      return {
        file: 'import',
        args: ['-window', 'root', outputPath],
        requires: 'imagemagick',
      }
  }
}

export function buildClickCommand(
  platform: ComputerPlatform,
  point: Point,
  button: 'left' | 'right' = 'left',
): ComputerCommand {
  switch (platform) {
    case 'darwin':
      return {
        file: 'cliclick',
        args: [`${button === 'right' ? 'rc' : 'c'}:${point.x},${point.y}`],
        requires: 'cliclick',
      }
    case 'linux':
      return {
        file: 'xdotool',
        args: [
          'mousemove',
          String(point.x),
          String(point.y),
          'click',
          button === 'right' ? '3' : '1',
        ],
        requires: 'xdotool',
      }
  }
}

export function buildTypeCommand(
  platform: ComputerPlatform,
  text: string,
): ComputerCommand | null {
  if (!text || text.length > MAX_TYPE_CHARS) return null
  switch (platform) {
    case 'darwin':
      // osascript reads the script from stdin; the text is injected as a
      // quoted AppleScript string literal with escapes applied, so it cannot
      // terminate the statement.
      return {
        file: 'osascript',
        args: ['-'],
        stdin: `tell application "System Events" to keystroke ${appleScriptString(text)}`,
        requires: 'osascript',
      }
    case 'linux':
      return {
        file: 'xdotool',
        args: ['type', '--clearmodifiers', '--', text],
        requires: 'xdotool',
      }
  }
}

/**
 * Quote a string for AppleScript. Backslash and double quote are the only
 * escapes AppleScript recognises inside a literal; newlines have to leave the
 * literal entirely and come back via `return`, or the script fails to compile.
 */
export function appleScriptString(text: string): string {
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped.replace(/\n/g, '" & return & "')}"`
}

export type ComputerAction =
  | { type: 'screenshot' }
  | { type: 'click'; point: Point; button?: 'left' | 'right' }
  | { type: 'type'; text: string }

/**
 * Actions that change the machine's state require explicit approval; reading
 * the screen does not. Screenshots are still sensitive — they can capture
 * passwords and private messages — but they are recoverable, whereas a stray
 * click is not.
 */
export function actionRequiresApproval(action: ComputerAction): boolean {
  return action.type !== 'screenshot'
}

export function describeAction(action: ComputerAction): string {
  switch (action.type) {
    case 'screenshot':
      return 'Capture the screen'
    case 'click':
      return `${action.button === 'right' ? 'Right-click' : 'Click'} at ${action.point.x},${action.point.y}`
    case 'type':
      return `Type ${action.text.length} characters`
  }
}
