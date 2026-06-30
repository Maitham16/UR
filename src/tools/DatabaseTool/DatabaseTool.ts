import { existsSync } from 'node:fs'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { lazySchema } from '../../utils/lazySchema.js'

const DATABASE_TOOL_NAME = 'Database'

const inputSchema = lazySchema(() =>
  z.strictObject({
    connection: z
      .enum(['sqlite', 'postgres', 'mysql', 'duckdb'])
      .describe('Database type'),
    database: z.string().describe('Database file path or connection string'),
    query: z.string().describe('SQL query to execute'),
    readonly: z.boolean().default(true).describe('Allow only SELECT or read-only queries'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    rows: z.array(z.record(z.string(), z.unknown())).optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

const WRITE_KEYWORDS = new Set(['insert', 'update', 'delete', 'drop', 'create', 'alter', 'truncate', 'replace'])

function isReadOnlySql(query: string): boolean {
  const normalized = query.toLowerCase()
  for (const keyword of WRITE_KEYWORDS) {
    if (normalized.includes(keyword)) return false
  }
  return true
}

function parseRows(text: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed)) return parsed as Record<string, unknown>[]
    return []
  } catch {
    return []
  }
}

async function runSqlite(database: string, query: string): Promise<Output> {
  const result = await execFileNoThrow('sqlite3', [database, query, '-json'], { timeout: 60_000 })
  return {
    success: result.code === 0,
    rows: result.code === 0 ? parseRows(result.stdout) : undefined,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.code !== 0 ? result.error || result.stderr : undefined,
  }
}

async function runPostgres(database: string, query: string): Promise<Output> {
  const result = await execFileNoThrow('psql', [database, '-c', query, '--no-psqlrc', '-t', '-A'], {
    timeout: 60_000,
  })
  return {
    success: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.code !== 0 ? result.error || result.stderr : undefined,
  }
}

async function runMysql(database: string, query: string): Promise<Output> {
  const result = await execFileNoThrow('mysql', [database, '-e', query, '--batch', '--raw', '--skip-column-names'], {
    timeout: 60_000,
  })
  return {
    success: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.code !== 0 ? result.error || result.stderr : undefined,
  }
}

async function runDuckdb(database: string, query: string): Promise<Output> {
  const result = await execFileNoThrow('duckdb', [database, '-c', `.mode json\n${query}`], {
    timeout: 60_000,
  })
  return {
    success: result.code === 0,
    rows: result.code === 0 ? parseRows(result.stdout) : undefined,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.code !== 0 ? result.error || result.stderr : undefined,
  }
}

async function dispatch(input: z.infer<InputSchema>): Promise<Output> {
  if (input.readonly && !isReadOnlySql(input.query)) {
    return { success: false, error: 'readonly=true but query contains write keywords' }
  }
  switch (input.connection) {
    case 'sqlite':
      return runSqlite(input.database, input.query)
    case 'postgres':
      return runPostgres(input.database, input.query)
    case 'mysql':
      return runMysql(input.database, input.query)
    case 'duckdb':
      return runDuckdb(input.database, input.query)
    default:
      return { success: false, error: `unsupported connection: ${input.connection}` }
  }
}

export const DatabaseTool = buildTool({
  name: DATABASE_TOOL_NAME,
  searchHint: 'execute SQL against sqlite, postgres, mysql, or duckdb',
  maxResultSizeChars: 100_000,
  shouldDefer: true,
  async description(input) {
    return `Run ${input.connection} query`
  },
  async prompt() {
    return 'Execute a SQL query against sqlite, postgres, mysql, or duckdb. Defaults to readonly=true.'
  },
  userFacingName() {
    return 'Database'
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
    return input.readonly
  },
  isDestructive(input) {
    return !input.readonly
  },
  toAutoClassifierInput(input) {
    return `${input.connection} ${input.database}`
  },
  async checkPermissions(input) {
    return {
      behavior: 'ask',
      message: `UR wants to run a ${input.connection} query`,
      updatedInput: input,
    }
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
