// Orchestrates the chat panel: owns the active session, staged context
// attachments, the in-flight urProcess turn, and pending permission
// prompts. This is the one place chat commands, editor actions, and the
// webview's postMessage traffic all converge — deliberately a single
// pathway per the PR's "reuse the same chat pathway" requirement.

import { randomUUID } from 'node:crypto'
import * as vscode from 'vscode'
import type {
  ChatContentBlock,
  ChatMessage,
  ChatRole,
  ChatSession,
  ChatSessionRecord,
  ControlRequestEnvelope,
  PermissionDecision,
  StdoutMessage,
} from '../bridge/types.js'
import { isControlCancelRequest } from '../bridge/types.js'
import { resolveUrCommand } from '../bridge/urCommand.js'
import { readUrCommandConfig } from '../bridge/urCli.js'
import { runUrTurn, type UrTurnHandle, type UrTurnResult } from '../bridge/urProcess.js'
import {
  buildPromptWithAttachments,
  captureEditorSnapshot,
  describeUnavailableReason,
  type ContextAttachment,
  type SelectionSnapshot,
} from '../context/ideContext.js'
import { workspaceRoot } from '../diffs/store.js'
import { appendMessage, createSession, listSessions, readSession, setCliSessionId } from '../sessions/sessionStore.js'
import { ChatPanel, toWireAttachment, type WebviewInboundMessage } from './chatPanel.js'
import { extractAssistantContentBlocks, extractToolResultContentBlocks } from './messageMapping.js'
import { buildExplainPrompt, buildFixPrompt, buildGenerateTestsPrompt } from './prompts.js'

type PendingPermission = {
  resolve: (decision: PermissionDecision) => void
  toolName: string
  input: Record<string, unknown>
  turnId: number
}

export class ChatController implements vscode.Disposable {
  private readonly _onDidChangeState = new vscode.EventEmitter<void>()
  readonly onDidChangeState = this._onDidChangeState.event

  private panel: ChatPanel | undefined
  private record: ChatSessionRecord | undefined
  private attachments: ContextAttachment[] = []
  private status: 'idle' | 'running' | 'canceled' | 'error' = 'idle'
  private turnHandle: UrTurnHandle | undefined
  private activeTurnId = 0
  private readonly pendingPermissions = new Map<string, PendingPermission>()

  // --- commands ---

  async newChat(): Promise<void> {
    const root = this.requireWorkspaceRoot()
    if (!root) return
    this.turnHandle?.cancel()
    this.activeTurnId++
    this.turnHandle = undefined
    this.denyAllPending('A new chat was started.')
    this.record = createSession(root)
    this.attachments = []
    this.status = 'idle'
    this._onDidChangeState.fire()
    this.ensurePanel()
    this.syncFullState()
  }

  async openChat(): Promise<void> {
    const root = this.requireWorkspaceRoot()
    if (!root) return
    if (this.record) {
      this.ensurePanel()
      this.syncFullState()
      return
    }
    const sessions = listSessions(root)
    if (sessions.length === 0) {
      await this.newChat()
      return
    }
    const picked = await this.pickSession(sessions)
    if (picked === undefined) return
    if (picked === 'new') {
      await this.newChat()
      return
    }
    const record = readSession(root, picked)
    if (!record) {
      await this.newChat()
      return
    }
    this.record = record
    this.ensurePanel()
    this.syncFullState()
  }

  cancelCurrentRequest(): void {
    if (!this.turnHandle || this.status !== 'running') {
      vscode.window.showInformationMessage('No UR chat request is currently running.')
      return
    }
    this.turnHandle.cancel()
    this.denyAllPending('Request was canceled.')
  }

  addCurrentFileToChat(): void {
    this.stageAttachment('file')
  }

  addSelectionToChat(): void {
    this.stageAttachment('selection')
  }

  isRequestRunning(): boolean {
    return this.status === 'running'
  }

  async explainSelection(): Promise<void> {
    await this.runEditorAction(buildExplainPrompt)
  }

  async fixSelection(): Promise<void> {
    await this.runEditorAction(buildFixPrompt)
  }

  async generateTestsForSelection(): Promise<void> {
    await this.runEditorAction(buildGenerateTestsPrompt)
  }

  async sendMessage(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return
    const prompt = buildPromptWithAttachments(trimmed, this.attachments)
    this.attachments = []
    this.panel?.post({ type: 'attachmentsChanged', attachments: [] })
    await this.dispatchTurn(prompt)
  }

  /** Opens chat and runs a fully-formed prompt through the same pathway as a
   * manual send — used by Review Current Diff and Run Verifier so neither
   * command invents a second way to talk to UR. */
  async runStructuredPrompt(promptText: string): Promise<void> {
    await this.dispatchTurn(promptText)
  }

