import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { atomicWriteJson, makeProcessOwner, ownerMayBeAlive, withStateLock, type ProcessOwner } from './durableState.js'

type Role = 'viewer' | 'member' | 'reviewer'
type Member = { role: Role; maxPrompts?: number; secretEnvNames?: string[] }
export type AcpTeamPolicy = {
  version: 1; teamId: string
  budget: { maxPrompts: number; maxConcurrentPrompts: number }
  members: Record<string, Member>
  operator?: { secretEnvNames?: string[] }
  requireReviewedAutomation?: boolean
  automations?: Record<string, { sessionId: string; promptSha256: string; principals: string[]; reviewedBy: string; reviewedAt: string }>
}
type Receipt = { id: string; sessionId: string; requestId: string; principal: string; promptSha256: string; policySha256: string
  status: 'running' | 'completed' | 'failed' | 'unknown'; owner: ProcessOwner; at: string; reviewReasonSha256?: string }
type State = { version: 1; teamId: string; receipts: Record<string, Receipt> }
type Audit = { version: 1; sequence: number; at: string; principal: string; method: string; outcome: string; sessionId?: string; requestId?: string; reviewReasonSha256?: string; policySha256: string; previous: string; sha256: string }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel === '' || rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) }
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/u.test(value)
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0
const names = (value: unknown) => value === undefined || Array.isArray(value) && value.length <= 100 && value.every(name => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
// A name-pattern scrub cannot identify credentials hidden in arbitrary values
// (e.g. authenticated proxy URLs). Team workers inherit only OS/runtime basics
// plus names the administrator explicitly selected for this principal.
const RUNTIME_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'TERM', 'COLORTERM', 'NO_COLOR', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'PATHEXT', 'USERPROFILE',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
  'UR_NPM_PACKAGE_ROOT', 'UR_NPM_LAUNCHER_PATH', 'UR_NPM_NODE_EXECUTABLE', 'UR_NPM_NATIVE_EXECUTABLE']

export class AcpTeamError extends Error {
  constructor(message: string, readonly status = 403) { super(message); this.name = 'AcpTeamError' }
}

/** Policy is server-admin input, never a file supplied by a remote prompt or repository. */
export function loadAcpTeamPolicy(path: string, workspace: string): { policy: AcpTeamPolicy; sha256: string } {
  if (!isAbsolute(path)) throw new AcpTeamError('UR_ACP_TEAM_POLICY must be absolute.')
  const canonical = realpathSync(path), info = lstatSync(canonical)
  if (inside(realpathSync(workspace), canonical) || !info.isFile() || info.size > 256 * 1024 ||
    (process.platform !== 'win32' && (info.mode & 0o022) !== 0)) throw new AcpTeamError('Team policy must be a private administrator-controlled file outside the workspace.')
  const text = readFileSync(canonical, 'utf8'), policy = JSON.parse(text) as AcpTeamPolicy
  if (!policy || policy.version !== 1 || !identifier(policy.teamId) || !policy.budget ||
    !positive(policy.budget.maxPrompts) || policy.budget.maxPrompts > 20000 || !positive(policy.budget.maxConcurrentPrompts) || policy.budget.maxConcurrentPrompts > 1000 ||
    !policy.members || typeof policy.members !== 'object' || Array.isArray(policy.members) ||
    (policy.operator !== undefined && (!policy.operator || !names(policy.operator.secretEnvNames))) ||
    (policy.requireReviewedAutomation !== undefined && typeof policy.requireReviewedAutomation !== 'boolean')) throw new AcpTeamError('Invalid team policy.')
  if (Object.keys(policy.members).length > 1000) throw new AcpTeamError('Team member limit exceeded.')
  for (const [id, member] of Object.entries(policy.members)) {
    if (!identifier(id) || !member || !['viewer', 'member', 'reviewer'].includes(member.role) ||
      (member.maxPrompts !== undefined && !positive(member.maxPrompts)) || !names(member.secretEnvNames)) throw new AcpTeamError('Invalid team member policy.')
  }
  if (policy.automations !== undefined && (!policy.automations || typeof policy.automations !== 'object' || Array.isArray(policy.automations))) throw new AcpTeamError('Invalid reviewed automation registry.')
  for (const [id, automation] of Object.entries(policy.automations ?? {})) {
    if (!identifier(id) || !automation || typeof automation.sessionId !== 'string' || !/^sess_[0-9a-f-]{36}$/u.test(automation.sessionId) ||
      !/^[a-f0-9]{64}$/u.test(automation.promptSha256) || !Array.isArray(automation.principals) || !automation.principals.length ||
      automation.principals.some(value => !identifier(value)) || typeof automation.reviewedBy !== 'string' || !automation.reviewedBy.trim() ||
      !Number.isFinite(Date.parse(automation.reviewedAt))) throw new AcpTeamError('Invalid reviewed automation receipt.')
  }
  return { policy, sha256: hash(text) }
}

