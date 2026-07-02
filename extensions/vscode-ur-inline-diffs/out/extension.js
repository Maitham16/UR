"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode7 = __toESM(require("vscode"));

// src/chat/chatController.ts
var import_node_crypto2 = require("node:crypto");
var vscode3 = __toESM(require("vscode"));

// src/bridge/types.ts
function isControlRequest(message) {
  return message.type === "control_request" && typeof message.request_id === "string";
}
function isControlCancelRequest(message) {
  return message.type === "control_cancel_request" && typeof message.request_id === "string";
}
function isCanUseToolRequest(message) {
  return message.request?.subtype === "can_use_tool";
}

// src/bridge/urProcess.ts
var import_node_child_process = require("node:child_process");
var NdjsonBuffer = class {
  buffer = "";
  /** Feed a raw chunk (may contain zero, one, or many complete lines, and may
   * split a line across two calls). Returns every complete, parseable line
   * found. Malformed lines are dropped, never thrown — the CLI's own
   * stdout-guard (streamJsonStdoutGuard.ts) already diverts non-JSON writes
   * to stderr, so a malformed line here means something unexpected slipped
   * through, not a reason to crash the extension. */
  push(chunk) {
    this.buffer += chunk;
    const messages = [];
    for (; ; ) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) break;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      const parsed = parseNdjsonLine(line);
      if (parsed) messages.push(parsed);
    }
    return messages;
  }
  /** Whatever is left with no trailing newline yet (a genuinely partial line
   * stays buffered; call this only once the stream has actually ended). */
  flush() {
    const rest = this.buffer;
    this.buffer = "";
    const parsed = parseNdjsonLine(rest);
    return parsed ? [parsed] : [];
  }
};
function parseNdjsonLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed);
    if (value && typeof value === "object" && typeof value.type === "string") {
      return value;
    }
    return null;
  } catch {
    return null;
  }
}
function buildUrArgs(request) {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-prompt-tool",
    "stdio"
  ];
  if (request.resumeSessionId) args.push("--resume", request.resumeSessionId);
  if (request.model) args.push("--model", request.model);
  args.push(request.prompt);
  return args;
}
function buildControlResponse(requestId, decision) {
  return {
    type: "control_response",
    response: {
      request_id: requestId,
      subtype: "success",
      response: decision
    }
  };
}
var defaultSpawn = (command, args, options) => (0, import_node_child_process.spawn)(command, args, options);
function runUrTurn(request, handlers, deps = {}) {
  const spawnFn = deps.spawn ?? defaultSpawn;
  const command = deps.command ?? "ur";
  const args = buildUrArgs(request);
  let child;
  try {
    child = spawnFn(command, args, {
      cwd: request.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (error) {
    handlers.onExit({
      ok: false,
      exitCode: null,
      canceled: false,
      sawResult: false,
      stderr: "",
      error: `Failed to start \`${command}\`: ${errorMessage(error)}. Ensure the UR CLI is installed and on PATH.`
    });
    return { cancel: () => {
    } };
  }
  const stdoutBuffer = new NdjsonBuffer();
  const stderrChunks = [];
  let sawResult = false;
  let resultIsError = false;
  let canceled = false;
  let settled = false;
  const finish = (exitCode, spawnError) => {
    if (settled) return;
    settled = true;
    const stderr = stderrChunks.join("");
    const ok = !canceled && !spawnError && sawResult && !resultIsError;
    handlers.onExit({
      ok,
      exitCode,
      canceled,
      sawResult,
      stderr,
      error: spawnError ?? (!ok && !canceled ? deriveErrorMessage(sawResult, resultIsError, exitCode, stderr) : void 0)
    });
  };
  const handleMessage = (message) => {
    if (message.type === "result") {
      sawResult = true;
      resultIsError = message.is_error === true;
    }
    if (isControlRequest(message) && isCanUseToolRequest(message)) {
      void handlers.onControlRequest(message).then((decision) => {
        writeControlResponse(child, message.request_id, decision);
      }).catch((error) => {
        writeControlResponse(child, message.request_id, {
          behavior: "deny",
          message: `Permission prompt failed in the extension: ${errorMessage(error)}`
        });
      });
    }
    handlers.onMessage(message);
  };
  child.stdout?.on("data", (chunk) => {
    for (const message of stdoutBuffer.push(chunk.toString("utf8"))) {
      handleMessage(message);
    }
  });
  child.stderr?.on("data", (chunk) => {
    stderrChunks.push(chunk.toString("utf8"));
  });
  child.on("error", (error) => {
    finish(null, `Failed to run \`${command}\`: ${errorMessage(error)}. Ensure the UR CLI is installed and on PATH.`);
  });
  child.on("exit", (code) => {
    for (const message of stdoutBuffer.flush()) {
      handleMessage(message);
    }
    finish(code);
  });
  return {
    cancel: () => {
      if (settled) return;
      canceled = true;
      child.kill("SIGTERM");
    }
  };
}
function writeControlResponse(child, requestId, decision) {
  try {
    child.stdin?.write(`${JSON.stringify(buildControlResponse(requestId, decision))}
`);
  } catch {
  }
}
function deriveErrorMessage(sawResult, resultIsError, exitCode, stderr) {
  if (sawResult && resultIsError) return "UR reported an error completing this turn.";
  const trimmedStderr = stderr.trim();
  if (trimmedStderr) return trimmedStderr;
  return `UR exited with code ${exitCode ?? "unknown"} and produced no result.`;
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/context/ideContext.ts
var path = __toESM(require("node:path"));
function formatAttachmentLabel(attachment) {
  if (attachment.kind === "file") return `@${attachment.file.path}`;
  const { path: filePath, startLine, endLine } = attachment.selection;
  return startLine === endLine ? `@${filePath}:${startLine}` : `@${filePath}:${startLine}-${endLine}`;
}
function formatAttachmentBlock(attachment) {
  const label = formatAttachmentLabel(attachment);
  if (attachment.kind === "file") return label;
  const fence = languageIdToFence(attachment.selection.languageId);
  return `${label}
\`\`\`${fence}
${attachment.selection.text}
\`\`\``;
}
function buildPromptWithAttachments(prompt, attachments) {
  if (attachments.length === 0) return prompt;
  const blocks = attachments.map(formatAttachmentBlock).join("\n\n");
  return `${blocks}

${prompt}`;
}
function describeUnavailableReason(snapshot, kind) {
  if (!snapshot.workspaceRoot) return "Open a workspace folder first.";
  if (!snapshot.activeFile) return "No active editor.";
  if (kind === "selection" && !snapshot.selection) return "No text selected.";
  return null;
}
var FENCE_OVERRIDES = {
  typescriptreact: "tsx",
  javascriptreact: "jsx",
  shellscript: "bash",
  jsonc: "json",
  plaintext: ""
};
function languageIdToFence(languageId) {
  return FENCE_OVERRIDES[languageId] ?? languageId;
}
function captureEditorSnapshot() {
  const vscode8 = require("vscode");
  const workspaceRoot2 = vscode8.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const editor = vscode8.window.activeTextEditor;
  if (!editor) return { workspaceRoot: workspaceRoot2 };
  const absolutePath = editor.document.uri.fsPath;
  const relativePath = workspaceRoot2 ? path.relative(workspaceRoot2, absolutePath) : absolutePath;
  const activeFile = { path: relativePath, languageId: editor.document.languageId };
  const selection = editor.selection;
  if (selection.isEmpty) return { workspaceRoot: workspaceRoot2, activeFile };
  const text = editor.document.getText(selection);
  const selectionSnapshot = {
    path: relativePath,
    languageId: editor.document.languageId,
    startLine: selection.start.line + 1,
    endLine: selection.end.line + 1,
    text
  };
  return { workspaceRoot: workspaceRoot2, activeFile, selection: selectionSnapshot };
}

// src/diffs/store.ts
var fs = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));
var vscode = __toESM(require("vscode"));
function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
function diffsRoot(root) {
  return path2.join(root, ".ur", "ide", "diffs");
}
function manifestPath(root) {
  return path2.join(diffsRoot(root), "manifest.json");
}
function patchPath(root, bundle) {
  return path2.join(diffsRoot(root), bundle.patchFile);
}
function metadataPath(root, bundle) {
  return path2.join(diffsRoot(root), bundle.metadataFile);
}
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path2.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}
`);
}
function loadManifest(root) {
  const manifest = readJson(manifestPath(root), { version: 1, diffs: [] });
  return Array.isArray(manifest.diffs) ? manifest : { version: 1, diffs: [] };
}
function loadBundleMetadata(root, bundle) {
  return readJson(metadataPath(root, bundle), bundle);
}
function readPatch(root, bundle) {
  const file = patchPath(root, bundle);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}
function writeManifest(root, manifest) {
  writeJson(manifestPath(root), manifest);
}
function writeBundleMetadata(root, bundle) {
  writeJson(metadataPath(root, bundle), bundle);
}

// src/sessions/sessionStore.ts
var import_node_crypto = require("node:crypto");
var fs2 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));
var SESSION_ID_PATTERN = /^[a-zA-Z0-9-]{1,128}$/;
var TITLE_MAX_LENGTH = 60;
var DEFAULT_TITLE = "New Chat";
function chatRoot(root) {
  return path3.join(root, ".ur", "ide", "chat");
}
function manifestPath2(root) {
  return path3.join(chatRoot(root), "manifest.json");
}
function isValidSessionId(id) {
  return SESSION_ID_PATTERN.test(id);
}
function sessionFilePath(root, id) {
  if (!isValidSessionId(id)) return null;
  const sessionsDir = path3.join(chatRoot(root), "sessions");
  const target = path3.join(sessionsDir, `${id}.json`);
  const resolvedDir = path3.resolve(sessionsDir) + path3.sep;
  const resolvedTarget = path3.resolve(target);
  if (!resolvedTarget.startsWith(resolvedDir)) return null;
  return target;
}
function readJson2(file, fallback) {
  try {
    return JSON.parse(fs2.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson2(file, value) {
  fs2.mkdirSync(path3.dirname(file), { recursive: true });
  fs2.writeFileSync(file, `${JSON.stringify(value, null, 2)}
`);
}
function readManifest(root) {
  const manifest = readJson2(manifestPath2(root), { version: 1, sessions: [] });
  return Array.isArray(manifest.sessions) ? manifest : { version: 1, sessions: [] };
}
function writeManifest2(root, manifest) {
  writeJson2(manifestPath2(root), manifest);
}
function upsertManifestEntry(root, session) {
  const manifest = readManifest(root);
  const index = manifest.sessions.findIndex((entry) => entry.id === session.id);
  if (index === -1) {
    manifest.sessions.push(session);
  } else {
    manifest.sessions[index] = session;
  }
  writeManifest2(root, manifest);
}
function createSession(root, options = {}) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const session = {
    id: (0, import_node_crypto.randomUUID)(),
    title: options.title?.trim() || DEFAULT_TITLE,
    workspaceRoot: root,
    createdAt: now,
    updatedAt: now
  };
  const record = { session, messages: [] };
  const file = sessionFilePath(root, session.id);
  if (!file) throw new Error(`Generated an invalid session id: ${session.id}`);
  writeJson2(file, record);
  upsertManifestEntry(root, session);
  return record;
}
function listSessions(root, options = {}) {
  const manifest = readManifest(root);
  const sessions = options.includeArchived ? manifest.sessions : manifest.sessions.filter((s) => !s.archived);
  return sessions.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
function readSession(root, id) {
  const file = sessionFilePath(root, id);
  if (!file || !fs2.existsSync(file)) return null;
  return readJson2(file, null);
}
function appendMessage(root, id, message) {
  const record = readSession(root, id);
  if (!record) return null;
  record.messages.push(message);
  record.session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (record.session.title === DEFAULT_TITLE && message.role === "user") {
    record.session.title = deriveTitle(message);
  }
  const file = sessionFilePath(root, id);
  if (!file) return null;
  writeJson2(file, record);
  upsertManifestEntry(root, record.session);
  return record;
}
function setCliSessionId(root, id, cliSessionId) {
  const record = readSession(root, id);
  if (!record) return null;
  record.session.cliSessionId = cliSessionId;
  record.session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const file = sessionFilePath(root, id);
  if (!file) return null;
  writeJson2(file, record);
  upsertManifestEntry(root, record.session);
  return record;
}
function deriveTitle(message) {
  const text = message.content.map((block) => block.type === "text" ? block.text : "").join(" ").trim().replace(/\s+/g, " ");
  if (!text) return DEFAULT_TITLE;
  return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH - 1)}\u2026` : text;
}

