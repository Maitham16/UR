import type { ModelName } from './model.js'
import type { APIProvider } from './providers.js'

export type ModelConfig = Record<APIProvider, ModelName>
const DEFAULT_OLLAMA_MODEL = 'llama3.2'

// @[MODEL LAUNCH]: Add a new UR_*_CONFIG constant here. Double check the correct model strings
// here since the pattern may change.

export const UR_3_7_SONNET_CONFIG = {
  firstParty: 'claude-3-7-sonnet-20250219',
  bedrock: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
  vertex: 'claude-3-7-sonnet@20250219',
  foundry: 'claude-3-7-sonnet',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_3_5_V2_SONNET_CONFIG = {
  firstParty: 'claude-3-5-sonnet-20241022',
  bedrock: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  vertex: 'claude-3-5-sonnet-v2@20241022',
  foundry: 'claude-3-5-sonnet',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_3_5_HAIKU_CONFIG = {
  firstParty: 'claude-3-5-haiku-20241022',
  bedrock: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
  vertex: 'claude-3-5-haiku@20241022',
  foundry: 'claude-3-5-haiku',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_HAIKU_4_5_CONFIG = {
  firstParty: 'claude-haiku-4-5-20251001',
  bedrock: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  vertex: 'claude-haiku-4-5@20251001',
  foundry: 'claude-haiku-4-5',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_SONNET_4_CONFIG = {
  firstParty: 'claude-sonnet-4-20250514',
  bedrock: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
  vertex: 'claude-sonnet-4@20250514',
  foundry: 'claude-sonnet-4',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_SONNET_4_5_CONFIG = {
  firstParty: 'claude-sonnet-4-5-20250929',
  bedrock: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  vertex: 'claude-sonnet-4-5@20250929',
  foundry: 'claude-sonnet-4-5',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_OPUS_4_CONFIG = {
  firstParty: 'claude-opus-4-20250514',
  bedrock: 'us.anthropic.claude-opus-4-20250514-v1:0',
  vertex: 'claude-opus-4@20250514',
  foundry: 'claude-opus-4',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_OPUS_4_1_CONFIG = {
  firstParty: 'claude-opus-4-1-20250805',
  bedrock: 'us.anthropic.claude-opus-4-1-20250805-v1:0',
  vertex: 'claude-opus-4-1@20250805',
  foundry: 'claude-opus-4-1',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_OPUS_4_5_CONFIG = {
  firstParty: 'claude-opus-4-5-20251101',
  bedrock: 'us.anthropic.claude-opus-4-5-20251101-v1:0',
  vertex: 'claude-opus-4-5@20251101',
  foundry: 'claude-opus-4-5',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_OPUS_4_6_CONFIG = {
  firstParty: 'claude-opus-4-6',
  bedrock: 'us.anthropic.claude-opus-4-6-v1',
  vertex: 'claude-opus-4-6',
  foundry: 'claude-opus-4-6',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_SONNET_4_6_CONFIG = {
  firstParty: 'claude-sonnet-4-6',
  bedrock: 'us.anthropic.claude-sonnet-4-6',
  vertex: 'claude-sonnet-4-6',
  foundry: 'claude-sonnet-4-6',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

// @[MODEL LAUNCH]: Register the new config here.
export const ALL_MODEL_CONFIGS = {
  haiku35: UR_3_5_HAIKU_CONFIG,
  haiku45: UR_HAIKU_4_5_CONFIG,
  sonnet35: UR_3_5_V2_SONNET_CONFIG,
  sonnet37: UR_3_7_SONNET_CONFIG,
  sonnet40: UR_SONNET_4_CONFIG,
  sonnet45: UR_SONNET_4_5_CONFIG,
  sonnet46: UR_SONNET_4_6_CONFIG,
  opus40: UR_OPUS_4_CONFIG,
  opus41: UR_OPUS_4_1_CONFIG,
  opus45: UR_OPUS_4_5_CONFIG,
  opus46: UR_OPUS_4_6_CONFIG,
} as const satisfies Record<string, ModelConfig>

export type ModelKey = keyof typeof ALL_MODEL_CONFIGS

/** Union of all canonical first-party model IDs, e.g. 'ur-opus-4-6' | 'ur-sonnet-4-5-20250929' | … */
export type CanonicalModelId =
  (typeof ALL_MODEL_CONFIGS)[ModelKey]['firstParty']

/** Runtime list of canonical model IDs — used by comprehensiveness tests. */
export const CANONICAL_MODEL_IDS = Object.values(ALL_MODEL_CONFIGS).map(
  c => c.firstParty,
) as [CanonicalModelId, ...CanonicalModelId[]]

/** Map canonical ID → internal short key. Used to apply settings-based modelOverrides. */
export const CANONICAL_ID_TO_KEY: Record<CanonicalModelId, ModelKey> =
  Object.fromEntries(
    (Object.entries(ALL_MODEL_CONFIGS) as [ModelKey, ModelConfig][]).map(
      ([key, cfg]) => [cfg.firstParty, key],
    ),
  ) as Record<CanonicalModelId, ModelKey>
