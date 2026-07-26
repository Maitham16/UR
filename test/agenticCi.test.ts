import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildAgenticCiVerificationEnvironment,
  buildSafeAgentEnvironment,
  compileAgenticCiWorkflow,
  decideAgenticCiEvent,
  defaultAgenticCiSpec,
  parseAgenticCiSpec,
  runAgenticCi,
} from '../src/services/agents/agenticCi.ts'
import {
  CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT,
  PR_BODY,
  WORKFLOW_CONTENT,
} from '../src/constants/github-app.ts'
import { execFileNoThrowWithCwd } from '../src/utils/execFileNoThrow.ts'
import { subprocessEnv } from '../src/utils/subprocessEnv.ts'

async function git(cwd: string, args: string[]): Promise<void> {
  const result = await execFileNoThrowWithCwd('git', args, {
    cwd,
    preserveOutputOnError: true,
  })
  if (result.code !== 0) throw new Error(result.stderr || result.error)
}

test('Agentic CI validates actor association and treats event text as data', () => {
  const spec = defaultAgenticCiSpec()
  const denied = decideAgenticCiEvent(
    spec,
    {
      action: 'created',
      comment: {
        author_association: 'CONTRIBUTOR',
        body: '/ur fix it',
        user: { login: 'outside' },
      },
    },
    'issue_comment',
  )
  expect(denied.accepted).toBe(false)

  const irrelevant = decideAgenticCiEvent(
    spec,
    {
      action: 'created',
      comment: {
        author_association: 'OWNER',
        body: 'thanks for the update',
        user: { login: 'maintainer' },
      },
    },
    'issue_comment',
  )
  expect(irrelevant.accepted).toBe(false)
  expect(irrelevant.reason).toContain('/ur')

  const accepted = decideAgenticCiEvent(
    spec,
    {
      action: 'created',
      comment: {
        author_association: 'MEMBER',
        body: '/ur $(touch /tmp/not-shell) safely',
        user: { login: 'maintainer' },
      },
    },
    'issue_comment',
  )
  expect(accepted.accepted).toBe(true)
  expect(accepted.prompt).toContain('$(touch')
})

test('compiled workflow is read-only, pinned, and never embeds event text', () => {
  const workflow = compileAgenticCiWorkflow('default', {
    packageVersion: '1.48.0',
  })
  expect(workflow).not.toContain('${{ github.event.comment.body }}')
  expect(workflow).toContain(
    "contains(github.event.comment.body, '/ur')",
  )
  expect(workflow).not.toMatch(/uses:\s+\S+@v\d/)
  expect(workflow).not.toMatch(/\b(?:contents|issues|pull-requests): write\b/)
  expect(workflow).not.toContain('id-token: write')
  expect(workflow).toContain('persist-credentials: false')
  expect(workflow).toContain('ur-agent@1.48.0')
  expect(workflow).toContain('$GITHUB_EVENT_PATH')
  expect(workflow).toContain(
    'uses: oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6',
  )
  expect(workflow).toContain('bun-version: 1.3.14')
})

test('compiled workflow honors the validated issue-comment trigger policy', () => {
  const spec = defaultAgenticCiSpec('repair')
  spec.trigger = {
    manual: false,
    issueComment: {
      keyword: '/repair',
      allowedAssociations: ['OWNER'],
    },
  }
  const workflow = compileAgenticCiWorkflow('repair', {
    packageVersion: '1.48.0',
    spec,
  })
  expect(workflow).toContain(
    "contains(github.event.comment.body, '/repair')",
  )
  expect(workflow).toContain(`fromJSON('[\"OWNER\"]')`)
  expect(workflow).not.toContain(
    "github.event_name == 'workflow_dispatch' ||",
  )
  expect(workflow).not.toContain('MEMBER')
})