// src/chat/chatPanel.ts
var vscode2 = __toESM(require("vscode"));
var ChatPanel = class _ChatPanel {
  static current;
  panel;
  disposed = false;
  disposables = [];
  constructor(panel, onMessage) {
    this.panel = panel;
    this.panel.webview.html = renderChatHtml(this.panel.webview);
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message) => onMessage(message)),
      this.panel.onDidDispose(() => this.handleDispose())
    );
  }
  static createOrShow(onMessage) {
    if (_ChatPanel.current && !_ChatPanel.current.disposed) {
      _ChatPanel.current.panel.reveal(vscode2.ViewColumn.Beside);
      return _ChatPanel.current;
    }
    const panel = vscode2.window.createWebviewPanel("urChat", "UR Chat", vscode2.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true
    });
    const instance = new _ChatPanel(panel, onMessage);
    _ChatPanel.current = instance;
    return instance;
  }
  static get isOpen() {
    return Boolean(_ChatPanel.current && !_ChatPanel.current.disposed);
  }
  post(message) {
    if (this.disposed) return;
    void this.panel.webview.postMessage(message);
  }
  handleDispose() {
    this.disposed = true;
    for (const disposable of this.disposables) disposable.dispose();
    if (_ChatPanel.current === this) _ChatPanel.current = void 0;
  }
};
function nonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i++) value += chars.charAt(Math.floor(Math.random() * chars.length));
  return value;
}
function renderChatHtml(webview) {
  const scriptNonce = nonce();
  const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${scriptNonce}'`
  ].join("; ");
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
    <textarea id="input" placeholder="Message UR\u2026" rows="2"></textarea>
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
          const resolved = block.resolved ? ' \u2014 ' + block.resolved : ' \u2014 pending';
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
        else if (status === 'running') statusLineEl.textContent = 'Running\u2026';
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
</html>`;
}
function toWireAttachment(attachment) {
  return { label: formatAttachmentLabel(attachment) };
}

// src/chat/messageMapping.ts
function extractAssistantContentBlocks(message) {
  const content = message?.message?.content;
  if (!Array.isArray(content)) return [];
  const blocks = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block;
    if (typed.type === "text" && typeof typed.text === "string") {
      blocks.push({ type: "text", text: typed.text });
    } else if (typed.type === "tool_use" && typeof typed.id === "string" && typeof typed.name === "string") {
      blocks.push({ type: "tool_use", id: typed.id, name: typed.name, input: typed.input });
    }
  }
  return blocks;
}
function extractToolResultContentBlocks(message) {
  const content = message?.message?.content;
  if (!Array.isArray(content)) return [];
  const blocks = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const typed = block;
    if (typed.type === "tool_result" && typeof typed.tool_use_id === "string") {
      blocks.push({
        type: "tool_result",
        toolUseId: typed.tool_use_id,
        ok: typed.is_error !== true,
        summary: summarizeToolResultContent(typed.content)
      });
    }
  }
  return blocks;
}
function summarizeToolResultContent(content, max = 800) {
  if (typeof content === "string") return truncate(content, max);
  if (Array.isArray(content)) {
    const text = content.map((block) => block && typeof block === "object" && "text" in block ? String(block.text) : "").filter(Boolean).join("\n");
    return truncate(text || JSON.stringify(content), max);
  }
  return truncate(JSON.stringify(content ?? ""), max);
}
function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}\u2026` : text;
}

