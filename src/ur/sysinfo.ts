// OS / environment + workspace info for /os and /workspace.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { arch, platform, release } from 'node:os'
import { join } from 'node:path'
import { detectProjectDna, formatDna } from './projectDna.ts'

export function commandExists(bin: string): boolean {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    return spawnSync(cmd, [bin], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

/** Run a tool and capture output (bounded). Never throws. */
export function runCapture(bin: string, args: string[], timeoutMs = 15000): { ok: boolean; out: string; err: string } {
  try {
    const r = spawnSync(bin, args, { timeout: timeoutMs, maxBuffer: 8_000_000, encoding: 'utf8' })
    return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }
  } catch (e) {
    return { ok: false, out: '', err: (e as Error).message }
  }
}

export function osInfo(): string {
  const tools = ['git', 'ollama', 'node', 'bun', 'python3', 'ffmpeg', 'yt-dlp', 'rg', 'cargo', 'go']
  const present = tools.filter(commandExists)
  return [
    `platform:  ${platform()} (${release()})`,
    `arch:      ${arch()}`,
    `shell:     ${process.env.SHELL ?? process.env.ComSpec ?? 'unknown'}`,
    `runtime:   ${typeof Bun !== 'undefined' ? 'bun ' + Bun.version : 'node ' + process.version}`,
    `tools:     ${present.join(', ') || 'none detected'}`,
    `missing:   ${tools.filter((t) => !present.includes(t)).join(', ') || 'none'}`,
  ].join('\n')
}

export function workspaceInfo(cwd: string): string {
  let fileCount = 0
  try {
    fileCount = readdirSync(cwd).length
  } catch {
    /* ignore */
  }
  const git = existsSync(join(cwd, '.git')) ? 'yes' : 'no'
  const dna = formatDna(detectProjectDna(cwd))
  return [`workspace: ${cwd}`, `entries:   ${fileCount}`, `git:       ${git}`, '', dna].join('\n')
}

/** Compatibility API for the canonical active-provider readiness report. */
export async function urDoctor(cwd: string): Promise<string> {
  const { collectReadiness, formatReadiness } = await import('../services/readiness.js')
  return formatReadiness(await collectReadiness(cwd))
}