/** Opt-in durable request-unit quotas. These are not a dollar-cost estimate. */
export class AcpTeamController {
  readonly policy: AcpTeamPolicy
  readonly policySha256: string
  private readonly statePath: string
  private readonly auditPath: string
  constructor(policyPath: string, workspace: string, privateDirectory: string, private readonly environment: NodeJS.ProcessEnv = process.env) {
    const loaded = loadAcpTeamPolicy(policyPath, workspace)
    this.policy = loaded.policy; this.policySha256 = loaded.sha256
    mkdirSync(privateDirectory, { recursive: true, mode: 0o700 })
    const directory = realpathSync(privateDirectory)
    if (inside(realpathSync(workspace), directory)) throw new AcpTeamError('Team mode requires UR_REMOTE_STATE_DIR outside the writable workspace.')
    if (process.platform !== 'win32' && (lstatSync(directory).mode & 0o077) !== 0) throw new AcpTeamError('Team control state must be private (directory mode 0700).')
    const prefix = `team-${this.policy.teamId}`
    this.statePath = join(directory, `${prefix}.json`); this.auditPath = join(directory, `${prefix}.audit.jsonl`)
  }
  authorize(principal: string, method: string): void {
    if (principal === 'operator') return
    const member = this.policy.members[principal]
    if (!member) throw new AcpTeamError('Device has no team membership.')
    const read = ['initialize', 'session/events', 'session/resume', 'team/status']
    const work = ['session/prompt', 'session/cancel', 'session/close']
    if (read.includes(method) || member.role === 'member' && work.includes(method) || member.role === 'reviewer' && method === 'session/approve') return
    throw new AcpTeamError('Team role does not authorize this operation.')
  }
  private state(): State {
    if (!existsSync(this.statePath)) return { version: 1, teamId: this.policy.teamId, receipts: {} }
    if (lstatSync(this.statePath).size > 8 * 1024 * 1024) throw new AcpTeamError('Team state exceeds its limit.')
    const state = JSON.parse(readFileSync(this.statePath, 'utf8')) as State
    if (state.version !== 1 || state.teamId !== this.policy.teamId || !state.receipts || typeof state.receipts !== 'object' || Array.isArray(state.receipts)) throw new AcpTeamError('Invalid team quota state.')
    for (const [id, receipt] of Object.entries(state.receipts)) if (!receipt || !/^[a-f0-9]{64}$/u.test(id) || receipt.id !== id ||
      !/^sess_[0-9a-f-]{36}$/u.test(receipt.sessionId) || !identifier(receipt.requestId) || !identifier(receipt.principal) ||
      !/^[a-f0-9]{64}$/u.test(receipt.promptSha256) || !/^[a-f0-9]{64}$/u.test(receipt.policySha256) ||
      !receipt.owner || !positive(receipt.owner.pid) || typeof receipt.owner.host !== 'string' || !receipt.owner.host ||
      typeof receipt.owner.token !== 'string' || !Number.isFinite(Date.parse(receipt.at)) ||
      !['running', 'completed', 'failed', 'unknown'].includes(receipt.status)) throw new AcpTeamError('Invalid team quota receipt.')
    return state
  }
  private mutate<T>(operation: (state: State) => T): T {
    return withStateLock(`${this.statePath}.lock`, () => {
      const state = this.state()
      for (const receipt of Object.values(state.receipts)) if (receipt.status === 'running' && !ownerMayBeAlive(receipt.owner)) receipt.status = 'unknown'
      const result = operation(state)
      if (Buffer.byteLength(JSON.stringify(state)) > 8 * 1024 * 1024) throw new AcpTeamError('Team state exceeds its limit.')
      atomicWriteJson(this.statePath, state); return result
    })
  }
  private auditEntries(): Audit[] {
    if (!existsSync(this.auditPath)) return []
    if (lstatSync(this.auditPath).size > 16 * 1024 * 1024) throw new AcpTeamError('Team audit exceeds its limit; archive it before continuing.')
    const text = readFileSync(this.auditPath, 'utf8')
    if (text && !text.endsWith('\n')) throw new AcpTeamError('Team audit contains a torn record.')
    const entries = text.split('\n').filter(Boolean).map(line => JSON.parse(line) as Audit)
    let previous = ''
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!, { sha256, ...body } = entry
      if (entry.version !== 1 || entry.sequence !== index + 1 || entry.previous !== previous || sha256 !== hash(JSON.stringify(body))) throw new AcpTeamError('Team audit chain verification failed.')
      previous = sha256
    }
    return entries
  }
  audit(principal: string, method: string, outcome: string, params?: Record<string, unknown>): void {
    withStateLock(`${this.auditPath}.lock`, () => {
      const entries = this.auditEntries()
      const body: Omit<Audit, 'sha256'> = { version: 1, sequence: entries.length + 1, at: new Date().toISOString(),
        principal: identifier(principal) ? principal : 'unknown', method: /^[a-zA-Z][a-zA-Z0-9_/-]{0,127}$/u.test(method) ? method : 'unknown',
        outcome: /^[a-zA-Z0-9_-]{1,64}$/u.test(outcome) ? outcome : 'unknown', policySha256: this.policySha256, previous: entries.at(-1)?.sha256 ?? '',
        ...(typeof params?.sessionId === 'string' && /^sess_[0-9a-f-]{36}$/u.test(params.sessionId) ? { sessionId: params.sessionId } : {}),
        ...(identifier(params?.requestId) ? { requestId: params.requestId } : {}),
        ...(typeof params?.reviewReasonSha256 === 'string' && /^[a-f0-9]{64}$/u.test(params.reviewReasonSha256) ? { reviewReasonSha256: params.reviewReasonSha256 } : {}) }
      const line = `${JSON.stringify({ ...body, sha256: hash(JSON.stringify(body)) })}\n`
      if ((existsSync(this.auditPath) ? lstatSync(this.auditPath).size : 0) + Buffer.byteLength(line) > 16 * 1024 * 1024) throw new AcpTeamError('Team audit exceeds its limit; archive it before continuing.')
      const fd = openSync(this.auditPath, 'a', 0o600)
      try { appendFileSync(fd, line); fsyncSync(fd) } finally { closeSync(fd) }
    })
  }
  status(principal: string) {
    this.authorize(principal, 'team/status')
    const receipts = Object.values(this.state().receipts).map(receipt => receipt.status === 'running' && !ownerMayBeAlive(receipt.owner) ? { ...receipt, status: 'unknown' as const } : receipt)
    const visible = principal === 'operator' ? receipts : receipts.filter(receipt => receipt.principal === principal)
    return { teamId: this.policy.teamId, unit: 'accepted-prompt-attempts', budget: this.policy.budget,
      consumed: receipts.length, activeOrUnknown: receipts.filter(receipt => receipt.status === 'running' || receipt.status === 'unknown').length,
      principal: { id: principal, consumed: visible.length, unknown: visible.filter(receipt => receipt.status === 'unknown').length },
      ...(principal === 'operator' ? { reservations: receipts.filter(receipt => receipt.status === 'running' || receipt.status === 'unknown').slice(0, 1000)
        .map(receipt => ({ receiptId: receipt.id, principal: receipt.principal, sessionId: receipt.sessionId, status: receipt.status })) } : {}),
      monetaryCost: 'not-measured', policySha256: this.policySha256,
      scope: 'ACP HTTP durable prompt attempts; model subcalls, local CLI and stdio sessions are not separate quota units.',
      credentialScope: 'explicit environment names and private UR config; host files, external CLI login and OS isolation remain separate boundaries.' }
  }
  exportAudit(principal: string, after = 0) {
    if (principal !== 'operator') throw new AcpTeamError('Only the operator may export team audit.')
    if (!Number.isSafeInteger(after) || after < 0) throw new AcpTeamError('Invalid audit cursor.')
    const all = this.auditEntries()
    if (after > all.length) throw new AcpTeamError('Audit cursor is ahead of durable history.')
    const entries = all.slice(after, after + 1000)
    return { version: 1, entries, nextCursor: after + entries.length, done: after + entries.length === all.length,
      attestation: 'local-hash-chain-not-an-external-signature' }
  }
  reconcile(principal: string, receiptId: string, reason: string) {
    if (principal !== 'operator' || !identifier(receiptId) || typeof reason !== 'string' || !reason.trim() || reason.length > 1000) throw new AcpTeamError('Operator reconciliation requires a receipt ID and review reason.')
    const result = this.mutate(state => {
      const receipt = state.receipts[receiptId]
      if (!receipt || receipt.status === 'completed' || receipt.status === 'failed') return { reconciled: false }
      if (ownerMayBeAlive(receipt.owner)) throw new AcpTeamError('Cannot reconcile a reservation whose worker may still be alive.')
      receipt.status = 'failed'; receipt.reviewReasonSha256 = hash(reason); return { reconciled: true }
    })
    this.audit(principal, 'team/reconcile', result.reconciled ? 'reviewed-unknown-release' : 'no-change', { reviewReasonSha256: hash(reason) })
    return result
  }
  reserve(principal: string, params: Record<string, unknown>) {
    this.authorize(principal, 'session/prompt')
    const sessionId = params.sessionId, prompt = params.prompt
    if (params.stream !== true || typeof sessionId !== 'string' || !/^sess_[0-9a-f-]{36}$/u.test(sessionId) || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 128000 || prompt.includes('\0')) throw new AcpTeamError('Team execution requires a durable streaming session and valid prompt.')
    const requestId = params.requestId ?? randomUUID()
    if (!identifier(requestId)) throw new AcpTeamError('Invalid team prompt requestId.')
    params.requestId = requestId
    const promptSha256 = hash(prompt)
    if (this.policy.requireReviewedAutomation || params.automationId !== undefined) {
      const automation = identifier(params.automationId) ? this.policy.automations?.[params.automationId] : undefined
      if (!automation || automation.sessionId !== sessionId || automation.promptSha256 !== promptSha256 || !automation.principals.includes(principal)) throw new AcpTeamError('Prompt/session/principal does not match a reviewed automation receipt.')
    }
    const id = hash(`${sessionId}:${requestId}`)
    let duplicate = false
    this.mutate(state => {
      const prior = state.receipts[id]
      if (prior) {
        if (prior.principal !== principal || prior.promptSha256 !== promptSha256) throw new AcpTeamError('Request ID belongs to a different principal or prompt.')
        duplicate = true; return
      }
      const receipts = Object.values(state.receipts)
      if (receipts.length >= this.policy.budget.maxPrompts) throw new AcpTeamError('Shared team prompt budget exhausted.', 429)
      if (receipts.filter(receipt => receipt.status === 'running' || receipt.status === 'unknown').length >= this.policy.budget.maxConcurrentPrompts) throw new AcpTeamError('Shared concurrent prompt budget exhausted (including unknown effects).', 429)
      const max = this.policy.members[principal]?.maxPrompts
      if (max !== undefined && receipts.filter(receipt => receipt.principal === principal).length >= max) throw new AcpTeamError('Member prompt budget exhausted.', 429)
      state.receipts[id] = { id, sessionId, requestId, principal, promptSha256, policySha256: this.policySha256,
        status: 'running', owner: makeProcessOwner(), at: new Date().toISOString() }
    })
    const allowed = principal === 'operator' ? this.policy.operator?.secretEnvNames ?? [] : this.policy.members[principal]!.secretEnvNames ?? []
    const env: NodeJS.ProcessEnv = {}
    for (const name of [...RUNTIME_ENV, ...allowed]) if (this.environment[name] !== undefined) env[name] = this.environment[name]
    delete env.UR_ACP_TEAM_POLICY; delete env.UR_REMOTE_STATE_DIR; delete env.UR_ACP_TOKEN
    env.UR_CONFIG_DIR = join(dirname(this.statePath), 'team-sessions', sessionId)
    env.UR_CODE_SUBPROCESS_ENV_SCRUB = '1'
    let finished = false
    const finish = (failed = false) => {
      if (duplicate || finished) return
      finished = true
      this.mutate(state => { const receipt = state.receipts[id]; if (receipt) receipt.status = failed ? 'failed' : 'completed' })
      this.audit(principal, 'session/prompt', failed ? 'failed' : 'finished', params)
    }
    return { receiptId: id, duplicate, env, finish }
  }
}
