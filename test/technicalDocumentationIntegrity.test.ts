import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const TECHNICAL = join(ROOT, 'technical')

describe('technical documentation integrity', () => {
  test('every exact source-file reference resolves', () => {
    const missing: string[] = []
    for (const file of readdirSync(TECHNICAL).filter(name =>
      name.endsWith('.md'),
    )) {
      const source = readFileSync(join(TECHNICAL, file), 'utf8')
      for (const match of source.matchAll(
        /`(src\/[A-Za-z0-9_@./-]+\.(?:ts|tsx|js|mjs|json|toml))(?::[^`]*)?`/g,
      )) {
        const path = match[1]!
        if (!existsSync(join(ROOT, path))) missing.push(`${file}: ${path}`)
      }
    }
    expect(missing).toEqual([])
  })

  test('unsupported environment names are labelled as nonfunctional', () => {
    const config = readFileSync(
      join(TECHNICAL, '06-configuration.md'),
      'utf8',
    )
    for (const name of [
      'UR_CODE_REPL',
      'UR_CODE_VERIFY_PLAN',
      'UR_CODE_USE_BEDROCK',
      'UR_CODE_USE_VERTEX',
      'UR_CODE_DISABLE_CRON',
      'UR_CODE_COORDINATOR_MODE',
      'UR_CODE_ABLATION_BASELINE',
    ]) {
      expect(config).toContain(`\`${name}\``)
    }
    expect(config).toContain('do not enable their named backend/tool/mode')
    expect(config).not.toContain('OLLAMA_REQUEST_TIMEOUT_MS')
    expect(config).not.toContain('UR_CODE_PRESET_PREFIX')
  })

  test('default build gates and documented runtime availability stay aligned', () => {
    const bundle = readFileSync(join(ROOT, 'scripts', 'bundle.mjs'), 'utf8')
    const architecture = readFileSync(
      join(TECHNICAL, '01-architecture.md'),
      'utf8',
    )
    const tools = readFileSync(join(TECHNICAL, '04-tools.md'), 'utf8')
    const webSearch = readFileSync(
      join(ROOT, 'src', 'tools', 'WebSearchTool', 'WebSearchTool.ts'),
      'utf8',
    )

    expect(bundle).toContain("'--feature=VOICE_MODE'")
    for (const gate of [
      'AGENT_TRIGGERS',
      'COORDINATOR_MODE',
      'ABLATION_BASELINE',
    ]) {
      expect(bundle).not.toContain(`'--feature=${gate}'`)
    }
    expect(architecture).toContain(
      'The standard npm bundle is compiled\n  with `VOICE_MODE`',
    )
    expect(webSearch).toContain("provider === 'foundry'")
    expect(tools).toContain('hides it on the default Ollama backend')
  })

  test('configuration documents every built-in output style', () => {
    const source = readFileSync(
      join(ROOT, 'src', 'constants', 'outputStyles.ts'),
      'utf8',
    )
    const config = readFileSync(
      join(TECHNICAL, '06-configuration.md'),
      'utf8',
    )
    const styles = [
      ...source.matchAll(/^\s+name: '([^']+)',\s*$/gm),
    ].map(match => match[1]!)

    expect(styles.length).toBeGreaterThan(0)
    for (const style of styles) expect(config).toContain(style)
  })

  test('CLI reference covers every freshly built root-help command', () => {
    const help = execFileSync('node', ['bin/ur.js', '--help'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    const rows = (help.split('\nCommands:\n')[1] ?? '')
      .split('\n')
      .filter(line => /^  \S/.test(line))
    const commands = rows.map(
      line => line.trim().split(/\s+/)[0]!.split('|')[0]!,
    )
    const reference = readFileSync(
      join(TECHNICAL, '02-cli-reference.md'),
      'utf8',
    )
    const readme = readFileSync(join(TECHNICAL, 'README.md'), 'utf8')

    expect(commands.length).toBeGreaterThan(0)
    for (const command of commands) {
      expect(reference).toContain(`ur ${command}`)
    }
    expect(readme).toContain(`${commands.length} rows in \`ur --help\``)
  })

  test('sandbox exclusion documentation preserves fail-safe compound-call semantics', () => {
    const security = readFileSync(
      join(TECHNICAL, '12-security-sandbox-stability.md'),
      'utf8',
    )

    expect(security).toContain('/sandbox exclude "<pattern>"')
    expect(security).toContain('project-local `.ur/settings.local.json`')
    expect(security).toContain(
      'only when **every**\n  non-empty executable subcommand matches',
    )
    expect(security).toContain(
      'exclusion does not itself grant tool permission',
    )
  })

  test('integration and recovery chapters do not advertise source-only aliases', () => {
    const integrations = readFileSync(
      join(TECHNICAL, '11-integrations.md'),
      'utf8',
    )
    const sessions = readFileSync(
      join(TECHNICAL, '14-sessions.md'),
      'utf8',
    )
    expect(integrations).toContain('/browser <url|task>` is a **shipped advisory command**')
    expect(integrations).toContain('It does **not** use ACP stdio.')
    expect(integrations).toContain('Direct-connect session server | Source-only')
    expect(sessions).toContain('The supported external command family is `ur bg`')
    expect(sessions).not.toContain('ur --bg -p')
    expect(sessions).toContain('/export session.md` writes `session.md`')
    expect(sessions).toContain(
      'A missing suffix or any other suffix is normalized to',
    )
  })

  test('security and research chapters label helpers that are not runtime enforcement', () => {
    const security = readFileSync(
      join(TECHNICAL, '12-security-sandbox-stability.md'),
      'utf8',
    )
    const research = readFileSync(
      join(TECHNICAL, '13-research.md'),
      'utf8',
    )
    expect(security).toContain('`init` writes `.ur/safety-policy.json`')
    expect(security).toContain('/sandbox exclude "<pattern>"')
    expect(security).toContain(
      'project-local `.ur/settings.local.json`',
    )
    expect(security).toContain(
      'exclusion does not itself grant tool permission',
    )
    expect(security).toContain('not installed in the main query/tool loop')
    expect(security).toContain('does **not** fetch URLs, open files')
    expect(research).toContain('not an edge-traversable graph database')
    expect(research).toContain('It does **not** execute a conversion')
    expect(research).toContain('ignores the optional task text')
    expect(research).toContain('`.ur/mcp/servers.toml` paths')
  })

  test('memory and orchestration chapters distinguish compile-time from runtime gates', () => {
    const bundle = readFileSync(join(ROOT, 'scripts', 'bundle.mjs'), 'utf8')
    const memory = readFileSync(
      join(TECHNICAL, '07-memory-and-context.md'),
      'utf8',
    )
    const multiAgent = readFileSync(
      join(TECHNICAL, '09-multi-agent.md'),
      'utf8',
    )
    const automation = readFileSync(
      join(TECHNICAL, '10-headless-automation-eval.md'),
      'utf8',
    )

    for (const gate of [
      'EXTRACT_MEMORIES',
      'TEAMMEM',
      'CONTEXT_COLLAPSE',
      'COORDINATOR_MODE',
      'UDS_INBOX',
      'AGENT_TRIGGERS',
      'AGENT_TRIGGERS_REMOTE',
      'DIRECT_CONNECT',
    ]) {
      expect(bundle).not.toContain(`'--feature=${gate}'`)
    }
    expect(memory).toContain(
      'setting an environment variable alone cannot enable',
    )
    expect(memory).toContain('`ENABLE_UR_CODE_SM_COMPACT=1`')
    expect(memory).toContain('`DISABLE_UR_CODE_SM_COMPACT=1`')
    expect(multiAgent).toContain(
      'do **not** register in this `Agent`-tool governor',
    )
    expect(multiAgent).toContain(
      '`UR_CODE_EXPERIMENTAL_AGENT_TEAMS=1`',
    )
    expect(multiAgent).toContain(
      'A dependent crew task receives its\nprerequisite',
    )
    expect(automation).toContain(
      'Neither feature is compiled into the standard npm\nbundle',
    )
    expect(automation).toContain(
      '`DIRECT_CONNECT` feature and is absent from the standard npm bundle',
    )
  })

  test('programmatic documentation matches the published subprocess SDK', () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, 'package.json'), 'utf8'),
    ) as {
      exports?: {
        './sdk'?: {
          types?: string
          import?: string
          require?: string
          default?: string
        }
      }
    }
    const sdk = pkg.exports?.['./sdk']
    expect(sdk).toEqual({
      types: './dist/sdk/index.d.ts',
      import: './dist/sdk/index.js',
      require: './dist/sdk/index.cjs',
      default: './dist/sdk/index.js',
    })
    for (const path of [sdk?.types, sdk?.import, sdk?.require, sdk?.default]) {
      expect(typeof path).toBe('string')
      expect(existsSync(join(ROOT, path!))).toBe(true)
    }

    const automation = readFileSync(
      join(TECHNICAL, '10-headless-automation-eval.md'),
      'utf8',
    )
    const sdkSource = readFileSync(join(ROOT, 'src', 'sdk', 'index.ts'), 'utf8')
    expect(automation).toContain('**subprocess wrapper**')
    expect(automation).toContain('it does not expose an event iterator')
    expect(automation).toContain(
      '`queryJSON` returns `null` on a nonzero child result',
    )
    expect(sdkSource).not.toContain('in-process scripting')
  })
})
