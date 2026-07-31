/**
 * Intent router.
 *
 * Classifies a free-text task into a category, then recommends the UR subagent
 * best suited to it and (when the work is complex or data-heavy) a multi-agent
 * collaboration pattern. Deterministic and offline by design — it scores
 * keyword/structure signals rather than calling a model, so routing is fast,
 * explainable, and testable. Mirrors magent's planned "intent recognition" node.
 */

export type IntentCategory =
  | 'coding'
  | 'testing'
  | 'review'
  | 'security'
  | 'research'
  | 'browser'
  | 'docs'
  | 'memory'
  | 'explore'
  | 'planning'

type CategoryRule = {
  category: IntentCategory
  agent: string
  keywords: Array<[RegExp, number]>
}

const RULES: CategoryRule[] = [
  {
    category: 'security',
    agent: 'security-auditor',
    keywords: [
      [/\b(security|vulnerab|exploit|injection|cve|malware)\b/i, 3],
      [/\b(auth|authoriz|credential|secret|token|password|sandbox)\b/i, 2],
      [/\b(prompt[\s-]?injection|privilege|permission boundary)\b/i, 2],
    ],
  },
  {
    category: 'testing',
    agent: 'test-runner',
    keywords: [
      [/\b(test|unit test|coverage|assertion)\b/i, 3],
      [/\b(jest|vitest|pytest|mocha|failing test|flaky)\b/i, 2],
      [/\b(typecheck|lint|build|smoke)\b/i, 1],
    ],
  },
  {
    category: 'review',
    agent: 'reviewer',
    keywords: [
      [/\b(review|code review|regression|maintainab)\b/i, 3],
      [/\b(diff|pull request|\bpr\b|critique)\b/i, 2],
    ],
  },
  {
    category: 'browser',
    agent: 'browser-debugger',
    keywords: [
      [/\b(browser|playwright|chrome|screenshot|render)\b/i, 3],
      [/\b(\bui\b|page|css|layout|viewport|visual|frontend)\b/i, 2],
    ],
  },
  {
    category: 'research',
    agent: 'docs-researcher',
    keywords: [
      [/\b(research|investigate|compare|find out|look up)\b/i, 3],
      [/\b(docs|documentation|spec|\bapi\b|reference|latest|changelog of)\b/i, 2],
      [/\b(how does|what is|which|sources?)\b/i, 1],
    ],
  },
  {
    category: 'docs',
    agent: 'release-notes',
    keywords: [
      [/\b(release notes|changelog)\b/i, 3],
      [/\b(document|write docs|readme)\b/i, 2],
    ],
  },
  {
    category: 'memory',
    agent: 'memory-curator',
    keywords: [
      [/\b(remember|memory|consolidate|curate)\b/i, 3],
      [/\b(notes|decisions|conventions)\b/i, 1],
    ],
  },
  {
    category: 'explore',
    agent: 'explore',
    keywords: [
      [/\b(where is|locate|find the file|search the codebase|grep)\b/i, 3],
      [/\b(explore|trace through|how is .* wired)\b/i, 2],
    ],
  },
  {
    category: 'planning',
    agent: 'plan',
    keywords: [
      [/\b(plan|design|architecture|strategy|approach|roadmap)\b/i, 3],
      [/\b(how should (we|i)|break down|decompose)\b/i, 2],
    ],
  },
  {
    category: 'coding',
    agent: 'worker',
    keywords: [
      [/\b(implement|build|add|create|write)\b/i, 2],
      [/\b(fix|bug|refactor|rename|migrate|optimize)\b/i, 3],
      [/\b(function|class|method|module|endpoint|component)\b/i, 1],
    ],
  },
]

export type IntentScore = { category: IntentCategory; agent: string; score: number }

export type RoutePattern = 'peer' | 'doe' | 'concurrent' | 'handoff' | 'debate'

export type RouteResult = {
  task: string
  category: IntentCategory
  agent: string
  pattern: RoutePattern | null
  confidence: number
  complexity: number
  rationale: string
  scores: IntentScore[]
}

