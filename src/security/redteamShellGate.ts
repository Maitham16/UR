import { SECURITY_TOOLS, toolPolicy } from './policy.ts'
import { getSessionId } from '../bootstrap/state.ts'
import { isRedteamModeActive } from './redteamMode.ts'
import { ScopeStore } from './scope.ts'

export interface RedteamShellVerdict {
  allow: boolean
  reason?: string
}

const ALIASES: Record<string, string> = {
  msfconsole: 'metasploit',
  r2: 'radare2',
}

const TOOL_NAMES = [...SECURITY_TOOLS.map(tool => tool.name), ...Object.keys(ALIASES)]
  .sort((a, b) => b.length - a.length)
  .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|')

const TOOL_INVOCATION = new RegExp(
  `(?:^|[;&|]\\s*|\\b(?:sudo|env|command)\\s+)(?:[A-Za-z_]\\w*=\\S+\\s+)*(?:\\S*[\\\\/])?(${TOOL_NAMES})(?=\\s|$)`,
  'i',
)

const FILE_EXTENSIONS = new Set([
  'conf', 'csv', 'json', 'list', 'log', 'lua', 'md', 'nse', 'out', 'pem',
  'ps1', 'py', 'sh', 'txt', 'xml', 'yaml', 'yml',
])

const recentRuns = new Map<string, number[]>()
const INFORMATIONAL_ONLY = /(?:^|\s)(?:--help|-h|--version|-V)(?:\s|$)/
const LOCAL_CAPTURE_TOOLS = new Set(['tcpdump', 'tshark', 'wireshark', 'kismet'])

function targetHosts(command: string): string[] {
  const hosts = new Set<string>()
  if (/\blocalhost\b/i.test(command)) hosts.add('localhost')
  for (const match of command.matchAll(/https?:\/\/([^\s/:]+)/gi)) {
    if (match[1]) hosts.add(match[1].toLowerCase())
  }
  for (const match of command.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g)) {
    hosts.add(match[0].toLowerCase())
  }
  for (const match of command.matchAll(/\b(?:[a-z0-9-]+\.)+[a-z]{2,63}\b/gi)) {
    const candidate = match[0].toLowerCase()
    const extension = candidate.split('.').at(-1)
    if (!extension || FILE_EXTENSIONS.has(extension)) continue
    hosts.add(candidate)
  }
  return [...hosts]
}

function requestedPorts(command: string): number[] {
  const raw = command.match(/(?:^|\s)(?:-p|--port(?:s)?)\s+([0-9,-]+)/i)?.[1]
  if (!raw) return []
  return raw
    .split(',')
    .filter(value => /^\d+$/.test(value))
    .map(Number)
    .filter(port => port >= 1 && port <= 65535)
}

export function evaluateRedteamShellCommand(
  command: string,
  cwd: string,
): RedteamShellVerdict | null {
  if (!isRedteamModeActive()) return null
  const match = command.match(TOOL_INVOCATION)
  if (!match?.[1]) return null

  const invoked = match[1].toLowerCase()
  const name = ALIASES[invoked] ?? invoked
  const policy = toolPolicy(name)
  if (!policy || policy.classification === 'passive') return { allow: true }

  const store = new ScopeStore(cwd)
  const scope = store.get()
  if (!scope?.approved) {
    return {
      allow: false,
      reason: `${invoked} requires a target scope approved in this UR session; use /scope set ... and /scope approve`,
    }
  }
  if (
    scope.allowedTools.length > 0 &&
    !scope.allowedTools.includes(name) &&
    !scope.allowedTools.includes(invoked)
  ) {
    return { allow: false, reason: `${invoked} is not in the scope's allowedTools list` }
  }
  const hosts = targetHosts(command)
  const localCapture =
    LOCAL_CAPTURE_TOOLS.has(name) &&
    (scope.targetType === 'local-machine' || scope.targetType === 'lab-vm')
  if (
    policy.requiresScope &&
    hosts.length === 0 &&
    !INFORMATIONAL_ONLY.test(command) &&
    !localCapture
  ) {
    return {
      allow: false,
      reason: `${invoked} target could not be resolved; put an explicit scoped host, URL, or IP/CIDR in the command`,
    }
  }
  for (const host of hosts) {
    if (!store.inScope(host)) {
      return { allow: false, reason: `target ${host} is outside the approved UR scope` }
    }
  }
  if (scope.allowedPorts.length > 0) {
    const outsidePort = requestedPorts(command).find(
      port => !scope.allowedPorts.includes(port),
    )
    if (outsidePort !== undefined) {
      return { allow: false, reason: `port ${outsidePort} is outside the approved UR scope` }
    }
  }
  if (
    (name === 'masscan' || /(?:^|\s)-T5(?:\s|$)|--rate\s+[1-9]\d{3,}/i.test(command)) &&
    scope.intensity !== 'aggressive-lab-only'
  ) {
    return {
      allow: false,
      reason: 'high-intensity scanning requires scope intensity aggressive-lab-only',
    }
  }
  const now = Date.now()
  const rateKey = `${String(getSessionId())}:${cwd}:${name}`
  const windowStart = now - 60_000
  const prior = (recentRuns.get(rateKey) ?? []).filter(at => at > windowStart)
  if (prior.length >= scope.rateLimitPerMin) {
    recentRuns.set(rateKey, prior)
    return {
      allow: false,
      reason: `${invoked} exceeds the approved rate limit of ${scope.rateLimitPerMin} command(s) per minute`,
    }
  }
  prior.push(now)
  recentRuns.set(rateKey, prior)
  return { allow: true }
}