// src/chat/prompts.ts
function selectionAttachment(selection) {
  return { kind: "selection", selection };
}
function buildExplainPrompt(selection) {
  return buildPromptWithAttachments(
    "Explain what this code does, step by step. Call out any non-obvious behavior, edge cases, or assumptions it makes.",
    [selectionAttachment(selection)]
  );
}
function buildFixPrompt(selection) {
  return buildPromptWithAttachments(
    "Find and fix any bugs in this code. Explain what was wrong and what you changed.",
    [selectionAttachment(selection)]
  );
}
function buildGenerateTestsPrompt(selection) {
  return buildPromptWithAttachments(
    "Write tests for this code, covering the main behavior and realistic edge cases. Match the existing test style and framework used in this project if you can tell what it is.",
    [selectionAttachment(selection)]
  );
}

// src/chat/chatController.ts
var ChatController = class {
  panel;
  record;
  attachments = [];
  status = "idle";
  turnHandle;
  pendingPermissions = /* @__PURE__ */ new Map();
  // --- commands ---
  async newChat() {
    const root = this.requireWorkspaceRoot();
    if (!root) return;
    this.turnHandle?.cancel();
    this.record = createSession(root);
    this.attachments = [];
    this.status = "idle";
    this.ensurePanel();
    this.syncFullState();
  }
  async openChat() {
    const root = this.requireWorkspaceRoot();
    if (!root) return;
    if (this.record) {
      this.ensurePanel();
      this.syncFullState();
      return;
    }
    const sessions = listSessions(root);
    if (sessions.length === 0) {
      await this.newChat();
      return;
    }
    const picked = await this.pickSession(sessions);
    if (picked === void 0) return;
    if (picked === "new") {
      await this.newChat();
      return;
    }
    const record = readSession(root, picked);
    if (!record) {
      await this.newChat();
      return;
    }
    this.record = record;
    this.ensurePanel();
    this.syncFullState();
  }
  cancelCurrentRequest() {
    if (!this.turnHandle || this.status !== "running") {
      vscode3.window.showInformationMessage("No UR chat request is currently running.");
      return;
    }
    this.turnHandle.cancel();
    this.denyAllPending("Request was canceled.");
  }
  addCurrentFileToChat() {
    this.stageAttachment("file");
  }
  addSelectionToChat() {
    this.stageAttachment("selection");
  }
  async explainSelection() {
    await this.runEditorAction(buildExplainPrompt);
  }
  async fixSelection() {
    await this.runEditorAction(buildFixPrompt);
  }
  async generateTestsForSelection() {
    await this.runEditorAction(buildGenerateTestsPrompt);
  }
  async sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const prompt = buildPromptWithAttachments(trimmed, this.attachments);
    this.attachments = [];
    this.panel?.post({ type: "attachmentsChanged", attachments: [] });
    await this.dispatchTurn(prompt);
  }
  dispose() {
    this.turnHandle?.cancel();
    this.denyAllPending("Extension is shutting down.");
  }
  // --- internals ---
  requireWorkspaceRoot() {
    const root = workspaceRoot();
    if (!root) {
      vscode3.window.showWarningMessage("Open a workspace folder to use UR Chat.");
      return void 0;
    }
    return root;
  }
  ensurePanel() {
    if (!ChatPanel.isOpen) {
      this.panel = ChatPanel.createOrShow((message) => this.handleWebviewMessage(message));
    }
  }
  async pickSession(sessions) {
    const items = [
      { id: "new", label: "$(add) Start New Chat" },
      ...sessions.map(
        (session) => ({
          id: session.id,
          label: session.title,
          description: new Date(session.updatedAt).toLocaleString()
        })
      )
    ];
    const picked = await vscode3.window.showQuickPick(items, {
      title: "UR Chat",
      placeHolder: "Resume a chat or start a new one"
    });
    return picked?.id;
  }
  stageAttachment(kind) {
    const snapshot = captureEditorSnapshot();
    const reason = describeUnavailableReason(snapshot, kind);
    if (reason) {
      vscode3.window.showWarningMessage(reason);
      return;
    }
    const attachment = kind === "file" ? { kind: "file", file: snapshot.activeFile } : { kind: "selection", selection: snapshot.selection };
    this.attachments.push(attachment);
    this.ensurePanel();
    this.panel?.post({ type: "attachmentsChanged", attachments: this.attachments.map(toWireAttachment) });
  }
  async runEditorAction(build) {
    const root = this.requireWorkspaceRoot();
    if (!root) return;
    const snapshot = captureEditorSnapshot();
    const reason = describeUnavailableReason(snapshot, "selection");
    if (reason) {
      vscode3.window.showWarningMessage(reason);
      return;
    }
    await this.dispatchTurn(build(snapshot.selection));
  }
  /** The single pathway every turn goes through — manual sends and editor
   * actions alike. */
  async dispatchTurn(promptText) {
    const root = this.requireWorkspaceRoot();
    if (!root) return;
    if (this.status === "running") {
      vscode3.window.showWarningMessage("UR is already running a request. Cancel it first or wait for it to finish.");
      return;
    }
    if (!this.record) this.record = createSession(root);
    this.ensurePanel();
    const sessionId = this.record.session.id;
    const userMessage = {
      id: (0, import_node_crypto2.randomUUID)(),
      sessionId,
      role: "user",
      content: [{ type: "text", text: promptText }],
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    appendMessage(root, sessionId, userMessage);
    this.record.messages.push(userMessage);
    this.panel?.post({ type: "messageAppended", message: userMessage });
    this.status = "running";
    this.panel?.post({ type: "statusChanged", status: this.status });
    const resumeSessionId = this.record.session.cliSessionId;
    this.turnHandle = runUrTurn(
      { cwd: root, prompt: promptText, resumeSessionId },
      {
        onMessage: (message) => this.handleStreamMessage(root, sessionId, message),
        onControlRequest: (request) => this.handlePermissionRequest(request),
        onExit: (result) => this.handleTurnExit(root, result)
      }
    );
  }
  handleStreamMessage(root, sessionId, message) {
    if (message.type === "system" && message.subtype === "init" && typeof message.session_id === "string") {
      if (this.record && this.record.session.id === sessionId && !this.record.session.cliSessionId) {
        setCliSessionId(root, sessionId, message.session_id);
        this.record.session.cliSessionId = message.session_id;
      }
      return;
    }
    if (message.type === "assistant") {
      const blocks = extractAssistantContentBlocks(message);
      if (blocks.length > 0) this.appendChatMessage(root, sessionId, "assistant", blocks);
      return;
    }
    if (message.type === "user") {
      const blocks = extractToolResultContentBlocks(message);
      if (blocks.length > 0) this.appendChatMessage(root, sessionId, "status", blocks);
      return;
    }
    if (isControlCancelRequest(message)) {
      const pending = this.pendingPermissions.get(message.request_id);
      if (pending) {
        this.pendingPermissions.delete(message.request_id);
        pending.resolve({ behavior: "deny", message: "Permission request was canceled." });
      }
      this.panel?.post({ type: "permissionResolved", requestId: message.request_id });
    }
  }
  appendChatMessage(root, sessionId, role, content) {
    if (!this.record || this.record.session.id !== sessionId) return;
    const message = { id: (0, import_node_crypto2.randomUUID)(), sessionId, role, content, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
    appendMessage(root, sessionId, message);
    this.record.messages.push(message);
    this.panel?.post({ type: "messageAppended", message });
  }
  appendStatusText(root, text) {
    if (!this.record) return;
    this.appendChatMessage(root, this.record.session.id, "status", [{ type: "text", text }]);
  }
  handlePermissionRequest(request) {
    return new Promise((resolve2) => {
      const toolName = request.request.tool_name ?? "tool";
      const input = request.request.input ?? {};
      this.pendingPermissions.set(request.request_id, { resolve: resolve2, toolName, input });
      this.panel?.post({ type: "permissionRequest", requestId: request.request_id, toolName, input });
    });
  }
  handleTurnExit(root, result) {
    this.turnHandle = void 0;
    this.denyAllPending("The chat turn ended before this request was answered.");
    if (result.canceled) {
      this.status = "canceled";
      this.appendStatusText(root, "Canceled.");
    } else if (!result.ok) {
      this.status = "error";
      const message = result.error ?? "UR failed to complete this turn.";
      this.appendStatusText(root, `Error: ${message}`);
      this.panel?.post({ type: "errorBanner", message });
    } else {
      this.status = "idle";
    }
    this.panel?.post({ type: "statusChanged", status: this.status });
  }
  resolvePermission(requestId, decision) {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return;
    this.pendingPermissions.delete(requestId);
    pending.resolve(
      decision === "allow" ? { behavior: "allow", updatedInput: pending.input } : { behavior: "deny", message: "User denied this tool call from the UR Chat panel." }
    );
    this.panel?.post({ type: "permissionResolved", requestId });
    const root = workspaceRoot();
    if (root) this.appendStatusText(root, `${decision === "allow" ? "Allowed" : "Denied"} ${pending.toolName}.`);
  }
  denyAllPending(reason) {
    for (const [requestId, pending] of this.pendingPermissions) {
      pending.resolve({ behavior: "deny", message: reason });
      this.panel?.post({ type: "permissionResolved", requestId });
    }
    this.pendingPermissions.clear();
  }
  handleWebviewMessage(message) {
    if (message.type === "ready") {
      this.syncFullState();
      return;
    }
    if (message.type === "send") {
      void this.sendMessage(message.text);
      return;
    }
    if (message.type === "cancel") {
      this.cancelCurrentRequest();
      return;
    }
    if (message.type === "permissionDecision") {
      this.resolvePermission(message.requestId, message.decision);
      return;
    }
    if (message.type === "removeAttachment") {
      this.attachments.splice(message.index, 1);
      this.panel?.post({ type: "attachmentsChanged", attachments: this.attachments.map(toWireAttachment) });
    }
  }
  syncFullState() {
    if (!this.record) return;
    this.ensurePanel();
    this.panel?.post({
      type: "init",
      session: this.record.session,
      messages: this.record.messages,
      status: this.status,
      attachments: this.attachments.map(toWireAttachment)
    });
  }
};

// src/diffs/actions.ts
var import_node_child_process3 = require("node:child_process");
var fs3 = __toESM(require("node:fs"));
var import_node_util2 = require("node:util");
var vscode4 = __toESM(require("vscode"));

// src/bridge/urCli.ts
var import_node_child_process2 = require("node:child_process");
var import_node_util = require("node:util");
var execFileAsync = (0, import_node_util.promisify)(import_node_child_process2.execFile);
async function runUrCli(args, options) {
  try {
    const { stdout, stderr } = await execFileAsync("ur", args, {
      cwd: options.cwd,
      shell: false
    });
    return { stdout, stderr };
  } catch (error) {
    throw new Error(formatUrCliError(args, error));
  }
}
function formatUrCliError(args, error) {
  const stderr = hasStderr(error) ? error.stderr.trim() : "";
  const detail = stderr || (error instanceof Error ? error.message : String(error));
  return `Failed to run \`ur ${args.join(" ")}\`: ${detail}. Ensure the UR CLI is installed and on PATH.`;
}
function hasStderr(error) {
  return typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string";
}

// src/diffs/actions.ts
var execFileAsync2 = (0, import_node_util2.promisify)(import_node_child_process3.execFile);
async function commentDiff(item, provider) {
  const root = workspaceRoot();
  const bundle = item?.bundle;
  if (!root || !bundle) {
    vscode4.window.showWarningMessage("No UR inline diff selected.");
    return;
  }
  const text = await vscode4.window.showInputBox({
    title: `Comment on ${bundle.id}`,
    prompt: "Comment text",
    ignoreFocusOut: true
  });
  if (!text?.trim()) return;
  const manifest = loadManifest(root);
  const manifestBundle = manifest.diffs.find((diff) => diff.id === bundle.id);
  if (!manifestBundle) {
    vscode4.window.showErrorMessage(`UR inline diff not found: ${bundle.id}`);
    return;
  }
  const at = (/* @__PURE__ */ new Date()).toISOString();
  manifestBundle.status = "commented";
  manifestBundle.updatedAt = at;
  manifestBundle.comments = [...manifestBundle.comments ?? [], { at, text: text.trim() }];
  writeManifest(root, manifest);
  writeBundleMetadata(root, manifestBundle);
  provider.refresh();
  vscode4.window.showInformationMessage(`Added UR comment to ${bundle.id}.`);
}
async function applyDiff(item, provider) {
  const root = workspaceRoot();
  const bundle = item?.bundle;
  if (!root || !bundle) {
    vscode4.window.showWarningMessage("No UR inline diff selected.");
    return;
  }
  const patch = patchPath(root, bundle);
  if (!fs3.existsSync(patch)) {
    vscode4.window.showErrorMessage(`UR patch file missing for ${bundle.id}.`);
    return;
  }
  const choice = await vscode4.window.showWarningMessage(
    `Apply UR patch ${bundle.id} to your working tree? This modifies ${bundle.files?.length ?? 0} file(s).`,
    { modal: true },
    "Apply"
  );
  if (choice !== "Apply") return;
  try {
    await execFileAsync2("git", ["apply", "--whitespace=nowarn", patch], { cwd: root, shell: false });
  } catch (error) {
    vscode4.window.showErrorMessage(`Failed to apply UR patch ${bundle.id}: ${gitErrorMessage(error)}`);
    return;
  }
  try {
    const { stdout } = await runUrCli(["ide", "diff", "approve", bundle.id], { cwd: root });
    provider.refresh();
    if (isNotFoundResult(stdout)) {
      vscode4.window.showWarningMessage(
        `Applied ${bundle.id} to disk, but no matching diff record was found to mark it approved.`
      );
      return;
    }
    vscode4.window.showInformationMessage(`Applied UR patch ${bundle.id}.`);
  } catch (error) {
    vscode4.window.showErrorMessage(
      `Applied ${bundle.id} to disk, but failed to record approval: ${errorMessage2(error)}`
    );
  }
}
async function rejectDiff(item, provider) {
  const root = workspaceRoot();
  const bundle = item?.bundle;
  if (!root || !bundle) {
    vscode4.window.showWarningMessage("No UR inline diff selected.");
    return;
  }
  try {
    const { stdout } = await runUrCli(["ide", "diff", "reject", bundle.id], { cwd: root });
    provider.refresh();
    if (isNotFoundResult(stdout)) {
      vscode4.window.showErrorMessage(`UR inline diff not found: ${bundle.id}`);
      return;
    }
    vscode4.window.showInformationMessage(`Rejected UR patch ${bundle.id} (no files changed).`);
  } catch (error) {
    vscode4.window.showErrorMessage(errorMessage2(error));
  }
}
async function showStatus(channel) {
  const root = workspaceRoot();
  if (!root) {
    vscode4.window.showWarningMessage("Open a workspace folder to query UR status.");
    return;
  }
  channel.clear();
  channel.show(true);
  channel.appendLine("Running: ur ide status");
  try {
    const { stdout } = await runUrCli(["ide", "status"], { cwd: root });
    channel.appendLine(stdout.trim());
  } catch (error) {
    channel.appendLine(errorMessage2(error));
  }
}
function isNotFoundResult(stdout) {
  return stdout.trim().toLowerCase().includes("not found");
}
function errorMessage2(error) {
  return error instanceof Error ? error.message : String(error);
}
function gitErrorMessage(error) {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = error.stderr;
    if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  }
  return errorMessage2(error);
}

