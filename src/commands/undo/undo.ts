import type { LocalCommandResult } from '../../commands.js'
import type { ToolUseContext } from '../../Tool.js'
import { fileHistoryUndoLastEdit } from '../../utils/fileHistory.js'

export async function call(
  _args: string,
  context: ToolUseContext,
): Promise<LocalCommandResult> {
  const restoredPath = await fileHistoryUndoLastEdit(
    context.updateFileHistoryState,
  )
  if (restoredPath) {
    return {
      type: 'text',
      value: `Undone: restored ${restoredPath} to its state before the last edit (a file created by the last edit is deleted). Use /rewind for full conversation + code checkpoint restore.`,
    }
  }
  return {
    type: 'text',
    value: 'Nothing to undo — no tracked file edits found, or the most recent file is already at its pre-edit state. Use /rewind to restore to a specific checkpoint.',
  }
}