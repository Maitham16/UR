import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'
import { homedir } from 'node:os'
import { safeParseJSON } from '../../utils/json.js'

export type PermissionClass = 'read' | 'write' | 'execute' | 'network'
export type ApprovalLevel =
  | 'read-only'
  | 'edit-project'
  | 'run-safe-commands'
  | 'run-network-commands'
  | 'destructive-commands'
export type SafetyBehavior = 'allow' | 'ask' | 'deny'
export type SandboxDisposition = 'not-needed' | 'recommended' | 'required'
export type SandboxMode = 'disabled' | 'recommended' | 'required'
export type SafetyMode = 'developer' | 'autonomous-safe' | 'explicit-unsafe'

export type SafetyPolicyRule = {
  pattern: string
  reason: string
}

export type ProjectSafetyPolicy = {
  version: 1
  permissionClasses: Record<PermissionClass, string>
  askBefore: SafetyPolicyRule[]
  deny: SafetyPolicyRule[]
  secretFiles: string[]
  secretEnvPatterns: string[]
  networkCommands: string[]
  sandboxRequiredFor: PermissionClass[]
}

export type ShellSafetyEvaluation = {
  command: string
  behavior: SafetyBehavior
  approvalLevel: ApprovalLevel
  permissions: PermissionClass[]
  sandbox: SandboxDisposition
  sandboxMode: SandboxMode
  audit: ShellSafetyAuditMetadata
  reasons: string[]
  matchedRules: SafetyPolicyRule[]
}

export type ShellSafetyAuditMetadata = {
  mode: SafetyMode
  commandCategory: ApprovalLevel
  decision: SafetyBehavior
  sandboxRequired: boolean
  sandboxAvailable: boolean | null
  reason: string
  unsafeBypassUsed: boolean
}

export type ShellSafetyViolation = {
  command: string
  reason: string
  policyDecision: SafetyBehavior
  sandboxMode: SandboxMode
  audit: ShellSafetyAuditMetadata
  timestamp: Date
}

const READ_COMMANDS = new Set([
  'cat',
  'find',
  'git diff',
  'git log',
  'git show',
  'git status',
  'grep',
  'head',
  'jq',
  'less',
  'ls',
  'pwd',
  'rg',
  'sed',
  'tail',
  'tree',
  'wc',
])

const WRITE_COMMANDS = new Set([
  'bun add',
  'cargo add',
  'chmod',
  'chown',
  'cp',
  'git add',
  'git apply',
  'git checkout',
  'git clean',
  'git commit',
  'git mv',
  'git rebase',
  'git reset',
  'git restore',
  'mkdir',
  'mv',
  'npm install',
  'pnpm add',
  'rm',
  'rmdir',
  'touch',
  'truncate',
  'yarn add',
])

const EXECUTE_COMMANDS = new Set([
  'bash',
  'bun',
  'cargo',
  'deno',
  'go',
  'make',
  'node',
  'npm',
  'npx',
  'perl',
  'php',
  'python',
  'python3',
  'ruby',
  'sh',
  'tsx',
  'zsh',
])

