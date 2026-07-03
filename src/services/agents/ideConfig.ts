/**
 * IDE integration config generation, status, and doctor — pure and testable.
 * Integration model per target is stated honestly: native UR extension/plugin,
 * stdio Agent Client Protocol (ACP), or manual setup. Nothing is faked.
 */

export type IdeIntegrationKind = 'native-extension' | 'stdio-acp' | 'manual'

export type IdeTargetId =
  | 'vscode'
  | 'cursor'
  | 'windsurf'
  | 'zed'
  | 'jetbrains'
  | 'neovim'
  | 'generic-acp'

export type IdeTarget = {
  id: IdeTargetId
  label: string
  kind: IdeIntegrationKind
}

export const IDE_TARGETS: IdeTarget[] = [
  { id: 'vscode', label: 'VS Code', kind: 'native-extension' },
  { id: 'cursor', label: 'Cursor', kind: 'native-extension' },
  { id: 'windsurf', label: 'Windsurf', kind: 'native-extension' },
  { id: 'zed', label: 'Zed', kind: 'stdio-acp' },
  { id: 'jetbrains', label: 'JetBrains IDEs', kind: 'manual' },
  { id: 'neovim', label: 'Neovim', kind: 'stdio-acp' },
  { id: 'generic-acp', label: 'Generic ACP client', kind: 'stdio-acp' },
]

export type IdeConfigFile = { path: string; language: string; content: string }

export type IdeConfigResult = {
  target: IdeTargetId
  label: string
  kind: IdeIntegrationKind
  summary: string
  steps: string[]
  files: IdeConfigFile[]
  limitations: string[]
}

export function resolveIdeTarget(value: string): IdeTarget | null {
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, '-')
  const aliases: Record<string, IdeTargetId> = {
    vscode: 'vscode',
    'vs-code': 'vscode',
    code: 'vscode',
    cursor: 'cursor',
    windsurf: 'windsurf',
    zed: 'zed',
    jetbrains: 'jetbrains',
    intellij: 'jetbrains',
    idea: 'jetbrains',
    pycharm: 'jetbrains',
    webstorm: 'jetbrains',
    goland: 'jetbrains',
    neovim: 'neovim',
    nvim: 'neovim',
    vim: 'neovim',
    generic: 'generic-acp',
    'generic-acp': 'generic-acp',
    acp: 'generic-acp',
  }
  const id = aliases[normalized]
  return id ? IDE_TARGETS.find(t => t.id === id) ?? null : null
}

function zedSettings(command: string): string {
  return JSON.stringify(
    { agent_servers: { UR: { command, args: ['acp', 'stdio'] } } },
    null,
    2,
  )
}

function neovimSnippet(command: string): string {
  return [
    '-- Requires an ACP-capable Neovim client (e.g. a plugin that speaks the',
    '-- Agent Client Protocol over stdio). Point it at the UR ACP agent:',
    'require("acp").setup({',
    '  servers = {',
    `    ur = { command = "${command}", args = { "acp", "stdio" } },`,
    '  },',
    '})',
  ].join('\n')
}

export function generateIdeConfig(
  target: IdeTargetId,
  options: { command?: string } = {},
): IdeConfigResult {
  const command = options.command ?? 'ur'
  const meta = IDE_TARGETS.find(t => t.id === target)!

  switch (target) {
    case 'zed':
      return {
        target,
        label: meta.label,
        kind: meta.kind,
        summary: 'Zed connects to UR as an external agent over the stdio Agent Client Protocol.',
        steps: [
          'Add the agent server block below to your Zed settings.json.',
          'Restart Zed or reload settings.',
          'Open the Agent panel and select "UR".',
        ],
        files: [{ path: '.zed/settings.json', language: 'json', content: zedSettings(command) }],
        limitations: [
          'Streaming is emitted as agent_message_chunk updates; token-level streaming depends on the active provider.',
        ],
      }
    case 'neovim':
      return {
        target,
        label: meta.label,
        kind: meta.kind,
        summary: 'Neovim connects to UR over stdio ACP through an ACP-capable client plugin.',
        steps: [
          'Install a Neovim plugin that speaks ACP over stdio.',
          'Register the UR agent using the snippet below.',
          'Open the agent UI provided by that plugin.',
        ],
        files: [{ path: 'ur-acp.lua', language: 'lua', content: neovimSnippet(command) }],
        limitations: [
          'UR does not ship a Neovim plugin; a third-party ACP client is required.',
        ],
      }
    case 'generic-acp':
      return {
        target,
        label: meta.label,
        kind: meta.kind,
        summary: 'Any ACP-compatible client can launch UR as a stdio agent, or use the HTTP JSON-RPC server.',
        steps: [
          `Stdio ACP agent: run \`${command} acp stdio\` and speak JSON-RPC (initialize, session/new, session/prompt, session/cancel).`,
          `HTTP JSON-RPC: run \`${command} acp serve --host 127.0.0.1 --port 8123\` and POST to /acp.`,
        ],
        files: [
          {
            path: 'ur-acp.json',
            language: 'json',
            content: JSON.stringify(
              { stdio: { command, args: ['acp', 'stdio'] }, http: { url: 'http://127.0.0.1:8123/acp' } },
              null,
              2,
            ),
          },
        ],
        limitations: [
          'The HTTP server is JSON-RPC over HTTP, not Zed-style stdio ACP; use the stdio agent for native ACP editors.',
        ],
      }
    case 'jetbrains':
      return {
        target,
        label: meta.label,
        kind: meta.kind,
        summary: 'JetBrains IDEs integrate through the UR JetBrains plugin (manual install).',
        steps: [
          'Install the UR plugin for your JetBrains IDE.',
          'Restart the IDE.',
          'Run `/ide` inside a UR session to connect to the running IDE.',
        ],
        files: [],
        limitations: [
          'No auto-generated config file; the plugin must be installed manually.',
          'Inline apply/reject requires the JetBrains plugin.',
        ],
      }
    default: {
      // VS Code family: native UR extension + IDE-as-MCP connect via /ide.
      return {
        target,
        label: meta.label,
        kind: meta.kind,
        summary: `${meta.label} integrates through the UR extension and the /ide connect flow.`,
        steps: [
          `Install the UR extension in ${meta.label} (\`${command} ide install\` offers the bundled VSIX).`,
          `Run \`${command}\` in your project, then \`/ide\` to connect to the running editor.`,
          'Use the UR Inline Diffs view to preview, apply, or reject proposed patches.',
        ],
        files: [
          {
            path: '.vscode/settings.json',
            language: 'json',
            content: JSON.stringify({ 'ur.inlineDiffs.enabled': true }, null, 2),
          },
        ],
        limitations: [
          'Apply/reject and context sharing require the UR extension to be installed and the editor running.',
        ],
      }
    }
  }
}

