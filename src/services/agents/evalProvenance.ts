import { createHash } from 'node:crypto'
import {
  CURRENT_PROMPT_LIFECYCLE,
  type PromptLifecycleMetadata,
} from '../../constants/promptLifecycle.js'

export type EvalProvenance = {
  schemaVersion: 1
  /** Semantic prompt metadata only; rendered prompt content is never stored. */
  promptLifecycles: PromptLifecycleMetadata[]
  /** Exact rendered privileged prompt variants observed during the run. */
  promptHashes: string[]
  /** Exact API tool-schema variants observed during the run. */
  toolSchemaHashes: string[]
  /** Context assembly/routing policy variants, excluding task content. */
  contextPolicyHashes: string[]
  /** Model/provider/reasoning configuration variants. */
  modelConfigHashes: string[]
}

type EvalConfiguration = {
  systemPrompt: unknown
  toolSchemas: unknown
  contextPolicy: unknown
  modelConfig: unknown
  /** Override only for controlled prompt experiments. */
  promptLifecycle?: PromptLifecycleMetadata
}

const observed = {
  promptLifecycles: new Map<string, PromptLifecycleMetadata>(),
  promptHashes: new Set<string>(),
  toolSchemaHashes: new Set<string>(),
  contextPolicyHashes: new Set<string>(),
  modelConfigHashes: new Set<string>(),
}

function canonicalize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map(item => canonicalize(item, seen))
  const record = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map(key => [key, canonicalize(record[key], seen)]),
  )
}

export function fingerprintConfigurationPart(value: unknown): string {
  const canonical = JSON.stringify(canonicalize(value))
  return createHash('sha256').update(canonical).digest('hex')
}

/** Record the exact configuration sent by an eval child process. */
export function recordEvalConfiguration(config: EvalConfiguration): void {
  const lifecycle = config.promptLifecycle ?? CURRENT_PROMPT_LIFECYCLE
  observed.promptLifecycles.set(
    fingerprintConfigurationPart(lifecycle),
    lifecycle,
  )
  observed.promptHashes.add(fingerprintConfigurationPart(config.systemPrompt))
  observed.toolSchemaHashes.add(
    fingerprintConfigurationPart(config.toolSchemas),
  )
  observed.contextPolicyHashes.add(
    fingerprintConfigurationPart(config.contextPolicy),
  )
  observed.modelConfigHashes.add(
    fingerprintConfigurationPart(config.modelConfig),
  )
}

export function getEvalProvenanceSnapshot(): EvalProvenance {
  return {
    schemaVersion: 1,
    promptLifecycles: [...observed.promptLifecycles.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, lifecycle]) => lifecycle),
    promptHashes: [...observed.promptHashes].sort(),
    toolSchemaHashes: [...observed.toolSchemaHashes].sort(),
    contextPolicyHashes: [...observed.contextPolicyHashes].sort(),
    modelConfigHashes: [...observed.modelConfigHashes].sort(),
  }
}

export function mergeEvalProvenance(
  values: Array<EvalProvenance | undefined>,
): EvalProvenance | undefined {
  const present = values.filter(
    (value): value is EvalProvenance => value !== undefined,
  )
  if (present.length === 0) return undefined
  return {
    schemaVersion: 1,
    promptLifecycles: [
      ...new Map(
        present
          .flatMap(value => value.promptLifecycles ?? [])
          .map(lifecycle => [
            fingerprintConfigurationPart(lifecycle),
            lifecycle,
          ] as const),
      ).entries(),
    ]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, lifecycle]) => lifecycle),
    promptHashes: [...new Set(present.flatMap(v => v.promptHashes))].sort(),
    toolSchemaHashes: [
      ...new Set(present.flatMap(v => v.toolSchemaHashes)),
    ].sort(),
    contextPolicyHashes: [
      ...new Set(present.flatMap(v => v.contextPolicyHashes)),
    ].sort(),
    modelConfigHashes: [
      ...new Set(present.flatMap(v => v.modelConfigHashes)),
    ].sort(),
  }
}

export function resetEvalProvenanceForTesting(): void {
  observed.promptLifecycles.clear()
  observed.promptHashes.clear()
  observed.toolSchemaHashes.clear()
  observed.contextPolicyHashes.clear()
  observed.modelConfigHashes.clear()
}