export const DEFAULT_PROJECT_SAFETY_POLICY: ProjectSafetyPolicy = {
  version: 1,
  permissionClasses: {
    read: 'Can inspect project files and command output.',
    write: 'Can create, edit, move, or delete files or repository state.',
    execute: 'Can run code, scripts, package managers, build tools, or shells.',
    network: 'Can send data to another process, host, API, or remote service.',
  },
  askBefore: [
    { pattern: String.raw`\b(npm|pnpm|yarn|bun|pip|pip3|python3?\s+-m\s+pip)\s+(install|add)\b`, reason: 'installs packages or changes dependency state' },
    { pattern: String.raw`\b(cargo|go)\s+(install|get)\b`, reason: 'installs packages or downloads executable dependencies' },
    { pattern: String.raw`\brm\s+(-[^\s]*[rf][^\s]*|--recursive|--force)`, reason: 'removes files forcefully or recursively' },
    { pattern: String.raw`\bgit\s+reset\s+--hard\b`, reason: 'discards working tree changes' },
    { pattern: String.raw`\bgit\s+clean\s+-[^\s]*[fd]`, reason: 'deletes untracked files' },
    { pattern: String.raw`\bgit\s+checkout\s+--\s+`, reason: 'restores files from git and can discard edits' },
    { pattern: String.raw`\bgit\s+restore\b`, reason: 'restores files from git and can discard edits' },
    { pattern: String.raw`\bgit\s+push\b.*\s--force`, reason: 'force-pushes remote history' },
    { pattern: String.raw`\bchmod\s+-R\b|\bchown\s+-R\b`, reason: 'recursively changes permissions or ownership' },
    { pattern: String.raw`\bdd\s+`, reason: 'can overwrite raw devices or files' },
    { pattern: String.raw`\bmkfs\b`, reason: 'formats a filesystem' },
    { pattern: String.raw`\bterraform\s+destroy\b`, reason: 'destroys infrastructure' },
    { pattern: String.raw`\bkubectl\s+delete\b`, reason: 'deletes cluster resources' },
  ],
  deny: [
    { pattern: String.raw`\brm\s+(-[^\s]*[rf][^\s]*|--recursive|--force).*(^|\s)/(?:\s|$|\*)`, reason: 'attempts to recursively delete the filesystem root' },
    { pattern: String.raw`\b(printenv|env)\b.*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)`, reason: 'prints secret-like environment variables' },
    { pattern: String.raw`\becho\b.*\$(\{?[A-Za-z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Za-z0-9_]*\}?)`, reason: 'prints a secret-like environment variable' },
    { pattern: String.raw`\b(cat|less|more|head|tail|grep|rg|awk|sed|python3?|perl|ruby|node|bash|sh)\b.*(\.env(?:\.[A-Za-z0-9_-]+)?|id_rsa|id_ed25519|\.npmrc|\.pypirc|credentials|secrets|settings\.local\.json)`, reason: 'reads files that commonly contain secrets into the model-visible transcript' },
    { pattern: String.raw`(\.env(?:\.[A-Za-z0-9_-]+)?|id_rsa|id_ed25519|\.npmrc|\.pypirc|credentials|secrets|settings\.local\.json).*(curl|wget|nc|netcat|scp|ftp|gh\s+gist|gh\s+api|aws\s+s3|gsutil|rclone|python3?|perl|ruby|node|bash|sh)`, reason: 'sends likely secret files to a remote sink' },
    { pattern: String.raw`(curl|wget|nc|netcat|scp|ftp|gh\s+gist|gh\s+api|aws\s+s3|gsutil|rclone|python3?|perl|ruby|node|bash|sh).*(\.env(?:\.[A-Za-z0-9_-]+)?|id_rsa|id_ed25519|\.npmrc|\.pypirc|credentials|secrets|settings\.local\.json)`, reason: 'sends likely secret files to a remote sink' },
    { pattern: String.raw`\$(\{?[A-Za-z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Za-z0-9_]*\}?).*(curl|wget|nc|netcat|scp|ftp|gh\s+gist|gh\s+api|python3?|perl|ruby|node|bash|sh)`, reason: 'sends secret-like environment values to a remote sink' },
    { pattern: String.raw`(curl|wget|nc|netcat|scp|ftp|gh\s+gist|gh\s+api|python3?|perl|ruby|node|bash|sh).*\$(\{?[A-Za-z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Za-z0-9_]*\}?)`, reason: 'sends secret-like environment values to a remote sink' },
  ],
  secretFiles: [
    '.env',
    '.env.local',
    '.npmrc',
    '.pypirc',
    '.ssh/id_rsa',
    '.ssh/id_ed25519',
    '.aws/credentials',
    '.ur/settings.local.json',
  ],
  secretEnvPatterns: ['KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'CREDENTIAL'],
  networkCommands: [
    'curl',
    'wget',
    'nc',
    'netcat',
    'scp',
    'ftp',
    'ssh',
    'gh api',
    'gh gist',
    'aws s3',
    'gsutil',
    'rclone',
  ],
  sandboxRequiredFor: ['write', 'execute', 'network'],
}

const shellSafetyViolations: ShellSafetyViolation[] = []

export function recordShellSafetyViolation(
  evaluation: ShellSafetyEvaluation,
  reason?: string,
): ShellSafetyViolation {
  const violation: ShellSafetyViolation = {
    command: evaluation.command,
    reason: reason ?? (evaluation.reasons.join('; ') || 'blocked by safety policy'),
    policyDecision: evaluation.behavior,
    sandboxMode: evaluation.sandboxMode,
    audit: evaluation.audit,
    timestamp: new Date(),
  }
  shellSafetyViolations.push(violation)
  return violation
}

export function getShellSafetyViolations(): ShellSafetyViolation[] {
  return [...shellSafetyViolations]
}

export function clearShellSafetyViolations(): void {
  shellSafetyViolations.length = 0
}

export function safetyPolicyPath(cwd: string): string {
  return join(cwd, '.ur', 'safety-policy.json')
}

function compileRule(rule: SafetyPolicyRule): RegExp | null {
  try {
    return new RegExp(rule.pattern, 'i')
  } catch {
    return null
  }
}

function mergeRules(
  base: SafetyPolicyRule[],
  extra: unknown,
): SafetyPolicyRule[] {
  if (!Array.isArray(extra)) return base
  const parsed = extra.filter(
    (rule): rule is SafetyPolicyRule =>
      rule &&
      typeof rule === 'object' &&
      typeof (rule as SafetyPolicyRule).pattern === 'string' &&
      typeof (rule as SafetyPolicyRule).reason === 'string',
  )
  return [...base, ...parsed]
}

export function loadProjectSafetyPolicy(cwd: string): ProjectSafetyPolicy {
  const path = safetyPolicyPath(cwd)
  if (!existsSync(path)) return DEFAULT_PROJECT_SAFETY_POLICY
  const parsed = safeParseJSON(readFileSync(path, 'utf8'), false) as
    | Partial<ProjectSafetyPolicy>
    | null
  if (!parsed || typeof parsed !== 'object') return DEFAULT_PROJECT_SAFETY_POLICY
  return {
    ...DEFAULT_PROJECT_SAFETY_POLICY,
    ...parsed,
    version: 1,
    permissionClasses: {
      ...DEFAULT_PROJECT_SAFETY_POLICY.permissionClasses,
      ...(parsed.permissionClasses ?? {}),
    },
    askBefore: mergeRules(DEFAULT_PROJECT_SAFETY_POLICY.askBefore, parsed.askBefore),
    deny: mergeRules(DEFAULT_PROJECT_SAFETY_POLICY.deny, parsed.deny),
    secretFiles: [
      ...DEFAULT_PROJECT_SAFETY_POLICY.secretFiles,
      ...(Array.isArray(parsed.secretFiles)
        ? parsed.secretFiles.filter((v): v is string => typeof v === 'string')
        : []),
    ],
    secretEnvPatterns: [
      ...DEFAULT_PROJECT_SAFETY_POLICY.secretEnvPatterns,
      ...(Array.isArray(parsed.secretEnvPatterns)
        ? parsed.secretEnvPatterns.filter((v): v is string => typeof v === 'string')
        : []),
    ],
    networkCommands: [
      ...DEFAULT_PROJECT_SAFETY_POLICY.networkCommands,
      ...(Array.isArray(parsed.networkCommands)
        ? parsed.networkCommands.filter((v): v is string => typeof v === 'string')
        : []),
    ],
    sandboxRequiredFor: Array.isArray(parsed.sandboxRequiredFor)
      ? parsed.sandboxRequiredFor.filter((v): v is PermissionClass =>
          ['read', 'write', 'execute', 'network'].includes(String(v)),
        )
      : DEFAULT_PROJECT_SAFETY_POLICY.sandboxRequiredFor,
  }
}

export function writeProjectSafetyPolicy(cwd: string): string {
  const path = safetyPolicyPath(cwd)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(DEFAULT_PROJECT_SAFETY_POLICY, null, 2)}\n`)
  return relative(cwd, path)
}

function firstCommandPrefix(command: string): string {
  const clean = command.trim().replace(/^\w+=\S+\s+/, '')
  const match = clean.match(/^([A-Za-z0-9_.-]+)(?:\s+([A-Za-z0-9_.-]+))?/)
  if (!match) return ''
  const first = match[1] ?? ''
  const second = match[2] ?? ''
  return second ? `${first} ${second}` : first
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function commandMatchesPrefix(command: string, prefix: string): boolean {
  const lower = command.toLowerCase()
  const normalized = prefix.trim().toLowerCase()
  if (!normalized) return false
  if (lower === normalized || lower.startsWith(`${normalized} `)) return true
  const pattern = normalized
    .split(/\s+/)
    .map(escapeRegExp)
    .join(String.raw`\s+`)
  return new RegExp(String.raw`(?:^|[\s;&|()])${pattern}(?:$|[\s;&|()])`, 'i').test(
    command,
  )
}

function commandMatchesAny(command: string, prefixes: Iterable<string>): boolean {
  for (const prefix of prefixes) {
    if (commandMatchesPrefix(command, prefix)) return true
  }
  return false
}

function shellTokens(command: string): string[] {
  const matches = command.match(/"([^"\\]|\\.)*"|'[^']*'|[^\s;&|]+/g) ?? []
  return matches.map(token => {
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      return token.slice(1, -1)
    }
    return token
  })
}

function commandSegments(command: string): string[] {
  return command
    .split(/\s*(?:&&|\|\||[;|\n])\s*/)
    .map(segment => segment.trim())
    .filter(Boolean)
}

function isFlag(token: string): boolean {
  return token.startsWith('-') && token !== '-'
}

function candidatePathFromToken(token: string): string | null {
  const trimmed = token.trim().replace(/^[<>=]+/, '')
  if (!trimmed || isFlag(trimmed)) return null
  if (/[$`{}[\]*?]/.test(trimmed)) return null
  return trimmed
}

