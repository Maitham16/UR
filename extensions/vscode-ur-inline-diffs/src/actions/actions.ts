import * as vscode from 'vscode'
import type { BackgroundTaskItem } from './actionsTreeProvider.js'
import type { Refreshable } from '../diffs/actions.js'
import { workspaceRoot } from '../diffs/store.js'
import { runUrCli } from '../bridge/urCli.js'
import {
  buildBackgroundCancelArgs,
  buildBackgroundRunArgs,
  type BackgroundRunOptions,
} from './background.js'

type LaunchChoice = vscode.QuickPickItem & BackgroundRunOptions

const LAUNCH_CHOICES: LaunchChoice[] = [
  {
    label: '$(git-branch) Isolated worktree',
    description: 'Recommended',
    detail: 'Keep the agent away from uncommitted changes in the active checkout.',
    worktree: true,
    offline: false,
  },
  {
    label: '$(device-desktop) Offline isolated worktree',
    description: 'Local models only',
    detail: 'Use an isolated worktree and disable cloud API dispatch.',
    worktree: true,
    offline: true,
  },
  {
    label: '$(folder-active) Current workspace',
    description: 'Edits the active checkout',
    detail: 'Run directly in this workspace without worktree isolation.',
    worktree: false,
    offline: false,
  },
]

export async function startBackgroundTask(view: Refreshable): Promise<void> {
  const root = workspaceRoot()
  if (!root) {
    await vscode.window.showWarningMessage('Open a workspace folder before starting a UR task.')
    return
  }
  const task = await vscode.window.showInputBox({
    title: 'Start UR Background Task',
    prompt: 'Describe the outcome the background agent should deliver.',
    placeHolder: 'For example: add regression tests for the authentication flow',
    ignoreFocusOut: true,
    validateInput: value => {
      const length = value.trim().length
      if (length === 0) return 'Enter a task.'
      if (length > 64_000) return 'Task descriptions are limited to 64,000 characters.'
      if (value.includes('\0')) return 'Task descriptions cannot contain NUL bytes.'
      return undefined
    },
  })
  if (task === undefined) return

  const choice = await vscode.window.showQuickPick(LAUNCH_CHOICES, {
    title: 'Choose background task isolation',
    placeHolder: 'Isolated worktree (recommended)',
    ignoreFocusOut: true,
  })
  if (!choice) return

  const confirmation = await vscode.window.showWarningMessage(
    `Start this UR background task${choice.worktree ? ' in an isolated worktree' : ' in the current workspace'}?`,
    {
      modal: true,
      detail: 'The task may edit files and use the configured model provider. It will not push or open a pull request.',
    },
    'Start Task',
  )
  if (confirmation !== 'Start Task') return

  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Starting UR background task…',
        cancellable: false,
      },
      () => runUrCli(buildBackgroundRunArgs(task, choice), { cwd: root }),
    )
    let id: string | undefined
    try {
      const parsed = JSON.parse(result.stdout) as { task?: { id?: unknown } }
      if (typeof parsed.task?.id === 'string') id = parsed.task.id
    } catch {
      // A successful older CLI may return text; surface that below without
      // fabricating an id.
    }
    await vscode.window.showInformationMessage(
      id ? `Started UR background task ${id}.` : 'Started UR background task.',
    )
    view.refresh()
  } catch (error) {
    await vscode.window.showErrorMessage(
      `Could not start UR background task: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export async function cancelBackgroundTask(
  item: BackgroundTaskItem | undefined,
  view: Refreshable,
): Promise<void> {
  if (!item || (item.task.status !== 'queued' && item.task.status !== 'running')) {
    await vscode.window.showWarningMessage('Select a queued or running UR background task to cancel.')
    return
  }
  const confirmation = await vscode.window.showWarningMessage(
    `Cancel background task ${item.task.id}?`,
    { modal: true, detail: item.task.task },
    'Cancel Task',
  )
  if (confirmation !== 'Cancel Task') return
  const root = workspaceRoot()
  if (!root) return
  try {
    await runUrCli(buildBackgroundCancelArgs(item.task.id), { cwd: root })
    await vscode.window.showInformationMessage(`Canceled UR background task ${item.task.id}.`)
    view.refresh()
  } catch (error) {
    await vscode.window.showErrorMessage(
      `Could not cancel UR background task: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export async function openBackgroundLog(item: BackgroundTaskItem | undefined): Promise<void> {
  if (!item) {
    await vscode.window.showWarningMessage('Select a UR background task first.')
    return
  }
  const root = workspaceRoot()
  if (!root) return
  try {
    const { stdout } = await runUrCli(
      ['bg', 'logs', item.task.id, '--tail', '2000'],
      { cwd: root },
    )
    const doc = await vscode.workspace.openTextDocument({
      language: 'log',
      content: stdout || `No log output is available for ${item.task.id}.\n`,
    })
    await vscode.window.showTextDocument(doc, { preview: true })
  } catch (error) {
    await vscode.window.showErrorMessage(
      `Could not open background task log: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
