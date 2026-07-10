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

const WRITE_KEYWORDS = /\b(insert|update|delete|drop|create|alter|truncate|replace|attach|detach|vacuum|reindex|grant|revoke|merge|call|copy)\b/i
const WRITE_PRAGMAS = /\b(journal_mode|locking_mode|wal_checkpoint|optimize|user_version|application_id|schema_version)\b/i

export function isReadOnlySql(query: string): boolean {
  const normalized = query
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
  if (!normalized || WRITE_KEYWORDS.test(normalized)) return false
  const statements = normalized.split(';').map(s => s.trim()).filter(Boolean)
  return statements.every(statement => {
    if (/^(select|values|show|describe|desc|explain)\b/i.test(statement)) return true
    if (/^with\b/i.test(statement)) return !WRITE_KEYWORDS.test(statement)
    if (/^pragma\b/i.test(statement)) {
      return !/=/.test(statement) && !WRITE_PRAGMAS.test(statement)
    }
    return false
  })
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

async function runSqlite(database: string, query: string, readonly: boolean): Promise<Output> {
  const args = [...(readonly ? ['-readonly'] : []), '-json', database, query]
  const result = await execFileNoThrow('sqlite3', args, { timeout: 60_000 })
  return {
    success: result.code === 0,
    rows: result.code === 0 ? parseRows(result.stdout) : undefined,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.code !== 0 ? result.error || result.stderr : undefined,
  }
}

async function runPostgres(database: string, query: string, readonly: boolean): Promise<Output> {
  const sql = readonly ? `BEGIN READ ONLY; ${query}; COMMIT;` : query
  const result = await execFileNoThrow('psql', [database, '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql], {
    timeout: 60_000,
  })
  return {
    success: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.code !== 0 ? result.error || result.stderr : undefined,
  }
}

async function runMysql(database: string, query: string, readonly: boolean): Promise<Output> {
  const sql = readonly ? `START TRANSACTION READ ONLY; ${query}; COMMIT;` : query
  const result = await execFileNoThrow('mysql', [database, '-e', sql, '--batch', '--raw', '--skip-column-names'], {
    timeout: 60_000,
  })
  return {
    success: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.code !== 0 ? result.error || result.stderr : undefined,
  }
}

async function runDuckdb(database: string, query: string, readonly: boolean): Promise<Output> {
  const result = await execFileNoThrow('duckdb', [...(readonly ? ['-readonly'] : []), database, '-c', `.mode json\n${query}`], {
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
      return runSqlite(input.database, input.query, input.readonly)
    case 'postgres':
      return runPostgres(input.database, input.query, input.readonly)
    case 'mysql':
      return runMysql(input.database, input.query, input.readonly)
    case 'duckdb':
      return runDuckdb(input.database, input.query, input.readonly)
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
