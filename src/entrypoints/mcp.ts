import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { randomUUID } from 'node:crypto'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'
import { getDefaultAppState } from 'src/state/AppStateStore.js'
import review from '../commands/review.js'
import type { Command } from '../commands.js'
import {
  findToolByName,
  getEmptyToolPermissionContext,
  type ToolResult,
  type ToolUseContext,
} from '../Tool.js'
import { getTools } from '../tools.js'
import { createAbortController } from '../utils/abortController.js'
import { createFileStateCacheWithSizeLimit } from '../utils/fileStateCache.js'
import { logError } from '../utils/log.js'
import { createAssistantMessage } from '../utils/messages.js'
import { getMainLoopModel } from '../utils/model/model.js'
import { hasPermissionsToUseTool } from '../utils/permissions/permissions.js'
import { setCwd } from '../utils/Shell.js'
import { getErrorParts } from '../utils/toolErrors.js'
import {
  RollingRateLimitError,
  RollingRateLimiter,
  readPositiveInteger,
} from '../utils/rollingRateLimiter.js'
import {
  describeMcpTool,
  formatMcpToolResult,
  parseMcpToolArguments,
} from './mcpToolAdapter.js'

const MCP_COMMANDS: Command[] = [review]

export async function startMCPServer(
  cwd: string,
  debug: boolean,
  verbose: boolean,
): Promise<void> {
  // Use size-limited LRU cache for readFileState to prevent unbounded memory growth
  // 100 files and 25MB limit should be sufficient for MCP server operations
  const READ_FILE_STATE_CACHE_SIZE = 100
  const readFileStateCache = createFileStateCacheWithSizeLimit(
    READ_FILE_STATE_CACHE_SIZE,
  )
  setCwd(cwd)
  const maxCallsPerMinute = readPositiveInteger(
    process.env.UR_MCP_MAX_CALLS_PER_MINUTE,
    120,
    10_000,
  )
  const maxConcurrentCalls = readPositiveInteger(
    process.env.UR_MCP_MAX_CONCURRENT_CALLS,
    8,
    100,
  )
  const toolTimeoutMs = readPositiveInteger(
    process.env.UR_MCP_TOOL_TIMEOUT_MS,
    120_000,
    30 * 60_000,
  )
  const maxOutputChars = readPositiveInteger(
    process.env.UR_MCP_MAX_OUTPUT_CHARS,
    1_000_000,
    10_000_000,
  )
  const maxInputChars = readPositiveInteger(
    process.env.UR_MCP_MAX_INPUT_CHARS,
    250_000,
    2_000_000,
  )
  const limiter = new RollingRateLimiter({
    maxCalls: maxCallsPerMinute,
    windowMs: 60_000,
    maxConcurrent: maxConcurrentCalls,
  })
  const toolPermissionContext = {
    ...getEmptyToolPermissionContext(),
    shouldAvoidPermissionPrompts: true,
  }
  const server = new Server(
    {
      name: 'ur-nexus',
      version: MACRO.VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (): Promise<ListToolsResult> => {
      // Deliberately expose UR's built-in tools only. Re-exporting configured
      // downstream MCP servers would cross their authentication and approval
      // boundaries and turn this server into a confused deputy.
      const tools = getTools(toolPermissionContext)
      return {
        tools: await Promise.all(
          tools.map(tool =>
            describeMcpTool(tool, tools, toolPermissionContext),
          ),
        ),
      }
    },
  )

  server.setRequestHandler(
    CallToolRequestSchema,
    async ({ params: { name, arguments: args } }): Promise<CallToolResult> => {
      const tools = getTools(toolPermissionContext)
      const tool = findToolByName(tools, name)
      if (!tool) {
        throw new Error(`Tool ${name} not found`)
      }

      let release: (() => void) | undefined
      let timeout: ReturnType<typeof setTimeout> | undefined
      let operation: Promise<ToolResult<unknown>> | undefined
      let timedOut = false

      try {
        release = limiter.acquire()
        const abortController = createAbortController()
        const appState = {
          ...getDefaultAppState(),
          toolPermissionContext,
        }
        // Assume MCP servers do not read messages separately from the tool
        // call arguments.
        const toolUseContext: ToolUseContext = {
          abortController,
          options: {
            commands: MCP_COMMANDS,
            tools,
            mainLoopModel: getMainLoopModel(),
            thinkingConfig: { type: 'disabled' },
            mcpClients: [],
            mcpResources: {},
            isNonInteractiveSession: true,
            debug,
            verbose,
            agentDefinitions: { activeAgents: [], allAgents: [] },
          },
          getAppState: () => appState,
          setAppState: () => {},
          messages: [],
          readFileState: readFileStateCache,
          setInProgressToolUseIDs: () => {},
          setResponseLength: () => {},
          updateFileHistoryState: () => {},
          updateAttributionState: () => {},
        }

        if (!tool.isEnabled()) {
          throw new Error(`Tool ${name} is not enabled`)
        }
        const parsedArgs = await parseMcpToolArguments(
          tool,
          args,
          maxInputChars,
        )
        const validationResult = await tool.validateInput?.(
          parsedArgs as never,
          toolUseContext,
        )
        if (validationResult?.result === false) {
          throw new Error(
            `Tool ${name} input is invalid: ${validationResult.message}`,
          )
        }
        const parentMessage = createAssistantMessage({ content: [] })
        const permissionDecision = await hasPermissionsToUseTool(
          tool,
          parsedArgs,
          toolUseContext,
          parentMessage,
          randomUUID(),
        )
        if (permissionDecision.behavior !== 'allow') {
          throw new Error(
            permissionDecision.message ||
              `Tool ${name} requires interactive approval, which is unavailable over MCP`,
          )
        }
        const authorizedArgs = permissionDecision.updatedInput ?? parsedArgs
        const reparsedArgs = await parseMcpToolArguments(
          tool,
          authorizedArgs,
          maxInputChars,
        )
        const authorizedValidation = await tool.validateInput?.(
          reparsedArgs as never,
          toolUseContext,
        )
        if (authorizedValidation?.result === false) {
          throw new Error(
            `Tool ${name} authorized input is invalid: ${authorizedValidation.message}`,
          )
        }
        operation = tool.call(
          reparsedArgs as never,
          toolUseContext,
          hasPermissionsToUseTool,
          parentMessage,
        )
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            timedOut = true
            abortController.abort()
            reject(
              new Error(
                `Tool ${name} exceeded the MCP timeout of ${toolTimeoutMs}ms and was cancelled`,
              ),
            )
          }, toolTimeoutMs)
        })
        const finalResult = await Promise.race([operation, timeoutPromise])
        if (timeout) clearTimeout(timeout)
        timeout = undefined

        return await formatMcpToolResult(tool, finalResult, maxOutputChars)
      } catch (error) {
        if (!(error instanceof RollingRateLimitError)) {
          logError(error)
        }

        const parts =
          error instanceof Error ? getErrorParts(error) : [String(error)]
        const errorText = parts.filter(Boolean).join('\n').trim() || 'Error'
        const truncationSuffix = '\n...[MCP error truncated]'
        const boundedErrorText =
          errorText.length <= maxOutputChars
            ? errorText
            : maxOutputChars <= truncationSuffix.length
              ? truncationSuffix.slice(0, maxOutputChars)
              : `${errorText.slice(0, maxOutputChars - truncationSuffix.length)}${truncationSuffix}`

        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: boundedErrorText,
            },
          ],
        }
      } finally {
        if (timeout) clearTimeout(timeout)
        // A timed-out tool may ignore AbortSignal. Keep its concurrency lease
        // until it actually settles so repeated timeouts cannot bypass the
        // server's in-flight work bound.
        if (timedOut && operation && release) {
          const releaseWhenSettled = release
          release = undefined
          void operation.then(releaseWhenSettled, releaseWhenSettled)
        }
        release?.()
      }
    },
  )

  async function runServer() {
    const transport = new StdioServerTransport()
    await server.connect(transport)
  }

  return await runServer()
}
