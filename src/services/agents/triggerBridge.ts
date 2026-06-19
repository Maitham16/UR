/**
 * Inbound trigger bridge.
 *
 * Turns a chat/VCS webhook payload (GitHub issue/PR comment, Slack mention, or a
 * generic JSON envelope) into a decision about whether — and with what prompt —
 * to launch a headless UR run. The parser is deterministic and offline so it can
 * be unit-tested against fixture payloads; the actual run is a separate, opt-in
 * step (`ur trigger run`) that spawns `ur -p`. This is the inbound counterpart to
 * the GitHub Action scaffold and the install-slack-app / install-github-app
 * commands, matching the "mention an agent to dispatch it" pattern.
 */

export type TriggerSource = 'github' | 'slack' | 'generic' | 'unknown'

export type TriggerContext = {
  repo?: string
  issue?: number
  pr?: number
  channel?: string
  threadTs?: string
}

export type TriggerDecision = {
  source: TriggerSource
  triggered: boolean
  reason: string
  keyword: string
  prompt?: string
  actor?: string
  context: TriggerContext
}

export type ParseTriggerOptions = {
  source?: TriggerSource
  /** Mention/command that must appear to trigger a run. Default "/ur". */
  keyword?: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Best-effort source detection from a raw payload's shape. */
export function detectTriggerSource(payload: unknown): TriggerSource {
  const root = asRecord(payload)
  if (asRecord(root.comment).body !== undefined || root.issue !== undefined || root.pull_request !== undefined) {
    return 'github'
  }
  if (root.event !== undefined || root.type === 'event_callback' || asString(root.token) !== undefined) {
    return 'slack'
  }
  if (asString(root.prompt) !== undefined || asString(root.text) !== undefined) {
    return 'generic'
  }
  return 'unknown'
}

/** Extract the prompt that follows the trigger keyword in a body of text. */
export function extractPrompt(body: string, keyword: string): string | undefined {
  const idx = body.toLowerCase().indexOf(keyword.toLowerCase())
  if (idx === -1) return undefined
  const after = body.slice(idx + keyword.length).trim()
  // Strip a leading Slack mention token like <@U123> if present.
  return after.replace(/^<@[^>]+>\s*/, '').trim() || undefined
}

function parseGithub(root: Record<string, unknown>, keyword: string): Omit<TriggerDecision, 'source' | 'keyword'> {
  const comment = asRecord(root.comment)
  const issue = asRecord(root.issue)
  const pull = asRecord(root.pull_request)
  const repo = asRecord(root.repository)
  const sender = asRecord(root.sender)
  const body = asString(comment.body) ?? asString(issue.body) ?? asString(pull.body) ?? ''
  const prompt = extractPrompt(body, keyword)
  const context: TriggerContext = {
    repo: asString(repo.full_name),
    issue: asNumber(issue.number),
    pr: asNumber(pull.number) ?? (issue.pull_request ? asNumber(issue.number) : undefined),
  }
  return {
    triggered: prompt !== undefined,
    reason: prompt ? `GitHub comment contains "${keyword}"` : `no "${keyword}" mention in GitHub payload`,
    prompt,
    actor: asString(sender.login) ?? asString(asRecord(comment.user).login),
    context,
  }
}

function parseSlack(root: Record<string, unknown>, keyword: string): Omit<TriggerDecision, 'source' | 'keyword'> {
  const event = asRecord(root.event)
  const text = asString(event.text) ?? asString(root.text) ?? ''
  const prompt = extractPrompt(text, keyword)
  const context: TriggerContext = {
    channel: asString(event.channel) ?? asString(root.channel),
    threadTs: asString(event.thread_ts) ?? asString(event.ts),
  }
  return {
    triggered: prompt !== undefined,
    reason: prompt ? `Slack message contains "${keyword}"` : `no "${keyword}" mention in Slack payload`,
    prompt,
    actor: asString(event.user) ?? asString(root.user),
    context,
  }
}

function parseGeneric(root: Record<string, unknown>, keyword: string): Omit<TriggerDecision, 'source' | 'keyword'> {
  const direct = asString(root.prompt)
  if (direct) {
    return { triggered: true, reason: 'generic payload carried an explicit prompt', prompt: direct.trim(), context: {} }
  }
  const text = asString(root.text) ?? ''
  const prompt = extractPrompt(text, keyword)
  return {
    triggered: prompt !== undefined,
    reason: prompt ? `generic text contains "${keyword}"` : 'generic payload had no prompt and no keyword match',
    prompt,
    actor: asString(root.actor) ?? asString(root.user),
    context: {},
  }
}

export function parseTriggerPayload(
  payload: unknown,
  options: ParseTriggerOptions = {},
): TriggerDecision {
  const keyword = options.keyword?.trim() || '/ur'
  const source = options.source && options.source !== 'unknown'
    ? options.source
    : detectTriggerSource(payload)
  const root = asRecord(payload)

  let partial: Omit<TriggerDecision, 'source' | 'keyword'>
  if (source === 'github') partial = parseGithub(root, keyword)
  else if (source === 'slack') partial = parseSlack(root, keyword)
  else if (source === 'generic') partial = parseGeneric(root, keyword)
  else {
    partial = { triggered: false, reason: 'could not detect a known payload shape', context: {} }
  }

  return { source, keyword, ...partial }
}

export type TriggerCommandOptions = {
  /** Override the `ur` entry. Defaults to re-invoking this process's CLI. */
  bin?: { file: string; baseArgs: string[] }
  maxTurns?: number
  skipPermissions?: boolean
  outputFormat?: 'json' | 'text' | 'stream-json'
}

/** Build the headless command a triggered decision should run. */
export function buildTriggerCommand(
  prompt: string,
  options: TriggerCommandOptions = {},
): { file: string; args: string[] } {
  const file = options.bin?.file ?? process.execPath
  const baseArgs = options.bin?.baseArgs ?? [process.argv[1] ?? '']
  const args = [...baseArgs, '-p', '--output-format', options.outputFormat ?? 'json']
  if (options.maxTurns && options.maxTurns > 0) args.push('--max-turns', String(options.maxTurns))
  if (options.skipPermissions) args.push('--dangerously-skip-permissions')
  args.push(prompt)
  return { file, args }
}

export function formatTriggerDecision(
  decision: TriggerDecision,
  command: { file: string; args: string[] } | null,
  json: boolean,
): string {
  if (json) return JSON.stringify({ decision, command }, null, 2)
  const lines = [
    `Source:    ${decision.source}`,
    `Keyword:   ${decision.keyword}`,
    `Triggered: ${decision.triggered ? 'yes' : 'no'}`,
    `Reason:    ${decision.reason}`,
  ]
  if (decision.actor) lines.push(`Actor:     ${decision.actor}`)
  const ctx = decision.context
  const ctxParts = [
    ctx.repo ? `repo=${ctx.repo}` : null,
    ctx.issue ? `issue=#${ctx.issue}` : null,
    ctx.pr ? `pr=#${ctx.pr}` : null,
    ctx.channel ? `channel=${ctx.channel}` : null,
  ].filter(Boolean)
  if (ctxParts.length) lines.push(`Context:   ${ctxParts.join(' ')}`)
  if (decision.prompt) lines.push(`Prompt:    ${decision.prompt}`)
  if (command) lines.push('', `Command:   ${command.file} ${command.args.join(' ')}`)
  return lines.join('\n')
}
