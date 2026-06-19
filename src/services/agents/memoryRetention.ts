import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { safeParseJSON } from '../../utils/json.js'

export type MemoryRetentionPolicy = {
  version: 1
  ttlDays?: number
  maxEntries?: number
  decayDays?: number
  updatedAt: string
}

export type MemoryRetentionResult = {
  policy: MemoryRetentionPolicy
  files: Array<{
    file: string
    before: number
    after: number
    removed: number
  }>
}

type JsonRecord = Record<string, unknown>

function memoryDir(cwd: string): string {
  return join(cwd, '.ur', 'memory')
}

function policyPath(cwd: string): string {
  return join(memoryDir(cwd), 'retention.json')
}

export function defaultMemoryRetentionPolicy(): MemoryRetentionPolicy {
  return { version: 1, maxEntries: 1000, updatedAt: new Date().toISOString() }
}

export function loadMemoryRetentionPolicy(cwd: string): MemoryRetentionPolicy {
  const path = policyPath(cwd)
  if (!existsSync(path)) return defaultMemoryRetentionPolicy()
  const parsed = safeParseJSON(readFileSync(path, 'utf-8'), false)
  if (!parsed || typeof parsed !== 'object') return defaultMemoryRetentionPolicy()
  const p = parsed as Partial<MemoryRetentionPolicy>
  return {
    version: 1,
    ttlDays: validPositive(p.ttlDays),
    maxEntries: validPositive(p.maxEntries),
    decayDays: validPositive(p.decayDays),
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : new Date().toISOString(),
  }
}

export function saveMemoryRetentionPolicy(
  cwd: string,
  patch: Partial<Omit<MemoryRetentionPolicy, 'version' | 'updatedAt'>>,
): MemoryRetentionPolicy {
  const current = loadMemoryRetentionPolicy(cwd)
  const next: MemoryRetentionPolicy = {
    version: 1,
    ttlDays: patch.ttlDays === undefined ? current.ttlDays : validPositive(patch.ttlDays),
    maxEntries:
      patch.maxEntries === undefined ? current.maxEntries : validPositive(patch.maxEntries),
    decayDays:
      patch.decayDays === undefined ? current.decayDays : validPositive(patch.decayDays),
    updatedAt: new Date().toISOString(),
  }
  mkdirSync(dirname(policyPath(cwd)), { recursive: true })
  writeFileSync(policyPath(cwd), `${JSON.stringify(next, null, 2)}\n`)
  return next
}

function validPositive(value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}

function timestamp(record: JsonRecord): number {
  const raw = record.ts ?? record.createdAt ?? record.at ?? record.updatedAt
  if (typeof raw !== 'string') return 0
  const time = Date.parse(raw)
  return Number.isFinite(time) ? time : 0
}

function readJsonl(file: string): JsonRecord[] {
  if (!existsSync(file)) return []
  const records: JsonRecord[] = []
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    const parsed = safeParseJSON(line, false)
    if (parsed && typeof parsed === 'object') records.push(parsed as JsonRecord)
  }
  return records
}

function writeJsonl(file: string, records: JsonRecord[]): void {
  writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''))
}

function retentionScore(record: JsonRecord, policy: MemoryRetentionPolicy, nowMs: number): number {
  const ts = timestamp(record)
  if (!policy.decayDays || ts <= 0) return ts
  const ageDays = Math.max(0, (nowMs - ts) / 86_400_000)
  const decay = Math.exp(-ageDays / policy.decayDays)
  return ts * decay
}

function applyPolicy(
  records: JsonRecord[],
  policy: MemoryRetentionPolicy,
  nowMs: number,
): JsonRecord[] {
  let kept = records
  if (policy.ttlDays) {
    const minTime = nowMs - policy.ttlDays * 86_400_000
    kept = kept.filter(record => {
      const ts = timestamp(record)
      return ts <= 0 || ts >= minTime
    })
  }
  if (policy.maxEntries && kept.length > policy.maxEntries) {
    kept = [...kept]
      .sort((a, b) => retentionScore(b, policy, nowMs) - retentionScore(a, policy, nowMs))
      .slice(0, policy.maxEntries)
      .sort((a, b) => timestamp(a) - timestamp(b))
  }
  return kept
}

function memoryJsonlFiles(cwd: string): string[] {
  const dir = memoryDir(cwd)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.jsonl'))
    .map(name => join(dir, name))
}

export function pruneMemoryRetention(
  cwd: string,
  policy = loadMemoryRetentionPolicy(cwd),
  nowMs = Date.now(),
): MemoryRetentionResult {
  const files = memoryJsonlFiles(cwd).map(file => {
    const beforeRecords = readJsonl(file)
    const afterRecords = applyPolicy(beforeRecords, policy, nowMs)
    if (afterRecords.length !== beforeRecords.length) writeJsonl(file, afterRecords)
    return {
      file,
      before: beforeRecords.length,
      after: afterRecords.length,
      removed: beforeRecords.length - afterRecords.length,
    }
  })
  return { policy, files }
}

export function formatMemoryRetention(result: MemoryRetentionResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2)
  const p = result.policy
  const lines = [
    'Memory retention',
    `ttlDays: ${p.ttlDays ?? 'unset'}`,
    `maxEntries: ${p.maxEntries ?? 'unset'}`,
    `decayDays: ${p.decayDays ?? 'unset'}`,
  ]
  if (result.files.length) {
    lines.push('', 'Files:')
    for (const f of result.files) {
      lines.push(`- ${f.file}: ${f.before} -> ${f.after} (${f.removed} removed)`)
    }
  }
  return lines.join('\n')
}
