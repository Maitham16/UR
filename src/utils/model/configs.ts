import type { ModelName } from './model.js'
import type { APIProvider } from './providers.js'

export type ModelConfig = Record<APIProvider, ModelName>
const DEFAULT_OLLAMA_MODEL = 'qwen2.5-coder:7b'

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
  firstParty: 'modelH',
  bedrock: 'modelH',
  vertex: 'modelH',
  foundry: 'modelH',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_MODELS_4_CONFIG = {
  firstParty: 'modelS',
  bedrock: 'modelS',
  vertex: 'modelS',
  foundry: 'modelS',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_MODELS_4_5_CONFIG = {
  firstParty: 'modelS',
  bedrock: 'modelS',
  vertex: 'modelS',
  foundry: 'modelS',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_MODELO_4_CONFIG = {
  firstParty: 'modelO',
  bedrock: 'modelO',
  vertex: 'modelO',
  foundry: 'modelO',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_MODELO_4_1_CONFIG = {
  firstParty: 'modelO',
  bedrock: 'modelO',
  vertex: 'modelO',
  foundry: 'modelO',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_MODELO_4_5_CONFIG = {
  firstParty: 'modelO',
  bedrock: 'modelO',
  vertex: 'modelO',
  foundry: 'modelO',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_MODELO_4_6_CONFIG = {
  firstParty: 'modelO',
  bedrock: 'modelO',
  vertex: 'modelO',
  foundry: 'modelO',
  ollama: DEFAULT_OLLAMA_MODEL,
} as const satisfies ModelConfig

export const UR_MODELS_4_6_CONFIG = {
  firstParty: 'modelS',
  bedrock: 'modelS',
  vertex: 'modelS',
  foundry: 'modelS',
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

/** Union of legacy model aliases retained for compatibility. */
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