function extractWritePathCandidates(command: string): string[] {
  const candidates: string[] = []
  const redirectPattern = /(?:^|\s)(?:>{1,2}|<>)\s*(['"]?)([^'";&|]+)\1/g
  for (const match of command.matchAll(redirectPattern)) {
    const token = candidatePathFromToken(match[2] ?? '')
    if (token) candidates.push(token)
  }

  for (const segment of commandSegments(command)) {
    const tokens = shellTokens(segment)
    const [cmd, subcmd] = tokens
    if (!cmd) continue
    const commandName = subcmd ? `${cmd} ${subcmd}` : cmd

    if (['touch', 'mkdir', 'rm', 'rmdir', 'truncate', 'tee'].includes(cmd)) {
      for (const token of tokens.slice(1)) {
        const candidate = candidatePathFromToken(token)
        if (candidate) candidates.push(candidate)
      }
      continue
    }

    if (['cp', 'mv'].includes(cmd)) {
      const nonFlags = tokens.slice(1).filter(token => !isFlag(token))
      const candidate = candidatePathFromToken(nonFlags.at(-1) ?? '')
      if (candidate) candidates.push(candidate)
      continue
    }

    if (commandName === 'git clean') {
      candidates.push('.')
    }
  }

  return candidates
}

function resolveHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  return path
}

function resolveExistingPathOrParent(path: string): string {
  let current = path
  const missing: string[] = []
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) return path
    missing.unshift(basename(current))
    current = parent
  }
  try {
    return join(realpathSync(current), ...missing)
  } catch {
    return path
  }
}

