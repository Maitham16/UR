// Chat webview panel. Unlike the read-only diff preview (diffs/webview.ts,
// enableScripts: false), this view needs interactivity — composer, cancel,
// permission approve/deny — so scripts are enabled behind a nonce'd CSP.
// This module only renders and relays postMessage traffic; all state and
// decisions live in chat/chatController.ts.

import * as vscode from 'vscode'
import type { ChatMessage, ChatSession } from '../bridge/types.js'
import type { ContextAttachment } from '../context/ideContext.js'
import { formatAttachmentLabel } from '../context/ideContext.js'

export type ChatStatus = 'idle' | 'running' | 'canceled' | 'error'

/** Wire shape for an attachment chip — the label is computed extension-side
 * via the already-tested formatAttachmentLabel() so the webview never has to
 * re-implement that formatting in JS. */
export interface WireAttachment {
  label: string
}

export type WebviewInboundMessage =
  | { type: 'ready' }
  | { type: 'send'; text: string }
  | { type: 'cancel' }
  | { type: 'permissionDecision'; requestId: string; decision: 'allow' | 'deny' }
  | { type: 'removeAttachment'; index: number }

export type WebviewOutboundMessage =
  | { type: 'init'; session: ChatSession; messages: ChatMessage[]; status: ChatStatus; attachments: WireAttachment[] }
  | { type: 'messageAppended'; message: ChatMessage }
  | { type: 'statusChanged'; status: ChatStatus }
  | { type: 'permissionRequest'; requestId: string; toolName: string; input: unknown }
  | { type: 'permissionResolved'; requestId: string }
  | { type: 'attachmentsChanged'; attachments: WireAttachment[] }
  | { type: 'errorBanner'; message: string }
  | { type: 'sessionRenamed'; title: string }

export class ChatPanel {
  private static current: ChatPanel | undefined

  private readonly panel: vscode.WebviewPanel
  private disposed = false
  private readonly disposables: vscode.Disposable[] = []

  private constructor(panel: vscode.WebviewPanel, onMessage: (message: WebviewInboundMessage) => void) {
    this.panel = panel
    this.panel.webview.html = renderChatHtml(this.panel.webview)
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: WebviewInboundMessage) => onMessage(message)),
      this.panel.onDidDispose(() => this.handleDispose()),
    )
  }

  static createOrShow(onMessage: (message: WebviewInboundMessage) => void): ChatPanel {
    if (ChatPanel.current && !ChatPanel.current.disposed) {
      ChatPanel.current.panel.reveal(vscode.ViewColumn.Beside)
      return ChatPanel.current
    }
    const panel = vscode.window.createWebviewPanel('urChat', 'UR Chat', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
    })
    const instance = new ChatPanel(panel, onMessage)
    ChatPanel.current = instance
    return instance
  }

  static get isOpen(): boolean {
    return Boolean(ChatPanel.current && !ChatPanel.current.disposed)
  }

  post(message: WebviewOutboundMessage): void {
    if (this.disposed) return
    void this.panel.webview.postMessage(message)
  }

  private handleDispose(): void {
    this.disposed = true
    for (const disposable of this.disposables) disposable.dispose()
    if (ChatPanel.current === this) ChatPanel.current = undefined
  }
}

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let value = ''
  for (let i = 0; i < 32; i++) value += chars.charAt(Math.floor(Math.random() * chars.length))
  return value
}

