import { AsyncLocalStorage } from 'async_hooks'
import { randomUUID } from 'node:crypto'
import type { Message } from '../types/message.js'
import type { QueuedCommand } from '../types/textInputTypes.js'
import { isHumanTurn } from './messagePredicates.js'

export type TaskListRunContext = {
  generationId: string
  appendToCurrent: boolean
  requiresTaskList: boolean
  requirementReason?: TaskListRequirementReason
}

export type TaskListRequirementReason =
  | 'explicit task tracking request'
  | 'planning workflow'
  | 'delegation or parallel agent work'
  | 'release, security, migration, or production risk'
  | 'multiple requested outcomes'
  | 'large project scope'
  | 'detailed multi-step request'

const taskListRunStorage = new AsyncLocalStorage<{
  run: TaskListRunContext | undefined
}>()

/**
 * Keep task-list generation state scoped to one user turn. This is deliberately
 * async-local: detached subagents inherit the turn they were spawned from,
 * while later prompts cannot overwrite an earlier turn's generation.
 */
export function runWithTaskListRun<T>(
  run: TaskListRunContext | undefined,
  fn: () => T,
): T {
  return taskListRunStorage.run({ run }, fn)
}

export function getTaskListRunContext(): TaskListRunContext | undefined {
  return taskListRunStorage.getStore()?.run
}

function textFromQueuedCommand(command: QueuedCommand): string {
  if (command.preExpansionValue) return command.preExpansionValue
  if (typeof command.value === 'string') return command.value
  return command.value
    .filter(block => block.type === 'text')
    .map(block => ('text' in block ? block.text : ''))
    .join('\n')
}

function textFromMessage(message: Message): string {
  const content = message.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => block.type === 'text')
    .map(block => ('text' in block ? block.text : ''))
    .join('\n')
}

/**
 * This recognizes only an explicit request to keep using the active list.
 * Ambiguous follow-ups intentionally start a new generation, matching the
 * task-list lifecycle contract instead of silently appending stale work.
 */
export function requestsAppendToCurrentTaskList(input: string): boolean {
  const normalized = input.replace(/\s+/gu, ' ').trim().toLowerCase()
  if (!normalized) return false

  return (
    /\b(?:add|append|put|queue)\b.{0,100}\b(?:current|existing|active|same)\s+(?:task\s+)?list\b/u.test(
      normalized,
    ) ||
    /\b(?:add|append|put|queue)\b.{0,100}\b(?:current|existing|active)\s+tasks\b/u.test(
      normalized,
    ) ||
    /\b(?:add|append|put|queue)\s+(?:this|it)\s+(?:to|on)\s+(?:my|the|your)\s+(?:current\s+)?(?:task\s+)?list\b/u.test(
      normalized,
    ) ||
    /\b(?:current|existing|active|same)\s+(?:task\s+)?list\b.{0,100}\b(?:add|append|put|queue)\b/u.test(
      normalized,
    ) ||
    /\b(?:keep|continue|use)\b.{0,100}\b(?:current|existing|active|same)\s+(?:task\s+)?list\b/u.test(
      normalized,
    )
  )
}

/**
 * Recognize a turn that authorizes work already planned rather than starting a
 * new request.
 *
 * Planning-only responses often end at the user boundary even when the user
 * asked the agent to continue automatically. A short `ok`/`proceed` reply is
 * therefore a continuation of the active task generation. Treating it as a
 * fresh generation archived the plan immediately before the model tried to
 * update it. Keep this deliberately narrow and whole-message anchored so a
 * new request such as "continue improving the parser" still starts fresh.
 */
export function requestsContinueCurrentTaskList(input: string): boolean {
  const normalized = input
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/gu, '')
    .trim()
  if (!normalized || normalized.length > 80) return false

  return (
    /^(?:ok(?:ay)?|yes|yep|yup|sure|approved|i approve|looks good|sounds good)$/u.test(
      normalized,
    ) ||
    /^(?:please\s+)?(?:continue|proceed|go ahead|carry on|do it|start(?: now)?|begin implementation|start implementation)$/u.test(
      normalized,
    ) ||
    /^(?:ok(?:ay)?|yes|sure|approved|i approve)[, ]+(?:please\s+)?(?:continue|proceed|go ahead|carry on|do it|start(?: now)?|begin implementation|start implementation)$/u.test(
      normalized,
    )
  )
}

/**
 * Recognize corrective follow-ups that refer to the work already on screen.
 * These are not new project tasks; they revise the active result. Keep the
 * patterns anchored to conversational references so a standalone new request
 * still starts a fresh generation.
 */
