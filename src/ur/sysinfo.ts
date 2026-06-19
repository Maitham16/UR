// OS / environment + workspace info for /os and /workspace.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { arch, homedir, platform, release } from 'node:os'
import { join } from 'node:path'
import { detectProjectDna, formatDna } from './projectDna.ts'
import { parseOllamaModelNames } from '../utils/model/ollamaModels.js'
import {
  pickBestCoderModel,
  pickSmallFastModel,
  recommendedCoderModelToPull,
} from '../utils/model/ollamaRouter.js'

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

/** Comprehensive UR environment check: toolchain, Ollama, .ur, MCP, playwright. */
export async function urDoctor(cwd: string): Promise<string> {
  const lines: string[] = ['UR doctor', '', osInfo(), '']

  const host = 'http://localhost:11434'
  let ollama: string
  let ollamaModels: string[] = []
  try {
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (res.ok) {
      ollamaModels = parseOllamaModelNames(await res.json())
      ollama = `ok — ${ollamaModels.length} model(s) @ ${host}`
    } else ollama = `error ${res.status} @ ${host}`
  } catch {
    ollama = `unreachable @ ${host} (start with: ollama serve)`
  }
  lines.push(`ollama:     ${ollama}`)
  if (ollamaModels.length > 0) {
    lines.push(
      `  routing:  main=${pickBestCoderModel(ollamaModels) ?? '?'} · fast=${pickSmallFastModel(ollamaModels) ?? '?'}`,
    )
    const pull = recommendedCoderModelToPull(ollamaModels)
    if (pull) {
      lines.push(`  tip:      no coder model found — consider: ollama pull ${pull}`)
    }
  }

  const urDir = join(cwd, '.ur')
  if (existsSync(urDir)) {
    const have = ['actions.jsonl', 'project_dna.md', 'mode', 'graph', 'tools', 'research', 'memory', 'index'].filter((n) => existsSync(join(urDir, n)))
    lines.push(`.ur:        present — ${have.join(', ') || '(empty)'}`)
  } else {
    lines.push('.ur:        missing (run /ur-init)')
  }

  const mcp = [join(cwd, '.ur', 'mcp', 'servers.toml'), join(homedir(), '.ur', 'mcp', 'servers.toml')].filter(existsSync)
  lines.push(`mcp cfg:    ${mcp.length ? mcp.join(', ') : 'none (.ur/mcp/servers.toml)'}`)
  lines.push(`playwright: ${existsSync(join(cwd, 'node_modules', 'playwright')) ? 'installed' : 'not installed'}`)
  return lines.join('\n')
}
