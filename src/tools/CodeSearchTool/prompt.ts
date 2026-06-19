import { GREP_TOOL_NAME } from '../GrepTool/prompt.js'

export const CODE_SEARCH_TOOL_NAME = 'CodeSearch'

export function getDescription(): string {
  return `Semantic code search over a local embedding index of this repository.

Use this to find code by *meaning* when you don't know the exact string to grep for:
- "where is the rate limiter configured", "retry logic for network calls",
  "how are sessions persisted", "the function that validates permissions".

How it relates to ${GREP_TOOL_NAME}:
- ${GREP_TOOL_NAME} finds exact strings / regex. Prefer it when you know the literal token.
- ${CODE_SEARCH_TOOL_NAME} finds semantically related code even when wording differs.
- A good workflow is ${CODE_SEARCH_TOOL_NAME} to locate the right area, then Read/${GREP_TOOL_NAME} to confirm.

Notes:
- Results are ranked by embedding similarity (0..1); higher is more relevant.
- The index is local-first (built via the local Ollama app) and must be built first
  with \`ur code-index build\`. If it is missing or stale, this tool will say so.
- Returns file paths with line ranges and a short preview for each hit.`
}