export function requestsRevisionOfCurrentTaskList(input: string): boolean {
  const normalized = input.replace(/\s+/gu, ' ').trim().toLowerCase()
  if (!normalized || normalized.length > 500) return false

  return (
    /^(?:no|also|and|but|actually|instead|still|again|not yet|(?:it|this|that)\s+still)\b/u.test(
      normalized,
    ) ||
    /\b(?:why did (?:you|u)|i (?:said|asked|meant)|you (?:removed|deleted|changed|forgot|missed))\b/u.test(
      normalized,
    ) ||
    /^(?:please\s+)?(?:fix|change|update|restore|keep|remove|add)\s+(?:it|that|this)\b/u.test(
      normalized,
    ) ||
    /^(?:please\s+)?(?:do not|don't)\s+(?:remove|delete|change|replace|forget)\b/u.test(
      normalized,
    )
  )
}

function shouldKeepCurrentTaskList(input: string): boolean {
  return (
    requestsAppendToCurrentTaskList(input) ||
    requestsContinueCurrentTaskList(input) ||
    requestsRevisionOfCurrentTaskList(input)
  )
}

const ACTION_WORD =
  String.raw`(?:add(?:ed|ing|s)?|audit(?:ed|ing|s)?|build(?:ing|s)?|built|bump(?:ed|ing|s)?|chang(?:e|ed|es|ing)|clean(?:ed|ing|s)?|creat(?:e|ed|es|ing)|debug(?:ged|ging|s)?|delet(?:e|ed|es|ing)|deploy(?:ed|ing|s)?|design(?:ed|ing|s)?|document(?:ed|ing|s)?|fix(?:ed|es|ing)?|implement(?:ed|ing|s)?|integrat(?:e|ed|es|ing)|migrat(?:e|ed|es|ing)|publish(?:ed|es|ing)?|push(?:ed|es|ing)?|refactor(?:ed|ing|s)?|releas(?:e|ed|es|ing)|remov(?:e|ed|es|ing)|renam(?:e|ed|es|ing)|repair(?:ed|ing|s)?|research(?:ed|es|ing)?|review(?:ed|ing|s)?|secur(?:e|ed|es|ing)|test(?:ed|ing|s)?|updat(?:e|ed|es|ing)|upgrad(?:e|ed|es|ing)|verif(?:y|ied|ies|ying)|writ(?:e|es|ing)|wrote)`

const ACTION_RE = new RegExp(String.raw`\b${ACTION_WORD}\b`, 'giu')
const SEQUENCED_ACTION_RE = new RegExp(
  String.raw`\b${ACTION_WORD}\b[^.!?\n]{0,180}(?:\band\b|\bthen\b|\balso\b|\bplus\b|;|\n)[^.!?\n]{0,100}\b${ACTION_WORD}\b`,
  'iu',
)

