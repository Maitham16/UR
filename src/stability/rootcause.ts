// Lightweight causal root-cause ranking for the Analyze stage (ported from 309).
// Given a failed result, detect symptoms and score candidate causes with a
// transparent prior × likelihood update — the agent analogue of the paper's
// guardrails + causal ranking.
import type { CauseScore } from './types.ts'

interface CauseModel {
  id: string
  label: string
  prior: number
  explains: Record<string, number>
}

const CAUSES: CauseModel[] = [
  { id: 'missing_file', label: 'file or path does not exist', prior: 0.2, explains: { not_found: 6, precondition: 3 } },
  { id: 'bad_path', label: 'path is wrong or outside the workspace', prior: 0.12, explains: { outside: 8, not_found: 2 } },
  { id: 'permission', label: 'insufficient permissions', prior: 0.1, explains: { permission: 8 } },
  { id: 'syntax_error', label: 'syntax or parse error', prior: 0.15, explains: { syntax: 6, exit: 2 } },
  { id: 'missing_dependency', label: 'missing command, module, or dependency', prior: 0.15, explains: { missing: 6, not_found: 3, exit: 2 } },
  { id: 'timeout', label: 'command timed out or hung', prior: 0.08, explains: { timeout: 8, killed: 6 } },
  { id: 'guardrail', label: 'blocked by a safety guardrail', prior: 0.1, explains: { guardrail: 9 } },
  { id: 'runtime_error', label: 'runtime error during execution', prior: 0.1, explains: { exit: 3, error: 2 } },
]

const SYMPTOMS: Array<[string, RegExp]> = [
  ['not_found', /\b(no such file|not found|enoent|cannot find|does(n't| not) exist)\b/i],
  ['outside', /(outside|escapes) the workspace/i],
  ['permission', /\b(permission denied|eacces|not permitted|operation not permitted)\b/i],
  ['syntax', /\b(syntax error|unexpected token|parse error|unexpected end)\b/i],
  ['missing', /\b(command not found|module not found|cannot find module|no module named)\b/i],
  ['timeout', /\b(timed out|timeout)\b/i],
  ['killed', /\bkilled\b/i],
  ['guardrail', /\bguardrail\b/i],
  ['precondition', /precondition/i],
  ['exit', /\bexit\s+[1-9]/i],
  ['error', /\berror\b/i],
]

export function detectSymptoms(text: string): string[] {
  const out: string[] = []
  for (const [name, re] of SYMPTOMS) if (re.test(text)) out.push(name)
  return out
}

/** Rank likely causes for a failure message. Scores are normalised to sum to 1. */
export function rankCauses(errorText: string, topN = 3): CauseScore[] {
  const symptoms = detectSymptoms(errorText)
  const scored = CAUSES.map((c) => {
    let score = c.prior
    for (const s of symptoms) score *= c.explains[s] ?? 0.5
    return { id: c.id, label: c.label, score }
  })
  const total = scored.reduce((sum, c) => sum + c.score, 0) || 1
  return scored
    .map((c) => ({ id: c.id, label: c.label, score: c.score / total }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
}
