import { AsyncLocalStorage } from 'async_hooks'
import { randomUUID } from 'node:crypto'
import type { Message } from '../types/message.js'
import type { QueuedCommand } from '../types/textInputTypes.js'
import { isHumanTurn } from './messagePredicates.js'

export type TaskListRunContext = {
  generationId: string
  appendToCurrent: boolean
}

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
  return {
    generationId: String(command.uuid ?? randomUUID()),
    appendToCurrent: shouldKeepCurrentTaskList(text),
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
  return {
    generationId: message.uuid,
    appendToCurrent: shouldKeepCurrentTaskList(textFromMessage(message)),
  }
}
