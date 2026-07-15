import { stat } from 'node:fs/promises'
import { cwd } from 'node:process'
import type { AgUiPermissionMode } from '../../services/agents/agUi.js'
import { isFsInaccessible } from '../../utils/errors.js'
import { cliError } from '../exit.js'

export async function agUiServeHandler(options: {
  host?: string
  port?: string
  allowOrigin?: string[]
  permissionMode?: AgUiPermissionMode
}): Promise<void> {
  const providedCwd = cwd()
  try {
    await stat(providedCwd)
  } catch (error) {
    if (isFsInaccessible(error)) {
      cliError(`Error: Directory ${providedCwd} does not exist`)
    }
    throw error
  }

  try {
    const { setup } = await import('../../setup.js')
    await setup(providedCwd, 'default', false, false, undefined, false)
    const { serveAgUi } = await import('../../entrypoints/agUi.js')
    await serveAgUi({
      cwd: providedCwd,
      host: options.host ?? '127.0.0.1',
      port: Number(options.port ?? '8977'),
      token: process.env.UR_AG_UI_TOKEN,
      allowedOrigins: options.allowOrigin,
      permissionMode: options.permissionMode ?? 'default',
    })
  } catch (error) {
    cliError(
      `Error: Failed to start AG-UI server: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}
