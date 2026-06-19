import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { isCodeIndexEnabled, searchCode } from '../../utils/codeIndex/index.js'
import type { CodeSearchHit } from '../../utils/codeIndex/index.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { semanticNumber } from '../../utils/semanticNumber.js'
import { CODE_SEARCH_TOOL_NAME, getDescription } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    query: z
      .string()
      .describe(
        'Natural-language description of the code you are looking for (e.g. "retry logic for failed network requests").',
      ),
    limit: semanticNumber(z.number().optional()).describe(
      'Maximum number of results to return. Defaults to 10.',
    ),
    path: z
      .string()
      .optional()
      .describe(
        'Optional project-relative path prefix to restrict results to (e.g. "src/tools").',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    status: z.enum(['ok', 'no_index', 'empty']),
    message: z.string().optional(),
    builtAt: z.string().optional(),
    hits: z.array(
      z.object({
        file: z.string(),
        startLine: z.number(),
        endLine: z.number(),
        score: z.number(),
        preview: z.string(),
      }),
    ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

const DEFAULT_LIMIT = 10

function formatHit(hit: CodeSearchHit): string {
  const score = hit.score.toFixed(3)
  const indentedPreview = hit.preview
    .split('\n')
    .map(line => `    ${line}`)
    .join('\n')
  return `${hit.file}:${hit.startLine}-${hit.endLine}  (score ${score})\n${indentedPreview}`
}

export const CodeSearchTool = buildTool({
  name: CODE_SEARCH_TOOL_NAME,
  searchHint: 'semantic code search over a local embedding index',
  maxResultSizeChars: 20_000,
  strict: true,
  async description() {
    return getDescription()
  },
  async prompt() {
    return getDescription()
  },
  userFacingName() {
    return 'Code search'
  },
  getActivityDescription(input) {
    return input?.query ? `Searching code for ${input.query}` : 'Searching code'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return isCodeIndexEnabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  isSearchOrReadCommand() {
    return { isSearch: true, isRead: false }
  },
  toAutoClassifierInput(input) {
    return input.path ? `${input.query} in ${input.path}` : input.query
  },
  renderToolUseMessage({ query, path }, { verbose: _verbose }) {
    if (!query) {
      return null
    }
    const parts = [`query: "${query}"`]
    if (path) {
      parts.push(`path: "${path}"`)
    }
    return parts.join(', ')
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.status === 'no_index') {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content:
          output.message ??
          'No code index found. Build it first with `ur code-index build`.',
      }
    }
    if (output.status === 'empty' || output.hits.length === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: 'No semantically similar code found.',
      }
    }
    const header = `Found ${output.hits.length} result${output.hits.length === 1 ? '' : 's'}${output.builtAt ? ` (index built ${output.builtAt})` : ''}:`
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `${header}\n\n${output.hits.map(formatHit).join('\n\n')}`,
    }
  },
  extractSearchText(output) {
    return output.hits.map(h => `${h.file}:${h.startLine}-${h.endLine}`).join('\n')
  },
  async call({ query, limit, path }, { abortController }) {
    const root = getCwd()
    const { hits, index } = await searchCode({
      root,
      query,
      k: (limit ?? DEFAULT_LIMIT) + (path ? 40 : 0),
      signal: abortController.signal,
    })

    if (!index) {
      const output: Output = {
        status: 'no_index',
        message:
          'No code index found for this project. Build it with `ur code-index build` (requires a local Ollama embedding model, e.g. `ollama pull nomic-embed-text`).',
        hits: [],
      }
      return { data: output }
    }

    const filtered = path
      ? hits.filter(h => h.file === path || h.file.startsWith(`${path.replace(/\/$/, '')}/`))
      : hits
    const limited = filtered.slice(0, limit ?? DEFAULT_LIMIT)

    const output: Output = {
      status: limited.length === 0 ? 'empty' : 'ok',
      builtAt: index.builtAt,
      hits: limited,
    }
    return { data: output }
  },
} satisfies ToolDef<InputSchema, Output>)
