import type { ModelName } from './model.js'
import type { APIProvider } from './providers.js'

export type ModelConfig = Record<APIProvider, ModelName>
const DEFAULT_OLLAMA_MODEL = 'qwen3-coder:480b-cloud'

// @[MODEL LAUNCH]: Add a new UR_*_CONFIG constant here. Double check the correct model strings
// here since the pattern may change.

export const UR_3_7_MODELS_CONFIG = {
  firstParty: 'ur-3-7-modelS-20250219',
  bedrock: 'us.urhq.ur-3-7-modelS-20250219-v1:0',
  vertex: 'ur-3-7-modelS@20250219',
  foundry: 'ur-3-7-modelS',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_3_5_V2_MODELS_CONFIG = {
  firstParty: 'ur-3-5-modelS-20241022',
  bedrock: 'urhq.ur-3-5-modelS-20241022-v2:0',
  vertex: 'ur-3-5-modelS-v2@20241022',
  foundry: 'ur-3-5-modelS',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_3_5_MODELH_CONFIG = {
  firstParty: 'ur-3-5-modelH-20241022',
  bedrock: 'us.urhq.ur-3-5-modelH-20241022-v1:0',
  vertex: 'ur-3-5-modelH@20241022',
  foundry: 'ur-3-5-modelH',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_MODELH_4_5_CONFIG = {
  firstParty: 'ur-modelH-4-5-20251001',
  bedrock: 'us.urhq.ur-modelH-4-5-20251001-v1:0',
  vertex: 'ur-modelH-4-5@20251001',
  foundry: 'ur-modelH-4-5',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_MODELS_4_CONFIG = {
  firstParty: 'ur-modelS-4-20250514',
  bedrock: 'us.urhq.ur-modelS-4-20250514-v1:0',
  vertex: 'ur-modelS-4@20250514',
  foundry: 'ur-modelS-4',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_MODELS_4_5_CONFIG = {
  firstParty: 'ur-modelS-4-5-20250929',
  bedrock: 'us.urhq.ur-modelS-4-5-20250929-v1:0',
  vertex: 'ur-modelS-4-5@20250929',
  foundry: 'ur-modelS-4-5',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_MODELO_4_CONFIG = {
  firstParty: 'ur-modelO-4-20250514',
  bedrock: 'us.urhq.ur-modelO-4-20250514-v1:0',
  vertex: 'ur-modelO-4@20250514',
  foundry: 'ur-modelO-4',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_MODELO_4_1_CONFIG = {
  firstParty: 'ur-modelO-4-1-20250805',
  bedrock: 'us.urhq.ur-modelO-4-1-20250805-v1:0',
  vertex: 'ur-modelO-4-1@20250805',
  foundry: 'ur-modelO-4-1',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_MODELO_4_5_CONFIG = {
  firstParty: 'ur-modelO-4-5-20251101',
  bedrock: 'us.urhq.ur-modelO-4-5-20251101-v1:0',
  vertex: 'ur-modelO-4-5@20251101',
  foundry: 'ur-modelO-4-5',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_MODELO_4_6_CONFIG = {
  firstParty: 'ur-modelO-4-6',
  bedrock: 'us.urhq.ur-modelO-4-6-v1',
  vertex: 'ur-modelO-4-6',
  foundry: 'ur-modelO-4-6',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_MODELS_4_6_CONFIG = {
  firstParty: 'ur-modelS-4-6',
  bedrock: 'us.urhq.ur-modelS-4-6',
  vertex: 'ur-modelS-4-6',
  foundry: 'ur-modelS-4-6',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

// @[MODEL LAUNCH]: Register the new config here.
export const ALL_MODEL_CONFIGS = {
  modelH35: UR_3_5_MODELH_CONFIG,
  modelH45: UR_MODELH_4_5_CONFIG,
  modelS35: UR_3_5_V2_MODELS_CONFIG,
  modelS37: UR_3_7_MODELS_CONFIG,
  modelS40: UR_MODELS_4_CONFIG,
  modelS45: UR_MODELS_4_5_CONFIG,
  modelS46: UR_MODELS_4_6_CONFIG,
  modelO40: UR_MODELO_4_CONFIG,
  modelO41: UR_MODELO_4_1_CONFIG,
  modelO45: UR_MODELO_4_5_CONFIG,
  modelO46: UR_MODELO_4_6_CONFIG,
} as const satisfies Record<string, ModelConfig>

export type ModelKey = keyof typeof ALL_MODEL_CONFIGS

/** Union of all canonical first-party model IDs, e.g. 'ur-modelO-4-6' | 'ur-modelS-4-5-20250929' | … */
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
