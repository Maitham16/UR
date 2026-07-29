import { existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import {
  buildClickCommand,
  buildScreenshotCommand,
  buildTypeCommand,
  type ComputerCommand,
  type ComputerPlatform,
  describeAction,
  isPointWithin,
} from '../../utils/computerUse/commands.js'

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
  const missing = /not found|ENOENT/i.test(result.stderr)
  return missing
    ? `${command.file} is not installed. Install "${command.requires}" and try again.`
    : result.stderr.trim() || `${command.file} exited ${result.code}`
}

/**
 * Screen size, needed to reject out-of-bounds coordinates before clicking.
 * Returns null when it cannot be determined — the caller then refuses rather
 * than clicking blind.
 */
async function screenSize(
  platform: ComputerPlatform,
): Promise<{ width: number; height: number } | null> {
  if (platform === 'darwin') {
    const result = await execFileNoThrow('system_profiler', [
      'SPDisplaysDataType',
    ])
    const match = result.stdout.match(/Resolution:\s*(\d+)\s*x\s*(\d+)/)
    if (!match) return null
    return { width: Number(match[1]), height: Number(match[2]) }
  }
  const result = await execFileNoThrow('xdotool', ['getdisplaygeometry'])
  const parts = result.stdout.trim().split(/\s+/)
  if (parts.length < 2) return null
  const [width, height] = parts.map(Number)
  return Number.isFinite(width) && Number.isFinite(height)
    ? { width: width!, height: height! }
    : null
}

export const call: LocalCommandCall = async (args: string) => {
  const platform = supportedPlatform()
  if (!platform) {
    return {
      type: 'text',
      value: `Desktop control is not supported on ${process.platform}.`,
      exitCode: 1,
    }
  }
  // parseArguments, not split(): shell wiring quotes each argument.
  const tokens = parseArguments(args)
  const approved = tokens.includes('--yes')
  const rest = tokens.filter(token => token !== '--yes' && token !== '--right')
  const rightClick = tokens.includes('--right')
  const action = (rest[0] ?? '').toLowerCase()

  if (action === 'screenshot') {
    const path = rest[1] ?? join(tmpdir(), `ur-screenshot-${Date.now()}.png`)
    const error = await run(buildScreenshotCommand(platform, path))
    if (error) {
      return {
        type: 'text',
        value: `Screenshot failed: ${error}`,
        exitCode: 1,
      }
    }
    if (!existsSync(path)) {
      return {
        type: 'text',
        value:
          'Screenshot reported success but no file was written. ' +
          'On macOS, grant Screen Recording permission to your terminal in ' +
          'System Settings → Privacy & Security.',
        exitCode: 1,
      }
    }
    return {
      type: 'text',
      value: `Captured ${statSync(path).size} bytes to ${path}`,
    }
  }

  if (action === 'click') {
    const point = { x: Number(rest[1]), y: Number(rest[2]) }
    if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) {
      return {
        type: 'text',
        value: 'Usage: /computer click <x> <y> --yes',
        exitCode: 2,
      }
    }
    const screen = await screenSize(platform)
    if (!screen) {
      return {
        type: 'text',
        value:
          'Could not determine screen size, so the click target cannot be ' +
          'validated. Refusing rather than clicking blind.',
        exitCode: 1,
      }
    }
    if (!isPointWithin(point, screen)) {
      return {
        type: 'text',
        value: `Point ${point.x},${point.y} is outside the ${screen.width}x${screen.height} screen.`,
        exitCode: 2,
      }
    }
    if (!approved) {
      return {
        type: 'text',
        value: `${describeAction({ type: 'click', point, button: rightClick ? 'right' : 'left' })} — re-run with --yes to confirm.`,
        exitCode: 2,
      }
    }
    const error = await run(
      buildClickCommand(platform, point, rightClick ? 'right' : 'left'),
    )
    return {
      type: 'text',
      value: error
        ? `Click failed: ${error}`
        : `Clicked at ${point.x},${point.y}`,
      ...(error ? { exitCode: 1 } : {}),
    }
  }

  if (action === 'type') {
    const text = rest.slice(1).join(' ')
    const command = buildTypeCommand(platform, text)
    if (!command) {
      return {
        type: 'text',
        value: 'Usage: /computer type <text> --yes  (1–2000 characters)',
        exitCode: 2,
      }
    }
    if (!approved) {
      return {
        type: 'text',
        value: `${describeAction({ type: 'type', text })} — re-run with --yes to confirm.`,
        exitCode: 2,
      }
    }
    const error = await run(command)
    return {
      type: 'text',
      value: error
        ? `Type failed: ${error}`
        : `Typed ${text.length} characters into the focused window.`,
      ...(error ? { exitCode: 1 } : {}),
    }
  }

  return {
    type: 'text',
    value:
      'Usage:\n' +
      '  /computer screenshot [path]\n' +
      '  /computer click <x> <y> [--right] --yes\n' +
      '  /computer type <text> --yes',
    exitCode: 2,
  }
}
