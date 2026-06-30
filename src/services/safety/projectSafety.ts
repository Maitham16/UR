import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative } from 'node:path'
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
  reasons: string[]
  matchedRules: SafetyPolicyRule[]
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
    { pattern: String.raw`\b(printenv|env)\b.*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)`, reason: 'prints secret-like environment variables' },
    { pattern: String.raw`\becho\b.*\$(\{?[A-Za-z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Za-z0-9_]*\}?)`, reason: 'prints a secret-like environment variable' },
    { pattern: String.raw`\b(cat|less|more|head|tail|grep|rg)\b.*(\.env|id_rsa|id_ed25519|\.npmrc|\.pypirc|credentials|secrets|settings\.local\.json)`, reason: 'reads files that commonly contain secrets into the model-visible transcript' },
    { pattern: String.raw`(\.env|id_rsa|id_ed25519|\.npmrc|\.pypirc|credentials|secrets|settings\.local\.json).*(curl|wget|nc|netcat|scp|ftp|gh\s+gist|gh\s+api|aws\s+s3|gsutil|rclone)`, reason: 'sends likely secret files to a remote sink' },
    { pattern: String.raw`(curl|wget|nc|netcat|scp|ftp|gh\s+gist|gh\s+api|aws\s+s3|gsutil|rclone).*(\.env|id_rsa|id_ed25519|\.npmrc|\.pypirc|credentials|secrets|settings\.local\.json)`, reason: 'sends likely secret files to a remote sink' },
    { pattern: String.raw`\$(\{?[A-Za-z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Za-z0-9_]*\}?).*(curl|wget|nc|netcat|scp|ftp|gh\s+gist|gh\s+api)`, reason: 'sends secret-like environment values to a remote sink' },
    { pattern: String.raw`(curl|wget|nc|netcat|scp|ftp|gh\s+gist|gh\s+api).*\$(\{?[A-Za-z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Za-z0-9_]*\}?)`, reason: 'sends secret-like environment values to a remote sink' },
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

function commandMatchesAny(command: string, prefixes: Iterable<string>): boolean {
  const lower = command.toLowerCase()
  for (const prefix of prefixes) {
    const normalized = prefix.toLowerCase()
    if (lower === normalized || lower.startsWith(`${normalized} `)) return true
  }
  return false
}

function classifyPermissions(command: string, policy: ProjectSafetyPolicy): PermissionClass[] {
  const permissions = new Set<PermissionClass>()
  const lower = command.toLowerCase()
  const prefix = firstCommandPrefix(lower)
  if (commandMatchesAny(prefix, READ_COMMANDS) || commandMatchesAny(lower, READ_COMMANDS)) {
    permissions.add('read')
  }
  if (
    commandMatchesAny(prefix, WRITE_COMMANDS) ||
    /(^|[^>])>{1,2}[^&]|<>\s*|(^|\s)(tee|sed\s+-i)\b/i.test(command)
  ) {
    permissions.add('write')
  }
  if (
    commandMatchesAny(prefix, EXECUTE_COMMANDS) ||
    /\b(bun|npm|pnpm|yarn|cargo|go|make|pytest|jest|vitest|node|python3?)\b/i.test(command)
  ) {
    permissions.add('execute')
  }
  if (commandMatchesAny(lower, policy.networkCommands)) {
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
  input?: { dangerouslyDisableSandbox?: boolean },
): ShellSafetyEvaluation {
  const policy = loadProjectSafetyPolicy(cwd)
  const permissions = classifyPermissions(command, policy)
  const matchedDeny = policy.deny.filter(rule => compileRule(rule)?.test(command))
  const matchedAsk = policy.askBefore.filter(rule => compileRule(rule)?.test(command))
  const sandboxRequired = permissions.some(permission =>
    policy.sandboxRequiredFor.includes(permission),
  )
  const sandbox: SandboxDisposition =
    matchedAsk.length > 0 || input?.dangerouslyDisableSandbox
      ? 'required'
      : sandboxRequired
        ? 'recommended'
        : 'not-needed'
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
    reasons.push('command requests sandbox bypass')
  }
  if (sandbox !== 'not-needed') {
    reasons.push(`sandbox ${sandbox} for ${permissions.join('/')} permission`)
  }
  return {
    command,
    behavior,
    approvalLevel,
    permissions,
    sandbox,
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
    `Sandbox: ${evaluation.sandbox}`,
    'Reasons:',
    ...(evaluation.reasons.length
      ? evaluation.reasons.map(reason => `  - ${reason}`)
      : ['  - no blocking risk detected']),
  ].join('\n')
}
