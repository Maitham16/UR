import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import { promisify } from 'node:util'
import * as vscode from 'vscode'
import { runUrCli } from '../bridge/urCli.js'
import { errorMessage, processErrorMessage } from '../util/format.js'
import type { DiffTreeItem } from './treeProvider.js'
import { loadManifest, patchPath, workspaceRoot, writeBundleMetadata, writeManifest } from './store.js'

const execFileAsync = promisify(execFile)

/** Narrow structural interface so any tree/list that shows diff bundles
 * (the inline diff tree, the actions panel) can share these actions without
 * depending on a concrete provider class. */
export interface Refreshable {
  refresh(): void
}

export async function commentDiff(item: DiffTreeItem | undefined, provider: Refreshable): Promise<void> {
  const root = workspaceRoot()
  const bundle = item?.bundle
  if (!root || !bundle) {
    vscode.window.showWarningMessage('No UR inline diff selected.')
    return
  }
  const text = await vscode.window.showInputBox({
    title: `Comment on ${bundle.id}`,
    prompt: 'Comment text',
    ignoreFocusOut: true,
  })
  if (!text?.trim()) return

  const manifest = loadManifest(root)
  const manifestBundle = manifest.diffs.find(diff => diff.id === bundle.id)
  if (!manifestBundle) {
    vscode.window.showErrorMessage(`UR inline diff not found: ${bundle.id}`)
    return
  }
  const at = new Date().toISOString()
  manifestBundle.status = 'commented'
  manifestBundle.updatedAt = at
  manifestBundle.comments = [...(manifestBundle.comments ?? []), { at, text: text.trim() }]
  writeManifest(root, manifest)
  writeBundleMetadata(root, manifestBundle)
  provider.refresh()
  vscode.window.showInformationMessage(`Added UR comment to ${bundle.id}.`)
}

// Applies the captured patch to the working tree via `git apply` (the CLI's
// `approve` action only records status — it never touches the working tree),
// then records the approval through `ur ide diff approve <id>` so the status
// written to disk is always one IdeDiffStatus accepts. Never silently
// "applied" — the CLI never issues that status value.
export async function applyDiff(item: DiffTreeItem | undefined, provider: Refreshable): Promise<void> {
  const root = workspaceRoot()
  const bundle = item?.bundle
  if (!root || !bundle) {
    vscode.window.showWarningMessage('No UR inline diff selected.')
    return
  }
  const patch = patchPath(root, bundle)
  if (!fs.existsSync(patch)) {
    vscode.window.showErrorMessage(`UR patch file missing for ${bundle.id}.`)
    return
  }
  const choice = await vscode.window.showWarningMessage(
    `Apply UR patch ${bundle.id} to your working tree? This modifies ${bundle.files?.length ?? 0} file(s).`,
    { modal: true },
    'Apply',
  )
  if (choice !== 'Apply') return

  try {
    await execFileAsync('git', ['apply', '--whitespace=nowarn', patch], { cwd: root, shell: false })
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to apply UR patch ${bundle.id}: ${processErrorMessage(error)}`)
    return
  }

  try {
    const { stdout } = await runUrCli(['ide', 'diff', 'approve', bundle.id], { cwd: root })
    provider.refresh()
    if (isNotFoundResult(stdout)) {
      vscode.window.showWarningMessage(
        `Applied ${bundle.id} to disk, but no matching diff record was found to mark it approved.`,
      )
      return
    }
    vscode.window.showInformationMessage(`Applied UR patch ${bundle.id}.`)
  } catch (error) {
    vscode.window.showErrorMessage(
      `Applied ${bundle.id} to disk, but failed to record approval: ${errorMessage(error)}`,
    )
  }
}

export async function rejectDiff(item: DiffTreeItem | undefined, provider: Refreshable): Promise<void> {
  const root = workspaceRoot()
  const bundle = item?.bundle
  if (!root || !bundle) {
    vscode.window.showWarningMessage('No UR inline diff selected.')
    return
  }
  try {
    const { stdout } = await runUrCli(['ide', 'diff', 'reject', bundle.id], { cwd: root })
    provider.refresh()
    if (isNotFoundResult(stdout)) {
      vscode.window.showErrorMessage(`UR inline diff not found: ${bundle.id}`)
      return
    }
    vscode.window.showInformationMessage(`Rejected UR patch ${bundle.id} (no files changed).`)
  } catch (error) {
    vscode.window.showErrorMessage(errorMessage(error))
  }
}

export async function showStatus(channel: vscode.OutputChannel): Promise<void> {
  const root = workspaceRoot()
  if (!root) {
    vscode.window.showWarningMessage('Open a workspace folder to query UR status.')
    return
  }
  channel.clear()
  channel.show(true)
  channel.appendLine('Running: ur ide status')
  try {
    const { stdout } = await runUrCli(['ide', 'status'], { cwd: root })
    channel.appendLine(stdout.trim())
  } catch (error) {
    channel.appendLine(errorMessage(error))
  }
}

function isNotFoundResult(stdout: string): boolean {
  return stdout.trim().toLowerCase().includes('not found')
}