// src/diffs/treeProvider.ts
var fs4 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));
var vscode5 = __toESM(require("vscode"));

// src/util/format.ts
function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function formatCount(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}
function formatRelativeTime(value) {
  if (!value) return "unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const deltaMs = Date.now() - date.getTime();
  const minute = 60 * 1e3;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (deltaMs < minute) return "just now";
  if (deltaMs < hour) return `${Math.max(1, Math.floor(deltaMs / minute))}m ago`;
  if (deltaMs < day) return `${Math.floor(deltaMs / hour)}h ago`;
  if (deltaMs < 7 * day) return `${Math.floor(deltaMs / day)}d ago`;
  return date.toLocaleDateString();
}

// src/diffs/treeProvider.ts
function statusIcon(status) {
  switch (status) {
    case "approved":
      return new vscode5.ThemeIcon("check", new vscode5.ThemeColor("testing.iconPassed"));
    case "rejected":
      return new vscode5.ThemeIcon("circle-slash", new vscode5.ThemeColor("testing.iconFailed"));
    case "commented":
      return new vscode5.ThemeIcon("comment-discussion", new vscode5.ThemeColor("charts.yellow"));
    default:
      return new vscode5.ThemeIcon("diff", new vscode5.ThemeColor("charts.blue"));
  }
}
var DiffTreeItem = class extends vscode5.TreeItem {
  bundle;
  constructor(bundle) {
    const title = bundle.title || bundle.id;
    super(title, vscode5.TreeItemCollapsibleState.None);
    this.bundle = bundle;
    this.contextValue = "diff";
    const fileCount = bundle.files?.length ?? 0;
    const changedAt = bundle.updatedAt ?? bundle.createdAt;
    this.description = `${bundle.status ?? "captured"} \xB7 ${formatCount(fileCount, "file")} \xB7 ${formatRelativeTime(changedAt)}`;
    this.iconPath = statusIcon(bundle.status);
    this.tooltip = new vscode5.MarkdownString(
      [
        `**${escapeHtml(title)}**`,
        "",
        `- ID: \`${escapeHtml(bundle.id)}\``,
        `- Status: ${escapeHtml(bundle.status ?? "captured")}`,
        `- Files: ${fileCount}`,
        `- Patch: \`${escapeHtml(bundle.patchFile)}\``
      ].join("\n")
    );
    this.command = {
      command: "urInlineDiffs.open",
      title: "Open Inline Diff",
      arguments: [this]
    };
  }
};
var ActionItem = class extends vscode5.TreeItem {
  constructor(label, description, icon, command, tooltip) {
    super(label, vscode5.TreeItemCollapsibleState.None);
    this.contextValue = "urAction";
    this.description = description;
    this.iconPath = new vscode5.ThemeIcon(icon);
    this.tooltip = tooltip ?? `${label}${description ? ` \u2014 ${description}` : ""}`;
    this.command = command;
  }
};
var InfoItem = class extends vscode5.TreeItem {
  constructor(label, description, icon = "info") {
    super(label, vscode5.TreeItemCollapsibleState.None);
    this.contextValue = "urInfo";
    this.description = description;
    this.iconPath = new vscode5.ThemeIcon(icon);
    this.tooltip = `${label}${description ? ` \u2014 ${description}` : ""}`;
  }
};
var DiffTreeProvider = class {
  _onDidChangeTreeData = new vscode5.EventEmitter();
  onDidChangeTreeData = this._onDidChangeTreeData.event;
  refresh() {
    this._onDidChangeTreeData.fire();
  }
  getTreeItem(item) {
    return item;
  }
  getChildren() {
    const root = workspaceRoot();
    if (!root) {
      return [
        new InfoItem(
          "Open a workspace folder",
          "UR inline diffs are scoped to the active project",
          "folder-opened"
        )
      ];
    }
    const manifest = loadManifest(root);
    const diffs = manifest.diffs.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (diffs.length === 0) {
      return [
        new InfoItem(
          "Ready for inline review",
          fs4.existsSync(manifestPath(root)) ? "No pending diff bundles" : "No diff bundles captured yet",
          "pass"
        ),
        new ActionItem("Show UR status", "Provider, model, plugins", "pulse", {
          command: "urInlineDiffs.status",
          title: "Show UR Status"
        }),
        new ActionItem("Refresh", path4.relative(root, manifestPath(root)), "refresh", {
          command: "urInlineDiffs.refresh",
          title: "Refresh Inline Diffs"
        })
      ];
    }
    return diffs.map((bundle) => new DiffTreeItem(bundle));
  }
};

