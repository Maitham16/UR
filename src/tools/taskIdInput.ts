import { z } from 'zod/v4'

export type TaskIdInput = string | number

/**
 * Input-only schema for model-supplied task IDs.
 *
 * Task IDs remain canonical strings internally and in persisted/output data.
 * JSON numbers are accepted only when converting them to decimal strings is
 * lossless and unambiguous. A transform is intentionally avoided because Zod
 * transforms cannot be represented in the JSON Schema sent to providers.
 */
export function taskIdInputSchema(description: string) {
  return z
    .union([
      z.string().min(1),
      z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    ])
    .describe(description)
}

export function normalizeTaskIdInput(taskId: TaskIdInput): string {
  return String(taskId)
}

export function normalizeTaskIdInputs(
  taskIds: readonly TaskIdInput[] | undefined,
): string[] | undefined {
  return taskIds?.map(normalizeTaskIdInput)
}
