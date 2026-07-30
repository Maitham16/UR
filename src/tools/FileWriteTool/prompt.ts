import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js'

export const FILE_WRITE_TOOL_NAME = 'Write'
export const DESCRIPTION = 'Write a file to the local filesystem.'

function getPreReadInstruction(): string {
  return `\n- If this is an existing file, you MUST use the ${FILE_READ_TOOL_NAME} tool first to read the file's contents. This tool will fail if you did not read the file first.`
}

export function getWriteToolDescription(): string {
  return `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.${getPreReadInstruction()}
- For non-trivial work when task tools are available, successful task setup (TaskCreate/TaskUpdate or TodoWrite, whichever is available) must already exist before this call. A feature-rich one-file build is non-trivial. Never batch Write with the task setup it depends on.
- Every call must include both required fields in the same structured invocation: \`file_path\` and the complete literal file text in \`content\`.
- Put the actual file text inside \`content\`; surrounding assistant prose is never copied into the file. Never call Write with only a path, and never invent or recover missing content from prose.
- An empty \`content\` string creates an empty file. Use it only when an empty file is genuinely intended.
- A file is not created or updated until this tool returns a success result. If validation fails, correct the arguments and retry; do not claim the write succeeded.
- Prefer the Edit tool for modifying existing files \u2014 it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`
}