// src/diffs/webview.ts
var vscode6 = __toESM(require("vscode"));
function renderDiffHtml(root, bundle) {
  const patch = readPatch(root, bundle);
  const comments = bundle.comments ?? [];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: light dark; }
    body { font: 13px/1.5 var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px; margin: 0; }
    header { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 14px; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 600; margin: 0 0 6px; }
    h2 { font-size: 14px; margin: 20px 0 10px; }
    .meta, .where { color: var(--vscode-descriptionForeground); }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .chip { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 3px 8px; background: var(--vscode-sideBar-background); }
    pre { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 14px; overflow: auto; font-family: var(--vscode-editor-font-family); }
    .comments { margin-top: 18px; }
    .comment { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; background: var(--vscode-sideBar-background); }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(bundle.title)}</h1>
    <div class="meta">${escapeHtml(bundle.id)} \xB7 ${escapeHtml(formatRelativeTime(bundle.updatedAt ?? bundle.createdAt))}</div>
    <div class="chips">
      <span class="chip">${escapeHtml(bundle.status ?? "captured")}</span>
      <span class="chip">${escapeHtml(formatCount(bundle.files?.length ?? 0, "file"))}</span>
      <span class="chip">${escapeHtml(formatCount(comments.length, "comment"))}</span>
    </div>
  </header>
  <pre>${escapeHtml(patch)}</pre>
  <section class="comments">
    <h2>Comments</h2>
    ${comments.length === 0 ? '<p class="meta">No comments yet.</p>' : comments.map((comment) => {
    const where = comment.file ? `${comment.file}${comment.line ? `:${comment.line}` : ""}` : "General";
    return `<div class="comment"><div class="where">${escapeHtml(where)} \xB7 ${escapeHtml(comment.at ?? "")}</div><div>${escapeHtml(comment.text)}</div></div>`;
  }).join("")}
  </section>
