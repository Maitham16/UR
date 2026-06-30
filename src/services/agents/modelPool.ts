/**
 * Model pool configuration for capability-aware routing.
 *
 * Loads cheap/strong/default model pools from project config, environment, or
 * sensible defaults. Actual resolution is still driven by UR_MODEL semantics in
 * the rest of the app; this file just names the pool.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeParseJSON } from '../../utils/json.js'

export type ModelPool = {
  cheap?: string[]
  strong?: string[]
  default?: string[]
}

const DEFAULT_POOL: ModelPool = {
  cheap: ['qwen2.5-coder:1.5b', 'gemma2:2b'],
  strong: ['qwen2.5-coder:32b', 'codex', 'claude-3-5-sonnet', 'gpt-4o'],
  default: ['qwen2.5-coder'],
}

export function loadModelPool(cwd: string): ModelPool {
  const file = join(cwd, '.ur', 'model-pool.json')
  if (existsSync(file)) {
    const parsed = safeParseJSON(readFileSync(file, 'utf-8'), false)
    if (parsed && typeof parsed === 'object') {
      const object = parsed as Record<string, unknown>
      return {
        cheap: readStringArray(object.cheap),
        strong: readStringArray(object.strong),
        default: readStringArray(object.default),
      }
    }
  }

  const env = process.env
  return {
    cheap: readEnvList(env.UR_MODEL_POOL_CHEAP) ?? DEFAULT_POOL.cheap,
    strong: readEnvList(env.UR_MODEL_POOL_STRONG) ?? DEFAULT_POOL.strong,
    default: readEnvList(env.UR_MODEL_POOL_DEFAULT) ?? DEFAULT_POOL.default,
  }
}

function readStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  return undefined
}

function readEnvList(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  return value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}
