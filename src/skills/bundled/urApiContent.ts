// Content for the ur-api bundled skill.
// Each .md file is inlined as a string at build time via Bun's text loader.

import csharpURApi from './claude-api/csharp/claude-api.md'
import curlExamples from './claude-api/curl/examples.md'
import goURApi from './claude-api/go/claude-api.md'
import javaURApi from './claude-api/java/claude-api.md'
import phpURApi from './claude-api/php/claude-api.md'
import pythonAgentSdkPatterns from './claude-api/python/agent-sdk/patterns.md'
import pythonAgentSdkReadme from './claude-api/python/agent-sdk/README.md'
import pythonURApiBatches from './claude-api/python/claude-api/batches.md'
import pythonURApiFilesApi from './claude-api/python/claude-api/files-api.md'
import pythonURApiReadme from './claude-api/python/claude-api/README.md'
import pythonURApiStreaming from './claude-api/python/claude-api/streaming.md'
import pythonURApiToolUse from './claude-api/python/claude-api/tool-use.md'
import rubyURApi from './claude-api/ruby/claude-api.md'
import skillPrompt from './claude-api/SKILL.md'
import sharedErrorCodes from './claude-api/shared/error-codes.md'
import sharedLiveSources from './claude-api/shared/live-sources.md'
import sharedModels from './claude-api/shared/models.md'
import sharedPromptCaching from './claude-api/shared/prompt-caching.md'
import sharedToolUseConcepts from './claude-api/shared/tool-use-concepts.md'
import typescriptAgentSdkPatterns from './claude-api/typescript/agent-sdk/patterns.md'
import typescriptAgentSdkReadme from './claude-api/typescript/agent-sdk/README.md'
import typescriptURApiBatches from './claude-api/typescript/claude-api/batches.md'
import typescriptURApiFilesApi from './claude-api/typescript/claude-api/files-api.md'
import typescriptURApiReadme from './claude-api/typescript/claude-api/README.md'
import typescriptURApiStreaming from './claude-api/typescript/claude-api/streaming.md'
import typescriptURApiToolUse from './claude-api/typescript/claude-api/tool-use.md'

// @[MODEL LAUNCH]: Update the model IDs/names below. These are substituted into {{VAR}}
// placeholders in the .md files at runtime before the skill prompt is sent.
// After updating these constants, manually update the two files that still hardcode models:
//   - ur-api/SKILL.md (Current Models pricing table)
//   - ur-api/shared/models.md (full model catalog with legacy versions and alias mappings)
export const SKILL_MODEL_VARS = {
  OPUS_ID: 'claude-opus-4-6',
  OPUS_NAME: 'UR Opus 4.6',
  SONNET_ID: 'claude-sonnet-4-6',
  SONNET_NAME: 'UR Sonnet 4.6',
  HAIKU_ID: 'claude-haiku-4-5',
  HAIKU_NAME: 'UR Haiku 4.5',
  // Previous Sonnet ID — used in "do not append date suffixes" example in SKILL.md.
  PREV_SONNET_ID: 'claude-sonnet-4-5',
} satisfies Record<string, string>

export const SKILL_PROMPT: string = skillPrompt

export const SKILL_FILES: Record<string, string> = {
  'csharp/claude-api.md': csharpURApi,
  'curl/examples.md': curlExamples,
  'go/claude-api.md': goURApi,
  'java/claude-api.md': javaURApi,
  'php/claude-api.md': phpURApi,
  'python/agent-sdk/README.md': pythonAgentSdkReadme,
  'python/agent-sdk/patterns.md': pythonAgentSdkPatterns,
  'python/claude-api/README.md': pythonURApiReadme,
  'python/claude-api/batches.md': pythonURApiBatches,
  'python/claude-api/files-api.md': pythonURApiFilesApi,
  'python/claude-api/streaming.md': pythonURApiStreaming,
  'python/claude-api/tool-use.md': pythonURApiToolUse,
  'ruby/claude-api.md': rubyURApi,
  'shared/error-codes.md': sharedErrorCodes,
  'shared/live-sources.md': sharedLiveSources,
  'shared/models.md': sharedModels,
  'shared/prompt-caching.md': sharedPromptCaching,
  'shared/tool-use-concepts.md': sharedToolUseConcepts,
  'typescript/agent-sdk/README.md': typescriptAgentSdkReadme,
  'typescript/agent-sdk/patterns.md': typescriptAgentSdkPatterns,
  'typescript/claude-api/README.md': typescriptURApiReadme,
  'typescript/claude-api/batches.md': typescriptURApiBatches,
  'typescript/claude-api/files-api.md': typescriptURApiFilesApi,
  'typescript/claude-api/streaming.md': typescriptURApiStreaming,
  'typescript/claude-api/tool-use.md': typescriptURApiToolUse,
}