</body>
</html>`;
}
async function openDiff(item) {
  const root = workspaceRoot();
  const bundle = item?.bundle;
  if (!root || !bundle) {
    vscode6.window.showWarningMessage("No UR inline diff selected.");
    return;
  }
  const panel = vscode6.window.createWebviewPanel("urInlineDiff", `UR ${bundle.id}`, vscode6.ViewColumn.Active, {
    enableScripts: false
  });
  const latest = loadBundleMetadata(root, bundle);
  panel.webview.html = renderDiffHtml(root, latest);
}

// src/extension.ts
function activate(context) {
  const provider = new DiffTreeProvider();
  const channel = vscode7.window.createOutputChannel("UR");
  const tree = vscode7.window.createTreeView("urInlineDiffs", {
    treeDataProvider: provider,
    showCollapseAll: false
  });
  const chat = new ChatController();
  context.subscriptions.push(
    channel,
    tree,
    chat,
    vscode7.commands.registerCommand("urInlineDiffs.refresh", () => provider.refresh()),
    vscode7.commands.registerCommand("urInlineDiffs.open", (item) => openDiff(item)),
    vscode7.commands.registerCommand("urInlineDiffs.comment", (item) => commentDiff(item, provider)),
    vscode7.commands.registerCommand("urInlineDiffs.apply", (item) => applyDiff(item, provider)),
    vscode7.commands.registerCommand("urInlineDiffs.reject", (item) => rejectDiff(item, provider)),
    vscode7.commands.registerCommand("urInlineDiffs.status", () => showStatus(channel)),
    vscode7.commands.registerCommand("urInlineDiffs.chat.new", () => chat.newChat()),
    vscode7.commands.registerCommand("urInlineDiffs.chat.open", () => chat.openChat()),
    vscode7.commands.registerCommand("urInlineDiffs.chat.cancel", () => chat.cancelCurrentRequest()),
    vscode7.commands.registerCommand("urInlineDiffs.chat.addFile", () => chat.addCurrentFileToChat()),
    vscode7.commands.registerCommand("urInlineDiffs.chat.addSelection", () => chat.addSelectionToChat()),
    vscode7.commands.registerCommand("urInlineDiffs.chat.explainSelection", () => chat.explainSelection()),
    vscode7.commands.registerCommand("urInlineDiffs.chat.fixSelection", () => chat.fixSelection()),
    vscode7.commands.registerCommand("urInlineDiffs.chat.generateTests", () => chat.generateTestsForSelection())
  );
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
