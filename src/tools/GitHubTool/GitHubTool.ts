import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { lazySchema } from '../../utils/lazySchema.js'

const GITHUB_TOOL_NAME = 'GitHub'

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum([
        'pr_list',
        'pr_view',
        'pr_create',
        'issue_list',
        'issue_create',
        'repo_view',
        'search_code',
      ])
      .describe('GitHub action to perform'),
    repo: z
      .string()
      .optional()
      .describe('Repository in owner/repo format (defaults to current repo)'),
    title: z.string().optional().describe('PR or issue title'),
    body: z.string().optional().describe('PR or issue body'),
    head: z.string().optional().describe('Head branch for PR creation'),
    base: z.string().optional().describe('Base branch for PR creation'),
    query: z.string().optional().describe('Search query'),
    number: z.number().int().optional().describe('PR or issue number'),
    limit: z.number().int().optional().describe('Maximum results to return'),
    draft: z.boolean().optional().describe('Create PR as draft'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

async function runGh(args: string[]): Promise<Output> {
  const result = await execFileNoThrow('gh', args, { timeout: 60_000 })
  return {
    success: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.code !== 0 ? result.error || result.stderr : undefined,
  }
}

function repoArgs(repo: string | undefined): string[] {
  return repo ? ['--repo', repo] : []
}

async function dispatch(input: z.infer<InputSchema>): Promise<Output> {
  switch (input.action) {
    case 'pr_list': {
      const limit = input.limit ?? 10
      return runGh(['pr', 'list', ...repoArgs(input.repo), '--limit', String(limit), '--json', 'number,title,state,url'])
    }
    case 'pr_view': {
      if (!input.number) {
        return { success: false, error: 'number is required for pr_view' }
      }
      return runGh(['pr', 'view', String(input.number), ...repoArgs(input.repo), '--json', 'number,title,state,url,body'])
    }
    case 'pr_create': {
      const args = ['pr', 'create', ...repoArgs(input.repo)]
      if (input.title) args.push('--title', input.title)
      if (input.body) args.push('--body', input.body)
      if (input.head) args.push('--head', input.head)
      if (input.base) args.push('--base', input.base)
      if (input.draft) args.push('--draft')
      return runGh(args)
    }
    case 'issue_list': {
      const limit = input.limit ?? 10
      return runGh(['issue', 'list', ...repoArgs(input.repo), '--limit', String(limit), '--json', 'number,title,state,url'])
    }
    case 'issue_create': {
      const args = ['issue', 'create', ...repoArgs(input.repo)]
      if (input.title) args.push('--title', input.title)
      if (input.body) args.push('--body', input.body)
      return runGh(args)
    }
    case 'repo_view': {
      return runGh(['repo', 'view', input.repo || '.', '--json', 'name,description,url,stargazerCount'])
    }
    case 'search_code': {
      if (!input.query) {
        return { success: false, error: 'query is required for search_code' }
      }
      const limit = input.limit ?? 10
      return runGh(['search', 'code', input.query, '--limit', String(limit), '--json', 'path,url,repository'])
    }
    default:
      return { success: false, error: `unsupported action: ${input.action}` }
  }
}

export const GitHubTool = buildTool({
  name: GITHUB_TOOL_NAME,
  searchHint: 'interact with GitHub repos, PRs, and issues',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description() {
    return 'Run a GitHub operation via the gh CLI'
  },
  async prompt() {
    return 'Run a GitHub operation via the gh CLI. Supported actions: pr_list, pr_view, pr_create, issue_list, issue_create, repo_view, search_code.'
  },
  userFacingName() {
    return 'GitHub'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly(input) {
    return ['pr_list', 'pr_view', 'issue_list', 'repo_view', 'search_code'].includes(input.action)
  },
  isDestructive(input) {
    return ['pr_create', 'issue_create'].includes(input.action)
  },
  toAutoClassifierInput(input) {
    return `${input.action} ${input.repo || ''}`
  },
  async checkPermissions(input) {
    if (input.action === 'pr_create' || input.action === 'issue_create') {
      return {
        behavior: 'ask',
        updatedInput: input,
        message: `UR wants to create a GitHub ${input.action === 'pr_create' ? 'pull request' : 'issue'}`,
        suggestions: [],
      }
    }
    return { behavior: 'allow', updatedInput: input }
  },
  async validateInput(input) {
    if (input.action === 'pr_create' && (!input.title?.trim() || !input.body?.trim())) {
      return {
        result: false,
        message: 'pr_create requires non-empty title and body so gh never opens an interactive prompt.',
        errorCode: 1,
      }
    }
    if (input.action === 'issue_create' && (!input.title?.trim() || !input.body?.trim())) {
      return {
        result: false,
        message: 'issue_create requires non-empty title and body so gh never opens an interactive prompt.',
        errorCode: 1,
      }
    }
    return { result: true }
  },
  renderToolUseMessage() {
    return null
  },
  async call(input) {
    const result = await dispatch(input)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: JSON.stringify(content),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
