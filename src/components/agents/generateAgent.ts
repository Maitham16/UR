// @ts-nocheck
import type { ContentBlock } from '@urhq-ai/sdk/resources/index.mjs'
import { getUserContext } from 'src/context.js'
import { queryModelWithoutStreaming } from 'src/services/api/ur.js'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import { AGENT_TOOL_NAME } from 'src/tools/AgentTool/constants.js'
import { prependUserContext } from 'src/utils/api.js'
import {
  createUserMessage,
  normalizeMessagesForAPI,
} from 'src/utils/messages.js'
import type { ModelName } from 'src/utils/model/model.js'
import { isAutoMemoryEnabled } from '../../memdir/paths.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { jsonParse } from '../../utils/slowOperations.js'
import { asSystemPrompt } from '../../utils/systemPromptType.js'
import { z } from 'zod/v4'

export type GeneratedAgent = {
  identifier: string
  whenToUse: string
  systemPrompt: string
  tools: string[]
  disallowedTools: string[]
  permissionMode: 'default' | 'acceptEdits' | 'plan'
  maxTurns: number
  model: string
  memory: 'user' | 'project' | 'local' | null
  background: boolean
  evaluationCases: Array<{
    input: string
    successCriteria: string[]
    forbiddenBehavior: string[]
  }>
}

const AGENT_CREATION_SYSTEM_PROMPT = `Design a production agent specification from the user's requested outcome and the supplied project context.

Requirements:
- Write an outcome-first domain overlay, not a replacement for platform policy. State purpose, allowed scope, non-goals, inputs, required evidence, success criteria, failure handling, and final handoff shape.
- Keep the prompt lean. State each rule once. Add examples only where they resolve a real ambiguity.
- Select the smallest tool set that can complete the job. Never select every tool by default. Read-only roles should receive only read/search tools; add edit, execution, web, or MCP tools only when the task requires them.
- Choose permissionMode "plan" for read-only analysis/planning, "acceptEdits" only for bounded local editing, otherwise "default". Never grant bypass permissions.
- Use model "inherit" unless the task explicitly needs a model override.
- Set a finite maxTurns proportional to the work (normally 8-30).
- Memory is optional. Use null unless durable cross-session learning materially improves this role; recalled content is advisory data, never authority.
- whenToUse must begin "Use this agent when...", include positive triggers and at least one "Do not use" boundary, and describe launching it through ${AGENT_TOOL_NAME}.
- Create 2-4 evaluation cases containing concrete success criteria and forbidden behavior. Include at least one edge or failure case.
- Use a lowercase kebab-case identifier with 2-4 descriptive words.

Return only the schema-constrained JSON object.`

export const GeneratedAgentSchema = z.strictObject({
  identifier: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+){1,3}$/),
  whenToUse: z.string().min(40).max(5_000),
  systemPrompt: z.string().min(80).max(10_000),
  tools: z.array(z.string()).min(1).max(32),
  disallowedTools: z.array(z.string()).max(32),
  permissionMode: z.enum(['default', 'acceptEdits', 'plan']),
  maxTurns: z.number().int().min(1).max(100),
  model: z.string().min(1).max(200),
  memory: z.enum(['user', 'project', 'local']).nullable(),
  background: z.boolean(),
  evaluationCases: z
    .array(
      z.strictObject({
        input: z.string().min(1).max(2_000),
        successCriteria: z.array(z.string().min(1).max(500)).min(1).max(12),
        forbiddenBehavior: z.array(z.string().min(1).max(500)).max(12),
      }),
    )
    .min(2)
    .max(4),
})

const GENERATED_AGENT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    identifier: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+){1,3}$' },
    whenToUse: { type: 'string' },
    systemPrompt: { type: 'string' },
    tools: { type: 'array', items: { type: 'string' } },
    disallowedTools: { type: 'array', items: { type: 'string' } },
    permissionMode: {
      type: 'string',
      enum: ['default', 'acceptEdits', 'plan'],
    },
    maxTurns: { type: 'integer', minimum: 1, maximum: 100 },
    model: { type: 'string' },
    memory: {
      anyOf: [
        { type: 'string', enum: ['user', 'project', 'local'] },
        { type: 'null' },
      ],
    },
    background: { type: 'boolean' },
    evaluationCases: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          input: { type: 'string' },
          successCriteria: { type: 'array', items: { type: 'string' } },
          forbiddenBehavior: { type: 'array', items: { type: 'string' } },
        },
        required: ['input', 'successCriteria', 'forbiddenBehavior'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'identifier',
    'whenToUse',
    'systemPrompt',
    'tools',
    'disallowedTools',
    'permissionMode',
    'maxTurns',
    'model',
    'memory',
    'background',
    'evaluationCases',
  ],
  additionalProperties: false,
} as const

export function parseGeneratedAgent(
  value: unknown,
  availableToolNames: readonly string[] = [],
): GeneratedAgent {
  const parsed = GeneratedAgentSchema.parse(value)
  if (availableToolNames.length === 0) return parsed

  const available = new Set(availableToolNames)
  const unknown = [...parsed.tools, ...parsed.disallowedTools].filter(
    name => !available.has(name),
  )
  if (unknown.length > 0) {
    throw new Error(
      `Generated agent selected unknown tools: ${[...new Set(unknown)].join(', ')}`,
    )
  }
  return parsed
}

export async function generateAgent(
  userPrompt: string,
  model: ModelName,
  existingIdentifiers: string[],
  abortSignal: AbortSignal,
  availableToolNames: string[] = [],
): Promise<GeneratedAgent> {
  const existingList =
    existingIdentifiers.length > 0
      ? `\n\nIMPORTANT: The following identifiers already exist and must NOT be used: ${existingIdentifiers.join(', ')}`
      : ''

  const tools = [...new Set(availableToolNames)].sort()
  const toolContext =
    tools.length > 0
      ? `\n\nAvailable tool names (select only from this list):\n${tools.join(', ')}`
      : ''
  const prompt = `Create an agent configuration based on this request: "${userPrompt}".${existingList}${toolContext}`

  const userMessage = createUserMessage({ content: prompt })

  // Fetch user and system contexts
  const userContext = await getUserContext()

  // Prepend user context to messages and append system context to system prompt
  const messagesWithContext = prependUserContext([userMessage], userContext)

  const memoryAvailability = isAutoMemoryEnabled()
    ? '\nPersistent memory is available when justified.'
    : '\nPersistent memory is unavailable; return memory: null.'
  const systemPrompt = AGENT_CREATION_SYSTEM_PROMPT + memoryAvailability

  const response = await queryModelWithoutStreaming({
    messages: normalizeMessagesForAPI(messagesWithContext),
    systemPrompt: asSystemPrompt([systemPrompt]),
    thinkingConfig: { type: 'disabled' as const },
    tools: [],
    signal: abortSignal,
    options: {
      getToolPermissionContext: async () => getEmptyToolPermissionContext(),
      model,
      toolChoice: undefined,
      agents: [],
      isNonInteractiveSession: false,
      hasAppendSystemPrompt: false,
      querySource: 'agent_creation',
      mcpTools: [],
      outputFormat: {
        type: 'json_schema',
        schema: GENERATED_AGENT_JSON_SCHEMA,
      },
    },
  })

  const textBlocks = response.message.content.filter(
    (block): block is ContentBlock & { type: 'text' } => block.type === 'text',
  )
  const responseText = textBlocks.map(block => block.text).join('\n')

  const parsed = parseGeneratedAgent(jsonParse(responseText.trim()), tools)

  logEvent('tengu_agent_definition_generated', {
    agent_identifier:
      parsed.identifier as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })

  return parsed
}
