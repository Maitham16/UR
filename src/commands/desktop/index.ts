import type { Command } from '../../commands.js'

export function isDesktopCommandSupported(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): boolean {
  if (platform === 'darwin') {
    return true
  }
  if (platform === 'win32' && arch === 'x64') {
    return true
  }
  return false
}

const desktop = {
  type: 'local-jsx',
  name: 'desktop',
  aliases: ['app'],
  description: 'Continue the current session in UR Desktop',
  // Ungated: the 'ur-ai' availability requirement was unsatisfiable — it
  // needs the 'subscription' provider, which the registry blocks as an
  // internal placeholder, so no user could ever see this command.
  isEnabled: isDesktopCommandSupported,
  get isHidden() {
    return !isDesktopCommandSupported()
  },
  load: () => import('./desktop.js'),
} satisfies Command

export default desktop
