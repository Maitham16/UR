import { GREP_TOOL_NAME } from '../GrepTool/prompt.js'

export const CODE_SEARCH_TOOL_NAME = 'CodeSearch'

export function getDescription(): string {
  return `Hybrid code search over a local index of this repository.

Use this to find code by *meaning* when you don't know the exact string to grep for:
- "where is the rate limiter configured", "retry logic for network calls",
  "how are sessions persisted", "the function that validates permissions".

How it relates to ${GREP_TOOL_NAME}:
- ${GREP_TOOL_NAME} finds exact strings / regex. Prefer it when you know the literal token.
- ${CODE_SEARCH_TOOL_NAME} combines text, symbol and dependency matches; available embeddings also recall semantically related code when wording differs.
- A good workflow is ${CODE_SEARCH_TOOL_NAME} to locate the right area, then Read/${GREP_TOOL_NAME} to confirm.

Notes:
- Results use a hybrid relevance score, not a probability. Higher is more relevant.
- Optional embeddings use the configured Ollama app. Lexical/structural retrieval remains available when embeddings are unavailable. The index must be built first
  with \`ur code-index build\`. Changed/deleted source chunks are excluded and reported; rebuild to retrieve their current content. Coverage and embedding availability are reported.
- Returns file paths with line ranges and a short preview for each hit.`
}