test('legacy code-review workflow remains distinct from Agentic CI', () => {
  expect(CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT).not.toBe(WORKFLOW_CONTENT)
  expect(CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT).toContain('name: UR Review')
  expect(CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT).toContain('pull_request:')
  expect(CODE_REVIEW_PLUGIN_WORKFLOW_CONTENT).toContain(
    "plugins: 'code-review@ur-plugins-official'",
  )
  expect(PR_BODY).not.toContain('@ur')
  expect(PR_BODY).toContain('/ur')
})

test('spec parser rejects unrecognized trusted associations', () => {
  expect(() =>
    parseAgenticCiSpec(
      JSON.stringify({
        ...defaultAgenticCiSpec(),
        trigger: {
          issueComment: {
            keyword: '/ur',
            allowedAssociations: ['CONTRIBUTOR'],
          },
        },
      }),
    ),
  ).toThrow('allowedAssociations')
})

test('headless parent keeps provider credentials but strips platform/other secrets', () => {
  const env = buildSafeAgentEnvironment({
    PATH: '/bin',
    OPENAI_API_KEY: 'provider-value',
    URHQ_API_KEY: 'ur-provider-value',
    GITHUB_TOKEN: 'platform-value',
    NPM_TOKEN: 'registry-value',
    RANDOM_PASSWORD: 'password-value',
  })
  expect(env.OPENAI_API_KEY).toBe('provider-value')
  expect(env.URHQ_API_KEY).toBe('ur-provider-value')
  expect(env.GITHUB_TOKEN).toBeUndefined()
  expect(env.NPM_TOKEN).toBeUndefined()
  expect(env.RANDOM_PASSWORD).toBeUndefined()
  expect(env.UR_CODE_SUBPROCESS_ENV_SCRUB).toBe('1')
})

test('verification environment is an isolated allow-list with no auth or config', () => {
  const env = buildAgenticCiVerificationEnvironment(
    {
      PATH: '/bin',
      LANG: 'C',
      LC_ALL: 'C',
      OPENAI_API_KEY: 'provider-secret',
      URHQ_API_KEY: 'provider-secret',
      GITHUB_TOKEN: 'platform-secret',
      NPM_CONFIG_USERCONFIG: '/private/npmrc',
      AWS_CONFIG_FILE: '/private/aws',
      NODE_OPTIONS: '--require /private/inject.cjs',
      HTTPS_PROXY: 'https://user:pass@example.test',
    },
    '/isolated/check-home',
  )
  expect(env.PATH).toBe('/bin')
  expect(env.LANG).toBe('C')
  expect(env.LC_ALL).toBe('C')
  expect(env.HOME).toBe('/isolated/check-home')
  expect(env.TMPDIR).toBe('/isolated/check-home')
  expect(env.OPENAI_API_KEY).toBeUndefined()
  expect(env.URHQ_API_KEY).toBeUndefined()
  expect(env.GITHUB_TOKEN).toBeUndefined()
  expect(env.NPM_CONFIG_USERCONFIG).toBeUndefined()
  expect(env.AWS_CONFIG_FILE).toBeUndefined()
  expect(env.NODE_OPTIONS).toBeUndefined()
  expect(env.HTTPS_PROXY).toBeUndefined()
})

test('subprocess scrub removes secret-like base and override variables', () => {
  const oldFlag = process.env.UR_CODE_SUBPROCESS_ENV_SCRUB
  const oldToken = process.env.GITHUB_TOKEN
  process.env.UR_CODE_SUBPROCESS_ENV_SCRUB = '1'
  process.env.GITHUB_TOKEN = 'base-secret'
  try {
    const env = subprocessEnv({
      PATH: process.env.PATH,
      OPENAI_API_KEY: 'override-provider-secret',
      MCP_AUTH_TOKEN: 'mcp-secret',
      LSP_PASSWORD: 'lsp-secret',
      SAFE_VALUE: 'visible',
    })
    expect(env.GITHUB_TOKEN).toBeUndefined()
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.MCP_AUTH_TOKEN).toBeUndefined()
    expect(env.LSP_PASSWORD).toBeUndefined()
    expect(env.SAFE_VALUE).toBe('visible')
  } finally {
    if (oldFlag === undefined) delete process.env.UR_CODE_SUBPROCESS_ENV_SCRUB
    else process.env.UR_CODE_SUBPROCESS_ENV_SCRUB = oldFlag
    if (oldToken === undefined) delete process.env.GITHUB_TOKEN
    else process.env.GITHUB_TOKEN = oldToken
  }
})