function renderChatHtml(webview: vscode.Webview): string {
  const scriptNonce = nonce()
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${scriptNonce}'`,
  ].join('; ')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      font: 13px/1.5 var(--vscode-font-family);
      color: var(--vscode-foreground);
      margin: 0;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }
    #banner {
      display: none;
      padding: 8px 14px;
      background: var(--vscode-inputValidation-errorBackground);
      border-bottom: 1px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));
    }
    #banner.visible { display: block; }
    #messages { flex: 1; overflow-y: auto; padding: 14px; }
    #empty-state { color: var(--vscode-descriptionForeground); padding: 24px 4px; }
    #empty-state code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
    .message { margin-bottom: 14px; }
    .message .role {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }
    .message.user .bubble { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); }
    .message.assistant .bubble { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); }
    .message.status .bubble { background: transparent; border: 1px dashed var(--vscode-panel-border); color: var(--vscode-descriptionForeground); font-style: italic; }
    .bubble { border-radius: 6px; padding: 10px 12px; white-space: pre-wrap; word-break: break-word; }
    .tool-block {
      margin-top: 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 8px 10px;
      background: var(--vscode-textCodeBlock-background);
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
    }
    .tool-block .tool-name { font-weight: 600; }
    .tool-block.result.ok { border-left: 3px solid var(--vscode-testing-iconPassed, #2ea043); }
    .tool-block.result.fail { border-left: 3px solid var(--vscode-testing-iconFailed, #f14c4c); }
    #permission-prompt {
      display: none;
      margin: 0 14px 14px;
      padding: 12px;
      border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-panel-border));
      background: var(--vscode-inputValidation-warningBackground, var(--vscode-sideBar-background));
      border-radius: 6px;
    }
    #permission-prompt.visible { display: block; }
    #permission-prompt .input-preview {
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      background: var(--vscode-textCodeBlock-background);
      padding: 6px 8px;
      border-radius: 4px;
      margin: 6px 0;
      max-height: 120px;
      overflow: auto;
      white-space: pre-wrap;
    }
    #permission-prompt .actions { display: flex; gap: 8px; margin-top: 8px; }
    #attachments { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 14px; }
    .attachment-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 12px;
      padding: 2px 10px;
      font-size: 12px;
    }
    .attachment-chip button { border: none; background: none; color: inherit; cursor: pointer; font-size: 13px; line-height: 1; padding: 0; }
    #status-line { padding: 4px 14px; font-size: 12px; color: var(--vscode-descriptionForeground); min-height: 18px; }
    #composer { display: flex; gap: 8px; padding: 10px 14px 14px; border-top: 1px solid var(--vscode-panel-border); }
    #input {
      flex: 1;
      resize: none;
      min-height: 36px;
      max-height: 160px;
      font: inherit;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
      border-radius: 4px;
      padding: 8px;
    }
    button {
      font: inherit;
      border: none;
      border-radius: 4px;
      padding: 8px 14px;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    button:disabled { opacity: 0.5; cursor: default; }
  </style>
</head>
<body>
  <div id="banner"></div>
  <div id="messages">
    <div id="empty-state">Ask UR about this workspace. Use <code>UR: Add Selection to Chat</code> or <code>UR: Add Current File to Chat</code> to attach code first.</div>
  </div>
  <div id="permission-prompt">
    <div><strong>UR wants to use <span id="permission-tool"></span></strong></div>
    <div class="input-preview" id="permission-input"></div>
    <div class="actions">
      <button id="permission-allow">Allow</button>
      <button id="permission-deny" class="secondary">Deny</button>
    </div>
  </div>
  <div id="attachments"></div>
  <div id="status-line"></div>
  <form id="composer">
    <textarea id="input" placeholder="Message UR…" rows="2"></textarea>
    <button id="send" type="submit">Send</button>
    <button id="cancel" type="button" class="secondary" hidden>Cancel</button>
  </form>
  <script nonce="${scriptNonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const messagesEl = document.getElementById('messages');
      const emptyStateEl = document.getElementById('empty-state');
      const bannerEl = document.getElementById('banner');
      const statusLineEl = document.getElementById('status-line');
      const attachmentsEl = document.getElementById('attachments');
      const permissionEl = document.getElementById('permission-prompt');
      const permissionToolEl = document.getElementById('permission-tool');
      const permissionInputEl = document.getElementById('permission-input');
      const composerEl = document.getElementById('composer');
      const inputEl = document.getElementById('input');
      const sendButton = document.getElementById('send');
      const cancelButton = document.getElementById('cancel');

      let currentStatus = 'idle';
      let pendingPermissionRequestId = null;

      function escapeHtml(text) {
        return String(text)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      function renderContentBlock(block) {
        if (block.type === 'text') {
          return '<div>' + escapeHtml(block.text) + '</div>';
        }
        if (block.type === 'tool_use') {
          return '<div class="tool-block use"><span class="tool-name">' + escapeHtml(block.name) + '</span><div>' + escapeHtml(JSON.stringify(block.input, null, 2)) + '</div></div>';
        }
        if (block.type === 'tool_result') {
          const cls = block.ok ? 'ok' : 'fail';
          return '<div class="tool-block result ' + cls + '"><span class="tool-name">' + (block.ok ? 'Tool result' : 'Tool failed') + '</span><div>' + escapeHtml(block.summary) + '</div></div>';
        }
        if (block.type === 'permission_request') {
          const resolved = block.resolved ? ' — ' + block.resolved : ' — pending';
          return '<div class="tool-block"><span class="tool-name">Permission: ' + escapeHtml(block.toolName) + '</span>' + escapeHtml(resolved) + '</div>';
        }
        return '';
      }

      function appendMessageEl(message) {
        emptyStateEl.style.display = 'none';
        const wrapper = document.createElement('div');
        wrapper.className = 'message ' + message.role;
        const roleLabel = document.createElement('div');
        roleLabel.className = 'role';
        roleLabel.textContent = message.role;
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerHTML = message.content.map(renderContentBlock).join('');
        wrapper.appendChild(roleLabel);
        wrapper.appendChild(bubble);
        messagesEl.appendChild(wrapper);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      function renderAll(messages) {
        messagesEl.innerHTML = '';
        if (messages.length === 0) {
          messagesEl.appendChild(emptyStateEl);
          emptyStateEl.style.display = 'block';
          return;
        }
        for (const message of messages) appendMessageEl(message);
      }

      function renderAttachments(attachments) {
        attachmentsEl.innerHTML = '';
        attachments.forEach(function (attachment, index) {
          const chip = document.createElement('span');
          chip.className = 'attachment-chip';
          const label = document.createElement('span');
          label.textContent = attachment.label;
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.textContent = '\\u00d7';
          remove.addEventListener('click', function () {
            vscode.postMessage({ type: 'removeAttachment', index: index });
          });
          chip.appendChild(label);
          chip.appendChild(remove);
          attachmentsEl.appendChild(chip);
        });
      }

      function applyStatus(status) {
        currentStatus = status;
        const running = status === 'running';
        sendButton.disabled = running;
        cancelButton.hidden = !running;
        if (status === 'idle') statusLineEl.textContent = '';
        else if (status === 'running') statusLineEl.textContent = 'Running…';
        else if (status === 'canceled') statusLineEl.textContent = 'Canceled.';
        else if (status === 'error') statusLineEl.textContent = 'UR reported an error. See above.';
      }

      function showBanner(message) {
        bannerEl.textContent = message;
        bannerEl.classList.add('visible');
      }

      window.addEventListener('message', function (event) {
        const message = event.data;
        if (message.type === 'init') {
          renderAll(message.messages);
          renderAttachments(message.attachments);
          applyStatus(message.status);
        } else if (message.type === 'messageAppended') {
          appendMessageEl(message.message);
        } else if (message.type === 'statusChanged') {
          applyStatus(message.status);
        } else if (message.type === 'permissionRequest') {
          pendingPermissionRequestId = message.requestId;
          permissionToolEl.textContent = message.toolName;
          permissionInputEl.textContent = JSON.stringify(message.input, null, 2);
          permissionEl.classList.add('visible');
        } else if (message.type === 'permissionResolved') {
          if (pendingPermissionRequestId === message.requestId) {
            pendingPermissionRequestId = null;
            permissionEl.classList.remove('visible');
          }
        } else if (message.type === 'attachmentsChanged') {
          renderAttachments(message.attachments);
        } else if (message.type === 'errorBanner') {
          showBanner(message.message);
        } else if (message.type === 'sessionRenamed') {
          document.title = message.title;
        }
      });

      composerEl.addEventListener('submit', function (event) {
        event.preventDefault();
        const text = inputEl.value.trim();
        if (!text || currentStatus === 'running') return;
        vscode.postMessage({ type: 'send', text: text });
        inputEl.value = '';
      });

      inputEl.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          composerEl.requestSubmit();
        }
      });

      cancelButton.addEventListener('click', function () {
        vscode.postMessage({ type: 'cancel' });
      });

      document.getElementById('permission-allow').addEventListener('click', function () {
        if (!pendingPermissionRequestId) return;
        vscode.postMessage({ type: 'permissionDecision', requestId: pendingPermissionRequestId, decision: 'allow' });
      });
      document.getElementById('permission-deny').addEventListener('click', function () {
        if (!pendingPermissionRequestId) return;
        vscode.postMessage({ type: 'permissionDecision', requestId: pendingPermissionRequestId, decision: 'deny' });
      });

      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`
}

/** Attachment labels are computed extension-side (formatAttachmentLabel is
 * pure and already tested) so the webview only ever renders plain strings. */
export function toWireAttachment(attachment: ContextAttachment): { label: string } {
  return { label: formatAttachmentLabel(attachment) }
}
