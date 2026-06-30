/**
 * LSP-backed editing engine for AST-aware repo edits.
 *
 * Wraps the LSP server manager to call `textDocument/prepareRename` and
 * `textDocument/rename`, and normalizes the returned `WorkspaceEdit` into our
 * shared `TextEdit` shape. File content is synced via didOpen/didChange before
 * requests and saved after edits are applied.
 */

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createLSPServerManager, type LSPServerManager } from '../../lsp/LSPServerManager.js'
import type { WorkspaceEdit } from './types.js'
import { workspaceEditFromLsp } from './workspaceEdit.js'

let manager: LSPServerManager | undefined

async function getManager(): Promise<LSPServerManager> {
  if (!manager) {
    manager = createLSPServerManager()
    await manager.initialize()
  }
  return manager
}

export async function shutdownLspManager(): Promise<void> {
  if (manager) {
    await manager.shutdown()
    manager = undefined
  }
}

export async function lspRename(
  root: string,
  file: string,
  line: number,
  column: number,
  newName: string,
): Promise<WorkspaceEdit | null> {
  const mgr = await getManager()
  const abs = file.startsWith('/') ? file : `${root}/${file}`
  const content = readFileSync(abs, 'utf-8')
  await mgr.openFile(abs, content)

  const prepare = await mgr.sendRequest<unknown>(abs, 'textDocument/prepareRename', {
    textDocument: { uri: pathToFileURL(abs).href },
    position: { line: line - 1, character: column - 1 },
  })
  if (!prepare) return null

  const result = await mgr.sendRequest<unknown>(abs, 'textDocument/rename', {
    textDocument: { uri: pathToFileURL(abs).href },
    position: { line: line - 1, character: column - 1 },
    newName,
  })
  if (!result) return null

  return workspaceEditFromLsp(root, result)
}
