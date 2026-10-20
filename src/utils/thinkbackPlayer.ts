import { spawn } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { constants, tmpdir } from 'node:os'
import { isAbsolute, join, relative, sep } from 'node:path'
import { isRunningWithBun } from './bundledMode.js'
import { resolveUrExecutable } from './urExecutable.js'

function inside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

/** Only the exact player belonging to a registered Thinkback installation. */
export async function resolveThinkbackPlayer(candidate: string, installedRoots: readonly string[]): Promise<{ player: string; directory: string }> {
  const requested = await realpath(candidate)
  for (const installed of installedRoots) {
    let root: string
    try { root = await realpath(installed) } catch { continue }
    const skill = await realpath(join(root, 'skills', 'thinkback')).catch(() => null)
    if (!skill || !inside(root, skill)) continue
    const expected = await realpath(join(skill, 'player.js')).catch(() => null)
    if (expected !== requested || !inside(skill, expected)) continue
    if (!(await stat(expected)).isFile()) throw new Error('Thinkback player is not a file')
    const data = await realpath(join(skill, 'year_in_review.js'))
    if (!inside(skill, data)) throw new Error('Thinkback animation data escapes its installed skill')
    await readFile(data)
    return { player: expected, directory: skill }
  }
  throw new Error('Player does not belong to an installed Thinkback plugin. Reinstall the optional plugin with /think-back.')
}

/** Run the approved player with this executable's embedded runtime, never Node. */
export async function runThinkbackPlayer(candidate: string, installedRoots: readonly string[]): Promise<number> {
  try {
    const { player, directory } = await resolveThinkbackPlayer(candidate, installedRoots)
    if (!isRunningWithBun()) throw new Error('This distribution has no compatible Thinkback playback backend')
    const { file } = resolveUrExecutable()
    const temporary = await mkdtemp(join(tmpdir(), 'ur-thinkback-runtime-'))
    try {
      const config = join(temporary, 'bunfig.toml')
      await writeFile(config, '# UR player: no project preloads\n', { mode: 0o600 })
      return await new Promise(resolve => {
        // Validate the only script before entering embedded Bun, preserving
        // require.main, __dirname and argv while disabling implicit installs.
        const child = spawn(file, ['--no-install', '--no-env-file', `--config=${config}`, player], {
          cwd: directory,
          env: { ...process.env, BUN_BE_BUN: '1' },
          stdio: 'inherit',
        })
        child.once('error', error => {
          console.error(`Thinkback playback backend unavailable: ${error.message}`)
          resolve(1)
        })
        child.once('close', (code, signal) => resolve(code ?? (signal ? 128 + (constants.signals[signal] ?? 1) : 1)))
      })
    } finally {
      await rm(temporary, { recursive: true, force: true })
    }
  } catch (error) {
    console.error(`Thinkback playback unavailable: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}