  dispose(): void {
    this.turnHandle?.cancel()
    this.denyAllPending('Extension is shutting down.')
    this._onDidChangeState.dispose()
  }

  // --- internals ---

  private requireWorkspaceRoot(): string | undefined {
    const root = workspaceRoot()
    if (!root) {
      vscode.window.showWarningMessage('Open a workspace folder to use UR Chat.')
      return undefined
    }
    return root
  }

  private ensurePanel(): void {
    if (!ChatPanel.isOpen) {
      this.panel = ChatPanel.createOrShow(message => this.handleWebviewMessage(message))
    }
  }

  private async pickSession(sessions: ChatSession[]): Promise<string | 'new' | undefined> {
    type SessionQuickPickItem = vscode.QuickPickItem & { id: string | 'new' }
    const items: SessionQuickPickItem[] = [
      { id: 'new', label: '$(add) Start New Chat' },
      ...sessions.map(
        (session): SessionQuickPickItem => ({
          id: session.id,
          label: session.title,
          description: new Date(session.updatedAt).toLocaleString(),
        }),
      ),
    ]
    const picked = await vscode.window.showQuickPick(items, {
      title: 'UR Chat',
      placeHolder: 'Resume a chat or start a new one',
    })
    return picked?.id
  }

  private stageAttachment(kind: 'file' | 'selection'): void {
    const snapshot = captureEditorSnapshot()
    const reason = describeUnavailableReason(snapshot, kind)
    if (reason) {
      vscode.window.showWarningMessage(reason)
      return
    }
    if (this.record && snapshot.workspaceRoot !== this.record.session.workspaceRoot) {
      vscode.window.showWarningMessage('The active file belongs to a different workspace folder. Start a new chat for that folder.')
      return
    }
    const attachment: ContextAttachment =
      kind === 'file' ? { kind: 'file', file: snapshot.activeFile! } : { kind: 'selection', selection: snapshot.selection! }
    this.attachments.push(attachment)
    this.ensurePanel()
    this.panel?.post({ type: 'attachmentsChanged', attachments: this.attachments.map(toWireAttachment) })
  }

  private async runEditorAction(build: (selection: SelectionSnapshot) => string): Promise<void> {
    const root = this.requireWorkspaceRoot()
    if (!root) return
    const snapshot = captureEditorSnapshot()
    const reason = describeUnavailableReason(snapshot, 'selection')
    if (reason) {
      vscode.window.showWarningMessage(reason)
      return
    }
    await this.dispatchTurn(build(snapshot.selection!))
  }

  /** The single pathway every turn goes through — manual sends and editor
   * actions alike. */
  private async dispatchTurn(promptText: string): Promise<void> {
    const root = this.record?.session.workspaceRoot ?? this.requireWorkspaceRoot()
    if (!root) return
    if (this.status === 'running') {
      vscode.window.showWarningMessage('UR is already running a request. Cancel it first or wait for it to finish.')
      return
    }
    if (!this.record) this.record = createSession(root)
    this.ensurePanel()

    const sessionId = this.record.session.id
    const userMessage: ChatMessage = {
      id: randomUUID(),
      sessionId,
      role: 'user',
      content: [{ type: 'text', text: promptText }],
      createdAt: new Date().toISOString(),
    }
    appendMessage(root, sessionId, userMessage)
    this.record.messages.push(userMessage)
    this.panel?.post({ type: 'messageAppended', message: userMessage })

    this.status = 'running'
    this._onDidChangeState.fire()
    this.panel?.post({ type: 'statusChanged', status: this.status })

    const resumeSessionId = this.record.session.cliSessionId
    const turnId = ++this.activeTurnId
    let exitedSynchronously = false

    const handle = runUrTurn(
      { cwd: root, prompt: promptText, resumeSessionId },
      {
        onMessage: message => this.handleStreamMessage(root, sessionId, turnId, message),
        onControlRequest: request => this.handlePermissionRequest(turnId, request),
        onExit: result => {
          exitedSynchronously = true
          this.handleTurnExit(root, sessionId, turnId, result)
        },
      },
      { executable: resolveUrCommand({ cwd: root, config: readUrCommandConfig() }) },
    )
    this.turnHandle = exitedSynchronously ? undefined : handle
  }