function complexitySignals(task: string): number {
  let score = 0
  const conjunctions = task.match(/\b(and|then|after that|also|next|finally)\b/gi)
  score += Math.min(conjunctions?.length ?? 0, 5)
  const numbered = task.match(/(^|\s)\d+[.)]\s/g)
  score += Math.min((numbered?.length ?? 0) * 2, 6)
  const bullets = task.match(/(^|\n)\s*[-*]\s/g)
  score += Math.min(bullets?.length ?? 0, 4)
  if (task.length > 280) score += 2
  if (task.length > 600) score += 2
  return score
}

export function routeIntent(task: string): RouteResult {
  const clean = task.trim()
  const scores: IntentScore[] = RULES.map(rule => {
    let score = 0
    for (const [pattern, weight] of rule.keywords) {
      if (pattern.test(clean)) score += weight
    }
    return { category: rule.category, agent: rule.agent, score }
  }).sort((a, b) => b.score - a.score)

  const top = scores[0]
  const total = scores.reduce((sum, item) => sum + item.score, 0)
  const complexity = complexitySignals(clean)

  // Default to general-purpose coding when nothing matched.
  const matched = top && top.score > 0
  const category: IntentCategory = matched ? top.category : 'coding'
  const agent = matched ? top.agent : 'general-purpose'

  // Pattern selection. Generic multi-step work defaults to PEER; more specific
  // structural cues (explicit parallelism, triage/routing, or a decision between
  // options) override it; and research/data-grounded work always prefers DOE.
  let pattern: RouteResult['pattern'] = null
  let patternReason = 'single agent is sufficient'
  if (complexity >= 4 || (matched && top.score >= 5 && category !== 'research')) {
    pattern = 'peer'
    patternReason = 'multi-step / reasoning-heavy work benefits from PEER (plan-execute-express-review)'
  }
  if (/\b(triage|dispatch|delegate|route (it|this|the)|which (team|specialist|agent)|hand[\s-]?off)\b/i.test(clean)) {
    pattern = 'handoff'
    patternReason = 'routing/triage work benefits from HANDOFF (triage, then delegate to a specialist)'
  } else if (/\b(in parallel|concurrent(ly)?|simultaneously|independently|each of (these|the)|fan[\s-]?out)\b/i.test(clean)) {
    pattern = 'concurrent'
    patternReason = 'independent sub-analyses benefit from CONCURRENT (run in parallel, then synthesize)'
  } else if (/\b(debate|decide between|trade[\s-]?offs?|pros and cons|which (approach|option|design|tool|library) is better|compare .*\b(options|approaches|designs|alternatives))\b/i.test(clean)) {
    pattern = 'debate'
    patternReason = 'a contested decision benefits from DEBATE (propose, critique, moderate)'
  }
  if (category === 'research' || category === 'docs') {
    pattern = 'doe'
    patternReason = 'data/source-grounded work benefits from DOE (data-finding, opinion-inject, express)'
  }

  const confidence = matched
    ? Math.min(0.95, Math.max(0.3, top.score / Math.max(total, top.score + 1)))
    : 0.25

  return {
    task: clean,
    category,
    agent,
    pattern,
    confidence: Number(confidence.toFixed(2)),
    complexity,
    rationale: matched
      ? `matched "${category}" signals; ${patternReason}`
      : `no strong signal; defaulting to a general-purpose agent; ${patternReason}`,
    scores: scores.filter(score => score.score > 0),
  }
}

export function formatRoute(result: RouteResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2)
  const lines = [
    `Task: ${result.task || '<empty>'}`,
    '',
    `Category:   ${result.category}`,
    `Agent:      ${result.agent}`,
    `Pattern:    ${result.pattern ?? 'none (direct dispatch)'}`,
    `Confidence: ${result.confidence}`,
    `Complexity: ${result.complexity}`,
    `Rationale:  ${result.rationale}`,
  ]
  if (result.scores.length > 0) {
    lines.push('')
    lines.push('Signal scores:')
    for (const score of result.scores) {
      lines.push(`  ${score.category.padEnd(10)} ${score.score}  (${score.agent})`)
    }
  }
  lines.push('')
  const dispatch = result.pattern
    ? `ur pattern run ${result.pattern} ${JSON.stringify(result.task || 'your task')}`
    : `Agent({ subagent_type: "${result.agent}", description: "${result.task.slice(0, 40)}", prompt: ${JSON.stringify(result.task)} })`
  lines.push(`Suggested dispatch:\n  ${dispatch}`)
  return lines.join('\n')
}
