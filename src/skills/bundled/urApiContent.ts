// Content for the ur-api bundled skill.
// Each .md file is inlined as a string at build time via Bun's text loader.

import csharpURApi from './ur-api/csharp/ur-api.md'
import curlExamples from './ur-api/curl/examples.md'
import goURApi from './ur-api/go/ur-api.md'
import javaURApi from './ur-api/java/ur-api.md'
import phpURApi from './ur-api/php/ur-api.md'
import pythonAgentSdkPatterns from './ur-api/python/agent-sdk/patterns.md'
import pythonAgentSdkReadme from './ur-api/python/agent-sdk/README.md'
import pythonURApiBatches from './ur-api/python/ur-api/batches.md'
import pythonURApiFilesApi from './ur-api/python/ur-api/files-api.md'
import pythonURApiReadme from './ur-api/python/ur-api/README.md'
import pythonURApiStreaming from './ur-api/python/ur-api/streaming.md'
import pythonURApiToolUse from './ur-api/python/ur-api/tool-use.md'
import rubyURApi from './ur-api/ruby/ur-api.md'
import skillPrompt from './ur-api/SKILL.md'
import sharedErrorCodes from './ur-api/shared/error-codes.md'
import sharedLiveSources from './ur-api/shared/live-sources.md'
import sharedModels from './ur-api/shared/models.md'
import sharedPromptCaching from './ur-api/shared/prompt-caching.md'
import sharedToolUseConcepts from './ur-api/shared/tool-use-concepts.md'
import typescriptAgentSdkPatterns from './ur-api/typescript/agent-sdk/patterns.md'
import typescriptAgentSdkReadme from './ur-api/typescript/agent-sdk/README.md'
import typescriptURApiBatches from './ur-api/typescript/ur-api/batches.md'
import typescriptURApiFilesApi from './ur-api/typescript/ur-api/files-api.md'
import typescriptURApiReadme from './ur-api/typescript/ur-api/README.md'
import typescriptURApiStreaming from './ur-api/typescript/ur-api/streaming.md'
import typescriptURApiToolUse from './ur-api/typescript/ur-api/tool-use.md'

// @[MODEL LAUNCH]: Update the model IDs/names below. These are substituted into {{VAR}}
// placeholders in the .md files at runtime before the skill prompt is sent.
// After updating these constants, manually update the two files that still hardcode models:
//   - ur-api/SKILL.md (Current Models pricing table)
//   - ur-api/shared/models.md (full model catalog with legacy versions and alias mappings)
export const SKILL_MODEL_VARS = {
  MODELO_ID: 'ur-modelO-4-6',
  MODELO_NAME: 'UR modelO 4.6',
  MODELS_ID: 'ur-modelS-4-6',
  MODELS_NAME: 'UR modelS 4.6',
  MODELH_ID: 'ur-modelH-4-5',
  MODELH_NAME: 'UR modelH 4.5',
  // Previous modelS ID — used in "do not append date suffixes" example in SKILL.md.
  PREV_MODELS_ID: 'ur-modelS-4-5',
} satisfies Record<string, string>

export const SKILL_PROMPT: string = skillPrompt

export const SKILL_FILES: Record<string, string> = {
  'csharp/ur-api.md': csharpURApi,
  'curl/examples.md': curlExamples,
  'go/ur-api.md': goURApi,
  'java/ur-api.md': javaURApi,
  'php/ur-api.md': phpURApi,
  'python/agent-sdk/README.md': pythonAgentSdkReadme,
  'python/agent-sdk/patterns.md': pythonAgentSdkPatterns,
  'python/ur-api/README.md': pythonURApiReadme,
  'python/ur-api/batches.md': pythonURApiBatches,
  'python/ur-api/files-api.md': pythonURApiFilesApi,
  'python/ur-api/streaming.md': pythonURApiStreaming,
  'python/ur-api/tool-use.md': pythonURApiToolUse,
  'ruby/ur-api.md': rubyURApi,
  'shared/error-codes.md': sharedErrorCodes,
  'shared/live-sources.md': sharedLiveSources,
  'shared/models.md': sharedModels,
  'shared/prompt-caching.md': sharedPromptCaching,
  'shared/tool-use-concepts.md': sharedToolUseConcepts,
  'typescript/agent-sdk/README.md': typescriptAgentSdkReadme,
  'typescript/agent-sdk/patterns.md': typescriptAgentSdkPatterns,
  'typescript/ur-api/README.md': typescriptURApiReadme,
  'typescript/ur-api/batches.md': typescriptURApiBatches,
  'typescript/ur-api/files-api.md': typescriptURApiFilesApi,
  'typescript/ur-api/streaming.md': typescriptURApiStreaming,
  'typescript/ur-api/tool-use.md': typescriptURApiToolUse,
}