  private handleStreamMessage(root: string, sessionId: string, turnId: number, message: StdoutMessage): void {
    if (turnId !== this.activeTurnId) return
    if (message.type === 'system' && message.subtype === 'init' && typeof message.session_id === 'string') {
      if (this.record && this.record.session.id === sessionId && !this.record.session.cliSessionId) {
        setCliSessionId(root, sessionId, message.session_id)
        this.record.session.cliSessionId = message.session_id
      }
      return
    }
    if (message.type === 'assistant') {
      const blocks = extractAssistantContentBlocks(message)
      if (blocks.length > 0) this.appendChatMessage(root, sessionId, 'assistant', blocks)
      return
    }
    if (message.type === 'user') {
      const blocks = extractToolResultContentBlocks(message)
      if (blocks.length > 0) this.appendChatMessage(root, sessionId, 'status', blocks)
      return
    }
    if (isControlCancelRequest(message)) {
      const pending = this.pendingPermissions.get(message.request_id)
      if (pending) {
        this.pendingPermissions.delete(message.request_id)
        pending.resolve({ behavior: 'deny', message: 'Permission request was canceled.' })
      }
      this.panel?.post({ type: 'permissionResolved', requestId: message.request_id })
    }
    // control_request is answered via onControlRequest; `result` is handled
    // via onExit/UrTurnResult; anything else (keep_alive, control_response
    // echoes) is intentionally not rendered.
  }

  private appendChatMessage(root: string, sessionId: string, role: ChatRole, content: ChatContentBlock[]): void {
    if (!this.record || this.record.session.id !== sessionId) return
    const message: ChatMessage = { id: randomUUID(), sessionId, role, content, createdAt: new Date().toISOString() }
    appendMessage(root, sessionId, message)
    this.record.messages.push(message)
    this.panel?.post({ type: 'messageAppended', message })
  }

  private appendStatusText(root: string, text: string): void {
    if (!this.record) return
    this.appendChatMessage(root, this.record.session.id, 'status', [{ type: 'text', text }])
  }

  private handlePermissionRequest(turnId: number, request: ControlRequestEnvelope): Promise<PermissionDecision> {
    if (turnId !== this.activeTurnId) {
      return Promise.resolve({ behavior: 'deny', message: 'This chat turn is no longer active.' })
    }
    return new Promise(resolve => {
      const toolName = request.request.tool_name ?? 'tool'
      const input = request.request.input ?? {}
      this.pendingPermissions.set(request.request_id, { resolve, toolName, input, turnId })
      this.panel?.post({ type: 'permissionRequest', requestId: request.request_id, toolName, input })
    })
  }

  private handleTurnExit(root: string, sessionId: string, turnId: number, result: UrTurnResult): void {
    if (turnId !== this.activeTurnId) return
    this.turnHandle = undefined
    this.denyAllPending('The chat turn ended before this request was answered.')
    if (result.canceled) {
      this.status = 'canceled'
      this.appendChatMessage(root, sessionId, 'status', [{ type: 'text', text: 'Canceled.' }])
    } else if (!result.ok) {
      this.status = 'error'
      const message = result.error ?? 'UR failed to complete this turn.'
      this.appendChatMessage(root, sessionId, 'status', [{ type: 'text', text: `Error: ${message}` }])
      this.panel?.post({ type: 'errorBanner', message })
    } else {
      this.status = 'idle'
    }
    this._onDidChangeState.fire()
    this.panel?.post({ type: 'statusChanged', status: this.status })
  }

  private resolvePermission(requestId: string, decision: 'allow' | 'deny'): void {
    const pending = this.pendingPermissions.get(requestId)
    if (!pending || pending.turnId !== this.activeTurnId) return
    this.pendingPermissions.delete(requestId)
    pending.resolve(
      decision === 'allow'
        ? { behavior: 'allow', updatedInput: pending.input }
        : { behavior: 'deny', message: 'User denied this tool call from the UR Chat panel.' },
    )
    this.panel?.post({ type: 'permissionResolved', requestId })
    const root = this.record?.session.workspaceRoot
    if (root) this.appendStatusText(root, `${decision === 'allow' ? 'Allowed' : 'Denied'} ${pending.toolName}.`)
  }

  private denyAllPending(reason: string): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      pending.resolve({ behavior: 'deny', message: reason })
      this.panel?.post({ type: 'permissionResolved', requestId })
    }
    this.pendingPermissions.clear()
  }

  private handleWebviewMessage(message: WebviewInboundMessage): void {
    if (message.type === 'ready') {
      this.syncFullState()
      return
    }
    if (message.type === 'send') {
      void this.sendMessage(message.text)
      return
    }
    if (message.type === 'cancel') {
      this.cancelCurrentRequest()
      return
    }
    if (message.type === 'permissionDecision') {
      this.resolvePermission(message.requestId, message.decision)
      return
    }
    if (message.type === 'removeAttachment') {
      this.attachments.splice(message.index, 1)
      this.panel?.post({ type: 'attachmentsChanged', attachments: this.attachments.map(toWireAttachment) })
    }
  }

  private syncFullState(): void {
    if (!this.record) return
    this.ensurePanel()
    this.panel?.post({
      type: 'init',
      session: this.record.session,
      messages: this.record.messages,
      status: this.status,
      attachments: this.attachments.map(toWireAttachment),
    })
  }
}
