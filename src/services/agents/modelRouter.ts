/**
 * Capability-aware model router.
 *
 * Builds on `model-doctor`: it classifies a task (via the intent router) and
 * scores the locally installed Ollama models by how well their advertised /
 * inferred capabilities fit that task — vision for screenshot/UI work, code
 * readiness for coding, large context for long inputs, embeddings for memory /
 * retrieval indexing. Deterministic and offline by design: the scoring takes the
 * model list as input so it is testable without a running Ollama, and the
 * recommendation degrades to "no local model" rather than guessing when the
 * model list is empty. Mirrors magent's planned per-task model selection node.
 */

import type { ModelCapability } from '../../commands/model-doctor/model-doctor.js'
import {
  classifyTaskComplexity,
  pickBestCoderModel,
  pickSmallFastModel,
} from '../../utils/model/ollamaRouter.js'
import { type IntentCategory, routeIntent } from './intentRouter.js'

export type ModelNeed = 'vision' | 'code' | 'long-context' | 'embeddings'

export type ModelScore = {
  name: string
  score: number
  reasons: string[]
}

export type ModelRouteResult = {
  task: string
  category: IntentCategory
  needs: ModelNeed[]
  recommended: string | null
  rationale: string
  ranked: ModelScore[]
}

const LONG_CONTEXT_THRESHOLD = 32_000

/** Derive the capability needs a task implies from its text and category. */
export function deriveModelNeeds(
  task: string,
  category: IntentCategory,
): ModelNeed[] {
  const needs = new Set<ModelNeed>()
  const clean = task.toLowerCase()

  if (
    category === 'browser' ||
    /\b(screenshot|image|photo|diagram|vision|visual|ui|chart|pixel|ocr)\b/.test(
      clean,
    )
  ) {
    needs.add('vision')
  }
  if (
    category === 'coding' ||
    category === 'testing' ||
    category === 'review' ||
    /\b(code|implement|refactor|function|class|bug|compile)\b/.test(clean)
  ) {
    needs.add('code')
  }
  if (
    category === 'memory' ||
    /\b(embed|embedding|index|retriev|semantic search|vector)\b/.test(clean)
  ) {
    needs.add('embeddings')
  }
  if (task.length > 2_000 || /\b(whole (repo|codebase|file)|entire|long)\b/.test(clean)) {
    needs.add('long-context')
  }
  return [...needs]
}

/** Score one model against the derived needs. Higher is a better fit. */
export function scoreModel(
  model: ModelCapability,
  needs: ModelNeed[],
): ModelScore {
  const reasons: string[] = []
  let score = 0

  for (const need of needs) {
    if (need === 'vision') {
      if (model.likelyVision) {
        score += 5
        reasons.push('vision-capable')
      } else {
        score -= 4
        reasons.push('no vision support (penalized)')
      }
    }
    if (need === 'code') {
      if (model.likelyCode) {
        score += 3
        reasons.push('code-tuned')
      }
    }
    if (need === 'embeddings') {
      if (model.embeddingLength && model.embeddingLength > 0) {
        score += 4
        reasons.push(`embeddings (dim ${model.embeddingLength})`)
      } else {
        score -= 2
      }
    }
    if (need === 'long-context') {
      if (model.contextLength && model.contextLength >= LONG_CONTEXT_THRESHOLD) {
        score += 3
        reasons.push(`large context (${model.contextLength})`)
      } else if (model.contextLength) {
        reasons.push(`context ${model.contextLength}`)
      }
    }
  }

  // Gentle tie-breakers that apply even with no specific needs: prefer models
  // that advertise tool use and a usable context window.
  if (model.advertisedCapabilities.includes('tools')) {
    score += 1
    reasons.push('advertises tools')
  }
  if (model.contextLength && model.contextLength >= LONG_CONTEXT_THRESHOLD) {
    score += 0.5
  }

  return { name: model.name, score: Number(score.toFixed(2)), reasons }
}

export function recommendModel(
  task: string,
  models: ModelCapability[],
): ModelRouteResult {
  const route = routeIntent(task)
  const needs = deriveModelNeeds(task, route.category)

  const ranked = models
    .map(model => scoreModel(model, needs))
    .sort((a, b) => b.score - a.score)

  const top = ranked[0] ?? null
  // A vision task with no vision model is a hard miss; surface it explicitly.
  const visionMissing =
    needs.includes('vision') &&
    !models.some(model => model.likelyVision)

  let rationale: string
  if (!top) {
    rationale =
      'No local Ollama models found. Start Ollama or pull a model, then re-run.'
  } else if (needs.length === 0) {
    rationale = `No special capability needs detected for a "${route.category}" task; any installed model should work.`
  } else if (visionMissing) {
    rationale = `This task needs vision but no installed model is vision-capable. Best available fallback is ${top.name}; consider pulling a vision model (e.g. llava, minicpm-v).`
  } else {
    rationale = `Needs ${needs.join(', ')}; ${top.name} fits best (${top.reasons.join('; ') || 'default'}).`
  }

  return {
    task: task.trim(),
    category: route.category,
    needs,
    recommended: top?.name ?? null,
    rationale,
    ranked,
  }
}

export type RouteStrategy = 'auto' | 'cheap' | 'strong' | 'default'

export type ModelPool = {
  cheap?: string[]
  strong?: string[]
  default?: string[]
}

export function resolveModelForTask(
  task: string,
  strategy: RouteStrategy,
  pool: ModelPool,
  localModels: ModelCapability[],
): string | undefined {
  if (strategy === 'default') return pool.default?.[0]
  const localNames = localModels.map(m => m.name)
  if (strategy === 'cheap') {
    return pickSmallFastModel(localNames, undefined) ?? pool.cheap?.[0] ?? pool.default?.[0]
  }
  if (strategy === 'strong') {
    return pickBestCoderModel(localNames, undefined) ?? pool.strong?.[0] ?? pool.default?.[0]
  }
  return classifyTaskComplexity(task) === 'simple'
    ? resolveModelForTask(task, 'cheap', pool, localModels)
    : resolveModelForTask(task, 'strong', pool, localModels)
}

export function formatModelRoute(result: ModelRouteResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2)
  const lines = [
    `Task: ${result.task || '<empty>'}`,
    '',
    `Category:    ${result.category}`,
    `Capability needs: ${result.needs.length ? result.needs.join(', ') : 'none detected'}`,
    `Recommended: ${result.recommended ?? 'none (no local model)'}`,
    `Rationale:   ${result.rationale}`,
  ]
  if (result.ranked.length > 0) {
    lines.push('')
    lines.push('Ranked models:')
    for (const model of result.ranked) {
      lines.push(
        `  ${model.name.padEnd(28)} ${String(model.score).padStart(6)}  ${model.reasons.join('; ')}`,
      )
    }
  }
  if (result.recommended) {
    lines.push('')
    lines.push(`Suggested launch:\n  UR_MODEL=${result.recommended} ur -p ${JSON.stringify(result.task || 'your task')}`)
  }
  return lines.join('\n')
}