function resolveWorkspacePath(candidate: string, cwd: string): string {
  const expanded = resolveHomePath(candidate)
  const absolute = isAbsolute(expanded) ? expanded : resolve(cwd, expanded)
  return resolveExistingPathOrParent(absolute)
}

function pathIsInsideWorkspace(path: string, cwd: string): boolean {
  const realCwd = resolveExistingPathOrParent(cwd)
  const rel = relative(realCwd, path)
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel))
}

function detectWorkspaceWriteEscape(
  command: string,
  cwd: string,
): SafetyPolicyRule[] {
  const rules: SafetyPolicyRule[] = []
  for (const candidate of extractWritePathCandidates(command)) {
    const resolved = resolveWorkspacePath(candidate, cwd)
    if (!pathIsInsideWorkspace(resolved, cwd)) {
      rules.push({
        pattern: candidate,
        reason: `writes outside the workspace boundary: ${candidate}`,
      })
    }
  }
  return rules
}

function classifyPermissions(command: string, policy: ProjectSafetyPolicy): PermissionClass[] {
  const permissions = new Set<PermissionClass>()
  const lower = command.toLowerCase()
  const prefix = firstCommandPrefix(lower)
  if (commandMatchesAny(prefix, READ_COMMANDS) || commandMatchesAny(command, READ_COMMANDS)) {
    permissions.add('read')
  }
  if (
    commandMatchesAny(prefix, WRITE_COMMANDS) ||
    commandMatchesAny(command, WRITE_COMMANDS) ||
    /(^|[^>])>{1,2}[^&]|<>\s*|(^|\s)(tee|sed\s+-i)\b/i.test(command)
  ) {
    permissions.add('write')
  }
  if (
    commandMatchesAny(prefix, EXECUTE_COMMANDS) ||
    commandMatchesAny(command, EXECUTE_COMMANDS) ||
    /\b(bun|npm|pnpm|yarn|cargo|go|make|pytest|jest|vitest|node|python3?)\b/i.test(command)
  ) {
    permissions.add('execute')
  }
  if (commandMatchesAny(command, policy.networkCommands)) {
    permissions.add('network')
  }
  if (permissions.size === 0) permissions.add('execute')
  return [...permissions]
}

