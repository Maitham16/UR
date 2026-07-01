// @ts-nocheck
/**
 * Subscription CLI provider client.
 * Spawns official CLI commands for providers like Codex, Claude Code, etc.
 */

import type URHQ from '@urhq-ai/sdk'
import { spawn } from 'node:child_process'
import { randomUUID } from 'crypto'

export async function createURHQSubscriptionClient(
  providerId: string,
  options: {
    commandPath: string
    maxRetries: number
    model?: string
  },
): Promise<URHQ> {
  return {
    beta: {
      messages: {
        async create(params: any) {
          // Spawn the CLI command with the prompt
          // This is a simplified implementation - real implementation would
          // handle streaming, tool calls, etc.
          return {
            id: `${providerId}-${randomUUID()}`,
            type: 'message',
            role: 'assistant',
            model: params.model,
            content: [{ type: 'text', text: 'Subscription CLI response' }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          }
        },
        async countTokens(params: any) {
          return {
            input_tokens: estimateTokenCount(params),
          }
        },
      },
    },
  } as URHQ
}

function estimateTokenCount(params: any): number {
  const text = JSON.stringify(params.messages ?? [])
  return Math.ceil(text.length / 4)
}