function withoutCode(input: string): string {
  return input
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`[^`\n]*`/gu, ' ')
}

function proseOnly(input: string): string {
  return withoutCode(input)
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * Decide whether this user turn needs a visible task list before mutation.
 *
 * This is intentionally a conservative structural classifier, not an LLM
 * guess. It recognizes explicit tracking, delegation, high-risk lifecycle
 * work, enumerated/sequenced outcomes, and clearly project-sized requests.
 * A single low-risk action remains direct even after extensive read-only
 * investigation.
 */
export function taskListRequirementReason(
  input: string,
): TaskListRequirementReason | undefined {
  const text = proseOnly(input)
  if (!text) return undefined

  const optsOut =
    /\b(?:do not|don't)\s+(?:(?:create|make|maintain|show|start|use)\s+)?(?:a\s+)?(?:task|todo)(?:\s+(?:list|board))?\b/iu.test(
      text,
    ) ||
    /\bwithout\s+(?:(?:creating|making|maintaining|showing|starting|using)\s+)?(?:a\s+)?(?:task|todo)(?:\s+(?:list|board))?\b/iu.test(
      text,
    ) ||
    /\b(?:skip|no)\s+(?:the\s+|a\s+)?(?:task|todo)(?:\s+(?:list|board))?\b/iu.test(
      text,
    )
  if (optsOut) return undefined

  if (
    /\b(?:create|make|maintain|show|start|use|keep|track|add|append|put|queue)\b[^.!?]{0,100}\b(?:task|todo)\s+(?:list|board)\b/iu.test(
      text,
    ) ||
    /\b(?:add|append|put|queue)\s+(?:this|it)?\s*(?:to|on)?\s*(?:my|the|your)?\s*(?:tasks?|todos?)\b/iu.test(
      text,
    ) ||
    /\b(?:add|append|put|queue)\s+(?:this|it)\s+(?:to|on)\s+(?:the\s+|your\s+|my\s+)?(?:current|existing)\s+list\b/iu.test(
      text,
    ) ||
    /\b(?:create|make|use|track)\s+(?:the\s+|a\s+|your\s+)?(?:tasks?|todos?)\b/iu.test(
      text,
    ) ||
    /\b(?:tasks?|todos?)\s+first\b/iu.test(text)
  ) {
    return 'explicit task tracking request'
  }

  if (
    /^\/plan(?:\s|$)/iu.test(text) ||
    /\b(?:enter|start|use|switch\s+to)\s+plan\s+mode\b/iu.test(text) ||
    /\bplan\s+(?:this|the\s+work|first)\b/iu.test(text)
  ) {
    return 'planning workflow'
  }

  if (
    /\b(?:delegate|delegation|sub[ -]?agents?|parallel\s+agents?|agent\s+team|team\s+of\s+agents?|fan[ -]?out)\b/iu.test(
      text,
    )
  ) {
    return 'delegation or parallel agent work'
  }

  const hasAction = new RegExp(String.raw`\b${ACTION_WORD}\b`, 'iu').test(text)
  if (
    hasAction &&
    /\b(?:publish|release|deploy|production|migrat(?:e|ion)|database\s+schema|credentials?|secrets?|permissions?|sandbox|security|authentication|authorization|payments?|billing|version\s+bump|git\s+tag)\b/iu.test(
      text,
    )
  ) {
    return 'release, security, migration, or production risk'
  }

  const structuralText = withoutCode(input)
  const enumeratedItems = structuralText.match(
    /(?:^|\n)\s*(?:[-*+]\s+|\d+[.)]\s+)\S/gu,
  )
  const actionLines = structuralText
    .split(/\r?\n/gu)
    .filter(line => new RegExp(String.raw`\b${ACTION_WORD}\b`, 'iu').test(line))
  if (
    (enumeratedItems?.length ?? 0) >= 2 ||
    actionLines.length >= 2 ||
    SEQUENCED_ACTION_RE.test(text)
  ) {
    return 'multiple requested outcomes'
  }

  const targetList = new RegExp(
    String.raw`\b${ACTION_WORD}\b[^.!?]{0,120}\b(?:docs?|tests?|code|implementation|configuration|config|workflow|release notes?|technical docs?|readme|ui|api|cli|database|schema|sandbox|permissions?)\b[^.!?]{0,80}(?:,|\band\b|\bplus\b)[^.!?]{0,80}\b(?:docs?|tests?|code|implementation|configuration|config|workflow|release notes?|technical docs?|readme|ui|api|cli|database|schema|sandbox|permissions?)\b`,
    'iu',
  )
  if (targetList.test(text)) return 'multiple requested outcomes'

  const projectScope =
    /\b(?:app|application|agent|system|platform|website|dashboard|service|integration|workflow|codebase|project|plugin|extension|3d\s+(?:scene|design|pipeline))\b/iu
  const projectAction =
    /\b(?:build(?:ing|s)?|built|creat(?:e|ed|es|ing)|design(?:ed|ing|s)?|implement(?:ed|ing|s)?|integrat(?:e|ed|es|ing)|refactor(?:ed|ing|s)?|rewrit(?:e|ing|ten)|overhaul(?:ed|ing|s)?|audit(?:ed|ing|s)?|research(?:ed|es|ing)?)\b/iu
  if (projectScope.test(text) && projectAction.test(text)) {
    return 'large project scope'
  }

  ACTION_RE.lastIndex = 0
  if (text.length >= 600 && ACTION_RE.test(text)) {
    return 'detailed multi-step request'
  }
  return undefined
}

/** Return a generation only for a real user prompt, not meta/task output. */
export function getTaskListRunForCommand(
  command: QueuedCommand | undefined,
  options: { allowSlashCommand?: boolean } = {},
): TaskListRunContext | undefined {
  if (!command || command.mode !== 'prompt' || command.isMeta) return undefined
  const text = textFromQueuedCommand(command)
  if (
    !options.allowSlashCommand &&
    !command.skipSlashCommands &&
    text.trimStart().startsWith('/')
  ) {
    return undefined
  }
  const requirementReason = taskListRequirementReason(text)
  return {
    generationId: String(command.uuid ?? randomUUID()),
    appendToCurrent: shouldKeepCurrentTaskList(text),
    requiresTaskList: requirementReason !== undefined,
    ...(requirementReason ? { requirementReason } : {}),
  }
}

/**
 * Non-REPL callers do not pass through handlePromptSubmit. TaskCreate can use
 * the latest human message as the same stable run boundary in those paths.
 */
export function getTaskListRunFromMessages(
  messages: readonly Message[],
): TaskListRunContext | undefined {
  const message = messages.findLast(isHumanTurn)
  if (!message || typeof message.uuid !== 'string' || !message.uuid) {
    return undefined
  }
  const text = textFromMessage(message)
  const requirementReason = taskListRequirementReason(text)
  return {
    generationId: message.uuid,
    appendToCurrent: shouldKeepCurrentTaskList(text),
    requiresTaskList: requirementReason !== undefined,
    ...(requirementReason ? { requirementReason } : {}),
  }
}