export function formatIdeConfig(result: IdeConfigResult, json = false): string {
  if (json) return JSON.stringify(result, null, 2)
  const lines = [
    `${result.label} — ${result.kind}`,
    result.summary,
    '',
    'Steps:',
    ...result.steps.map((s, i) => `  ${i + 1}. ${s}`),
  ]
  for (const file of result.files) {
    lines.push('', `${file.path}:`, '```' + file.language, file.content, '```')
  }
  if (result.limitations.length > 0) {
    lines.push('', 'Limitations:', ...result.limitations.map(l => `  - ${l}`))
  }
  return lines.join('\n')
}

export type IdeStatus = {
  workspaceRoot: string
  acp: { running: boolean; port: number | null; host: string }
  provider: { label: string; model?: string; runtimeBackend: string; authLabel: string; ready: boolean }
  pluginCount: number
  detectedIdes: Array<{ name: string; connected: boolean }>
  warnings: string[]
  /** 'disabled' | 'recommended' | 'required'. Optional so old JSON consumers
   * parsing a status snapshot from before this field existed still work —
   * this is purely additive to the --json shape, never a breaking change. */
  sandboxMode?: 'disabled' | 'recommended' | 'required'
  /** 'off' | 'loose' | 'strict'. Same additive-only contract as sandboxMode. */
  verifierMode?: 'off' | 'loose' | 'strict'
}

export function formatIdeStatus(status: IdeStatus, json = false): string {
  if (json) return JSON.stringify(status, null, 2)
  const ide =
    status.detectedIdes.length > 0
      ? status.detectedIdes.map(i => `${i.name}${i.connected ? ' (connected)' : ''}`).join(', ')
      : 'none detected'
  const lines = [
    `Workspace: ${status.workspaceRoot}`,
    `ACP server: ${status.acp.running ? `running on ${status.acp.host}:${status.acp.port}` : 'not running'}`,
    `Provider: ${status.provider.label} (${status.provider.authLabel})`,
    `Model: ${status.provider.model ?? '(none selected)'}`,
    `Runtime backend: ${status.provider.runtimeBackend}`,
    `Plugins loaded: ${status.pluginCount}`,
    `Detected IDEs: ${ide}`,
  ]
  if (status.sandboxMode) lines.push(`Sandbox mode: ${status.sandboxMode}`)
  if (status.verifierMode) lines.push(`Verifier mode: ${status.verifierMode}`)
  if (status.warnings.length > 0) {
    lines.push('Warnings:', ...status.warnings.map(w => `  - ${w}`))
  }
  return lines.join('\n')
}

export type IdeDoctorCheck = { name: string; status: 'pass' | 'warn' | 'fail'; message: string }

export function ideDoctorChecks(status: IdeStatus): IdeDoctorCheck[] {
  const checks: IdeDoctorCheck[] = []
  checks.push(
    status.workspaceRoot
      ? { name: 'workspace', status: 'pass', message: `Workspace root: ${status.workspaceRoot}` }
      : { name: 'workspace', status: 'fail', message: 'No workspace root detected. Run inside a project directory.' },
  )
  checks.push(
    status.acp.running
      ? { name: 'acp', status: 'pass', message: `ACP server running on ${status.acp.host}:${status.acp.port}` }
      : { name: 'acp', status: 'warn', message: 'ACP server not running. Start it with: ur acp serve (HTTP) or ur acp stdio (ACP editors).' },
  )
  checks.push(
    status.provider.ready
      ? { name: 'provider', status: 'pass', message: `${status.provider.label} ready with model ${status.provider.model ?? '(none)'}` }
      : { name: 'provider', status: 'warn', message: `${status.provider.label} not ready. Run: ur provider doctor` },
  )
  checks.push(
    status.detectedIdes.length > 0
      ? { name: 'ide', status: 'pass', message: `Detected: ${status.detectedIdes.map(i => i.name).join(', ')}` }
      : { name: 'ide', status: 'warn', message: 'No running IDE with the UR extension detected. Run: ur ide config <editor>.' },
  )
  for (const warning of status.warnings) {
    checks.push({ name: 'warning', status: 'warn', message: warning })
  }
  return checks
}

export function formatIdeDoctor(status: IdeStatus, json = false): string {
  const checks = ideDoctorChecks(status)
  if (json) return JSON.stringify({ ok: checks.every(c => c.status !== 'fail'), checks }, null, 2)
  const ok = checks.every(c => c.status !== 'fail')
  return [
    `IDE doctor: ${ok ? 'ready' : 'not ready'}`,
    ...checks.map(c => `  ${c.status.toUpperCase()} ${c.name}: ${c.message}`),
  ].join('\n')
}