test('Agentic CI emits a bounded hash-addressed patch from an isolated worktree', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-agentic-ci-'))
  try {
    await git(cwd, ['init'])
    await git(cwd, ['config', 'user.email', 'test@example.com'])
    await git(cwd, ['config', 'user.name', 'Test'])
    writeFileSync(join(cwd, 'README.md'), 'base\n')
    await git(cwd, ['add', 'README.md'])
    await git(cwd, ['commit', '-m', 'base'])

    const spec = defaultAgenticCiSpec()
    const result = await runAgenticCi({
      cwd,
      spec,
      runner: async options => {
        const src = join(options.cwd, 'src')
        const { mkdirSync } = await import('node:fs')
        mkdirSync(src, { recursive: true })
        writeFileSync(join(src, 'fixed.ts'), 'export const fixed = true\\n\n')
        return { output: 'implemented', verdict: 'PASS', isError: false }
      },
    })
    expect(result.status).toBe('passed')
    expect(result.patch).toBeDefined()
    const patchPath = join(
      result.manifestPath,
      '..',
      result.patch!.path,
    )
    const patch = readFileSync(patchPath, 'utf8')
    expect(result.patch!.sha256).toBe(
      createHash('sha256').update(patch).digest('hex'),
    )
    expect(existsSync(join(cwd, 'src', 'fixed.ts'))).toBe(false)
    expect(readFileSync(result.manifestPath, 'utf8')).not.toContain(
      'provider-value',
    )
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('Agentic CI requires an explicit PASS before emitting a patch', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-agentic-ci-verdict-'))
  try {
    await git(cwd, ['init'])
    await git(cwd, ['config', 'user.email', 'test@example.com'])
    await git(cwd, ['config', 'user.name', 'Test'])
    writeFileSync(join(cwd, 'README.md'), 'base\n')
    await git(cwd, ['add', 'README.md'])
    await git(cwd, ['commit', '-m', 'base'])

    for (const verdict of ['FAIL', null] as const) {
      const result = await runAgenticCi({
        cwd,
        spec: defaultAgenticCiSpec(),
        runner: async options => {
          const { mkdirSync } = await import('node:fs')
          mkdirSync(join(options.cwd, 'src'), { recursive: true })
          writeFileSync(
            join(options.cwd, `verdict-${verdict ?? 'none'}.ts`),
            'export const changed = true\n',
          )
          return { output: 'changed files', verdict, isError: false }
        },
      })
      expect(result.status).toBe('blocked')
      expect(result.patch).toBeUndefined()
      expect(result.violations.join('\n')).toContain('explicit PASS')
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('a passing verifier that mutates the candidate invalidates the patch', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-agentic-ci-mutation-'))
  try {
    await git(cwd, ['init'])
    await git(cwd, ['config', 'user.email', 'test@example.com'])
    await git(cwd, ['config', 'user.name', 'Test'])
    writeFileSync(join(cwd, 'README.md'), 'base\n')
    await git(cwd, ['add', 'README.md'])
    await git(cwd, ['commit', '-m', 'base'])

    const spec = defaultAgenticCiSpec()
    spec.verification = {
      ...spec.verification,
      commands: [
        {
          name: 'Mutating verifier',
          file: process.execPath,
          args: [
            '-e',
            "require('node:fs').writeFileSync('src/fixed.ts', 'export const fixed = false\\n')",
          ],
        },
      ],
    }
    const result = await runAgenticCi({
      cwd,
      spec,
      runner: async options => {
        const { mkdirSync } = await import('node:fs')
        mkdirSync(join(options.cwd, 'src'), { recursive: true })
        writeFileSync(
          join(options.cwd, 'src', 'fixed.ts'),
          'export const fixed = true\n',
        )
        return { output: 'implemented', verdict: 'PASS', isError: false }
      },
    })

    expect(result.checks).toHaveLength(1)
    expect(result.checks[0]?.exitCode).toBe(0)
    expect(result.status).toBe('blocked')
    expect(result.patch).toBeUndefined()
    expect(result.verificationStateSha256).toBeUndefined()
    expect(result.violations.join('\n')).toContain(
      'verification commands mutated candidate state',
    )
    expect(result.violations.join('\n')).toContain('unstaged changes')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('provider credentials reach only the agent, never git or verification', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-agentic-ci-env-'))
  const previous = {
    openai: process.env.OPENAI_API_KEY,
    urhq: process.env.URHQ_API_KEY,
    github: process.env.GITHUB_TOKEN,
    npmConfig: process.env.NPM_CONFIG_USERCONFIG,
    awsConfig: process.env.AWS_CONFIG_FILE,
    nodeOptions: process.env.NODE_OPTIONS,
    home: process.env.HOME,
  }
  try {
    await git(cwd, ['init'])
    await git(cwd, ['config', 'user.email', 'test@example.com'])
    await git(cwd, ['config', 'user.name', 'Test'])
    writeFileSync(join(cwd, 'README.md'), 'base\n')
    await git(cwd, ['add', 'README.md'])
    await git(cwd, ['commit', '-m', 'base'])

    process.env.OPENAI_API_KEY = 'agent-provider-secret'
    process.env.URHQ_API_KEY = 'agent-ur-secret'
    process.env.GITHUB_TOKEN = 'platform-secret'
    process.env.NPM_CONFIG_USERCONFIG = '/private/npmrc'
    process.env.AWS_CONFIG_FILE = '/private/aws-config'
    process.env.NODE_OPTIONS = '--require /private/not-loaded.cjs'

    let runnerEnv: NodeJS.ProcessEnv | undefined
    const childEnvironments: NodeJS.ProcessEnv[] = []
    const spec = defaultAgenticCiSpec()
    spec.verification = {
      ...spec.verification,
      commands: [
        {
          name: 'Environment isolation proof',
          file: process.execPath,
          args: [
            '-e',
            [
              'const names = Object.keys(process.env);',
              "const forbidden = names.filter(name => /(?:TOKEN|SECRET|PASSWORD|API_KEY|AUTH|CONFIG|NODE_OPTIONS|PROXY)/i.test(name));",
              "if (forbidden.length) { console.error(forbidden.join(',')); process.exit(1) }",
            ].join(''),
          ],
        },
      ],
    }
    const result = await runAgenticCi({
      cwd,
      spec,
      runner: async options => {
        runnerEnv = options.env
        const { mkdirSync } = await import('node:fs')
        mkdirSync(join(options.cwd, 'src'), { recursive: true })
        writeFileSync(
          join(options.cwd, 'src', 'env-proof.ts'),
          'export const isolated = true\n',
        )
        return { output: 'implemented', verdict: 'PASS', isError: false }
      },
      exec: async (file, args, commandCwd, timeoutMs, env) => {
        childEnvironments.push({ ...env })
        const run = await execFileNoThrowWithCwd(file, args, {
          cwd: commandCwd,
          timeout: timeoutMs,
          env,
          extendEnv: false,
          preserveOutputOnError: true,
          audit: false,
        })
        return {
          code: run.code,
          stdout: run.stdout,
          stderr: run.stderr || run.error || '',
        }
      },
    })

    expect(result.status).toBe('passed')
    expect(runnerEnv?.OPENAI_API_KEY).toBe('agent-provider-secret')
    expect(runnerEnv?.URHQ_API_KEY).toBe('agent-ur-secret')
    expect(runnerEnv?.GITHUB_TOKEN).toBeUndefined()
    expect(childEnvironments.length).toBeGreaterThan(0)
    for (const env of childEnvironments) {
      expect(env.OPENAI_API_KEY).toBeUndefined()
      expect(env.URHQ_API_KEY).toBeUndefined()
      expect(env.GITHUB_TOKEN).toBeUndefined()
      expect(env.NPM_CONFIG_USERCONFIG).toBeUndefined()
      expect(env.AWS_CONFIG_FILE).toBeUndefined()
      expect(env.NODE_OPTIONS).toBeUndefined()
    }
    const isolatedHome = childEnvironments[0]?.HOME
    expect(isolatedHome).toBeTruthy()
    expect(isolatedHome).not.toBe(previous.home)
    expect(existsSync(isolatedHome!)).toBe(false)
  } finally {
    const restore = (key: string, value: string | undefined): void => {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    restore('OPENAI_API_KEY', previous.openai)
    restore('URHQ_API_KEY', previous.urhq)
    restore('GITHUB_TOKEN', previous.github)
    restore('NPM_CONFIG_USERCONFIG', previous.npmConfig)
    restore('AWS_CONFIG_FILE', previous.awsConfig)
    restore('NODE_OPTIONS', previous.nodeOptions)
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('rename out of a denied path is treated as a blocked removal', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-agentic-ci-rename-'))
  try {
    await git(cwd, ['init'])
    await git(cwd, ['config', 'user.email', 'test@example.com'])
    await git(cwd, ['config', 'user.name', 'Test'])
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(cwd, '.github'), { recursive: true })
    writeFileSync(join(cwd, '.github', 'protected.yml'), 'protected: true\n')
    await git(cwd, ['add', '.github/protected.yml'])
    await git(cwd, ['commit', '-m', 'base'])

    const result = await runAgenticCi({
      cwd,
      spec: defaultAgenticCiSpec(),
      runner: async options => {
        const { mkdirSync, renameSync } = await import('node:fs')
        mkdirSync(join(options.cwd, 'src'), { recursive: true })
        renameSync(
          join(options.cwd, '.github', 'protected.yml'),
          join(options.cwd, 'src', 'protected.ts'),
        )
        return { output: 'moved file', verdict: 'PASS', isError: false }
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.patch).toBeUndefined()
    expect(result.violations.join('\n')).toContain(
      'deleted files are not allowed: .github/protected.yml',
    )
    expect(result.violations.join('\n')).toContain(
      'denied path changed: .github/protected.yml',
    )
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('NUL-delimited path policy blocks denied filenames containing newlines', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ur-agentic-ci-control-path-'))
  try {
    await git(cwd, ['init'])
    await git(cwd, ['config', 'user.email', 'test@example.com'])
    await git(cwd, ['config', 'user.name', 'Test'])
    writeFileSync(join(cwd, 'README.md'), 'base\n')
    await git(cwd, ['add', 'README.md'])
    await git(cwd, ['commit', '-m', 'base'])

    const spec = defaultAgenticCiSpec()
    spec.workspace = {
      allowedPaths: ['**'],
      deniedPaths: ['.github/**'],
    }
    const deniedPath = '.github/protected\nworkflow.yml'
    const result = await runAgenticCi({
      cwd,
      spec,
      runner: async options => {
        const { mkdirSync } = await import('node:fs')
        mkdirSync(join(options.cwd, '.github'), { recursive: true })
        writeFileSync(join(options.cwd, deniedPath), 'permissions: write-all\n')
        return { output: 'added workflow', verdict: 'PASS', isError: false }
      },
    })

    expect(result.status).toBe('blocked')
    expect(result.patch).toBeUndefined()
    expect(
      result.violations.some(
        violation =>
          violation.startsWith('denied path changed: .github/protected') &&
          violation.endsWith('workflow.yml'),
      ),
    ).toBe(true)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