export function approvalLevelForEvaluation(
  permissions: PermissionClass[],
  matchedAsk: SafetyPolicyRule[] = [],
): ApprovalLevel {
  if (matchedAsk.length > 0) return 'destructive-commands'
  if (permissions.includes('network')) return 'run-network-commands'
  if (permissions.includes('execute')) return 'run-safe-commands'
  if (permissions.includes('write')) return 'edit-project'
  return 'read-only'
}

export function formatApprovalLevel(level: ApprovalLevel): string {
  switch (level) {
    case 'read-only':
      return 'read-only'
    case 'edit-project':
      return 'edit project'
    case 'run-safe-commands':
      return 'run safe commands'
    case 'run-network-commands':
      return 'run network commands'
    case 'destructive-commands':
      return 'destructive commands'
  }
}

export function evaluateShellSafetyPolicy(
  command: string,
  cwd: string,
  input?: {
    dangerouslyDisableSandbox?: boolean
    autonomousMode?: boolean
    unsafeMode?: boolean
    sandboxAvailable?: boolean
  },
): ShellSafetyEvaluation {
  const policy = loadProjectSafetyPolicy(cwd)
  const permissions = classifyPermissions(command, policy)
  const matchedDeny = [
    ...policy.deny.filter(rule => compileRule(rule)?.test(command)),
    ...detectWorkspaceWriteEscape(command, cwd),
  ]
  const matchedAsk = policy.askBefore.filter(rule => compileRule(rule)?.test(command))
  const sandboxRequired = permissions.some(permission =>
    policy.sandboxRequiredFor.includes(permission),
  )
  const sandboxBypassAllowed =
    input?.dangerouslyDisableSandbox === true && input?.unsafeMode === true
  const mode: SafetyMode = sandboxBypassAllowed
    ? 'explicit-unsafe'
    : input?.autonomousMode === true
      ? 'autonomous-safe'
      : 'developer'
  const autonomousSandboxRequired =
    input?.autonomousMode === true && sandboxRequired && !sandboxBypassAllowed
  const requiresStrictSandbox =
    matchedDeny.length > 0 ||
    matchedAsk.length > 0 ||
    (input?.dangerouslyDisableSandbox === true && !sandboxBypassAllowed) ||
    permissions.includes('network') ||
    autonomousSandboxRequired
  const sandboxMode: SandboxMode = requiresStrictSandbox
    ? 'required'
    : sandboxRequired
      ? 'recommended'
      : 'disabled'
  const sandbox: SandboxDisposition =
    sandboxMode === 'disabled'
      ? 'not-needed'
      : sandboxMode === 'required'
      ? 'required'
      : 'recommended'
  const behavior: SafetyBehavior =
    matchedDeny.length > 0
      ? 'deny'
      : matchedAsk.length > 0 || input?.dangerouslyDisableSandbox
        ? 'ask'
        : 'allow'
  const approvalLevel = approvalLevelForEvaluation(permissions, matchedAsk)
  const reasons = [
    ...matchedDeny.map(rule => rule.reason),
    ...matchedAsk.map(rule => rule.reason),
  ]
  if (input?.dangerouslyDisableSandbox) {
    reasons.push(
      sandboxBypassAllowed
        ? 'command requests explicitly allowed sandbox bypass'
        : 'command requests sandbox bypass',
    )
  }
  if (permissions.includes('network')) {
    reasons.push('network access requires sandbox network isolation')
  }
  if (autonomousSandboxRequired) {
    reasons.push(
      `autonomous mode requires sandbox for ${permissions.join('/')} permission`,
    )
  }
  if (sandboxMode !== 'disabled') {
    reasons.push(`sandbox ${sandboxMode} for ${permissions.join('/')} permission`)
  }
  const reason = reasons.join('; ') || 'no blocking risk detected'
  const audit: ShellSafetyAuditMetadata = {
    mode,
    commandCategory: approvalLevel,
    decision: behavior,
    sandboxRequired: sandboxMode === 'required',
    sandboxAvailable: input?.sandboxAvailable ?? null,
    reason,
    unsafeBypassUsed: sandboxBypassAllowed,
  }
  return {
    command,
    behavior,
    approvalLevel,
    permissions,
    sandbox,
    sandboxMode,
    audit,
    reasons,
    matchedRules: [...matchedDeny, ...matchedAsk],
  }
}

export function formatShellSafetyEvaluation(
  evaluation: ShellSafetyEvaluation,
  json = false,
): string {
  if (json) return JSON.stringify(evaluation, null, 2)
  return [
    `Safety decision: ${evaluation.behavior}`,
    `Approval level: ${formatApprovalLevel(evaluation.approvalLevel)}`,
    `Permissions: ${evaluation.permissions.join(', ')}`,
    `Sandbox: ${evaluation.sandboxMode}`,
    `Safety mode: ${evaluation.audit.mode}`,
    `Audit: category=${formatApprovalLevel(evaluation.audit.commandCategory)}, sandboxRequired=${String(evaluation.audit.sandboxRequired)}, sandboxAvailable=${evaluation.audit.sandboxAvailable === null ? 'unknown' : String(evaluation.audit.sandboxAvailable)}, unsafeBypass=${String(evaluation.audit.unsafeBypassUsed)}`,
    'Reasons:',
    ...(evaluation.reasons.length
      ? evaluation.reasons.map(reason => `  - ${reason}`)
      : ['  - no blocking risk detected']),
  ].join('\n')
}
