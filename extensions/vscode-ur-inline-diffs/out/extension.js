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
var vscode17 = __toESM(require("vscode"));

// src/actions/actions.ts
var vscode = __toESM(require("vscode"));
async function openBackgroundLog(item) {
  const logFile = item?.task.logFile;
  if (!logFile) {
    vscode.window.showWarningMessage("No log file for this background task.");
    return;
  }
  try {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(logFile));
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (error) {
    vscode.window.showErrorMessage(
      `Could not open background task log: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// src/actions/actionsTreeProvider.ts
var vscode4 = __toESM(require("vscode"));

// src/diffs/store.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var vscode2 = __toESM(require("vscode"));
function workspaceRoot() {
  const activeUri = vscode2.window.activeTextEditor?.document.uri;
  return (activeUri ? vscode2.workspace.getWorkspaceFolder(activeUri) : void 0)?.uri.fsPath ?? vscode2.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
function diffsRoot(root) {
  return path.join(root, ".ur", "ide", "diffs");
}
function manifestPath(root) {
  return path.join(diffsRoot(root), "manifest.json");
}
function patchPath(root, bundle) {
  return artifactPath(root, bundle, "patch");
}
function metadataPath(root, bundle) {
  return artifactPath(root, bundle, "metadata");
}
var DIFF_ID_PATTERN = /^diff-[1-9][0-9]*$/u;
function artifactPath(root, bundle, kind) {
  if (!DIFF_ID_PATTERN.test(bundle.id)) throw new Error(`Invalid UR diff id: ${bundle.id}`);
  const relative2 = kind === "patch" ? bundle.patchFile : bundle.metadataFile;
  const expected = kind === "patch" ? `patches/${bundle.id}.patch` : `metadata/${bundle.id}.json`;
  if (relative2.replaceAll("\\", "/") !== expected) {
    throw new Error(`Invalid UR diff ${kind} path for ${bundle.id}`);
  }
  const rootPath = path.resolve(diffsRoot(root));
  const target = path.resolve(rootPath, relative2);
  if (!target.startsWith(`${rootPath}${path.sep}`)) throw new Error(`UR diff ${kind} path escapes the diff store`);
  return target;
}
function isValidBundle(value) {
  if (!value || typeof value !== "object") return false;
  const bundle = value;
  try {
    patchPath(".", bundle);
    metadataPath(".", bundle);
    return true;
  } catch {
    return false;
  }
}
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}
`);
}
function loadManifest(root) {
  const manifest = readJson(manifestPath(root), { version: 1, diffs: [] });
  return Array.isArray(manifest.diffs) ? { version: 1, diffs: manifest.diffs.filter(isValidBundle) } : { version: 1, diffs: [] };
}
function loadBundleMetadata(root, bundle) {
  const metadata = readJson(metadataPath(root, bundle), bundle);
  return isValidBundle(metadata) && metadata.id === bundle.id ? metadata : bundle;
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

// src/diffs/treeProvider.ts
var vscode3 = __toESM(require("vscode"));

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
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function processErrorMessage(error) {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = error.stderr;
    if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  }
  return errorMessage(error);
}

// src/diffs/treeProvider.ts
function statusIcon(status) {
  switch (status) {
    case "approved":
      return new vscode3.ThemeIcon("check", new vscode3.ThemeColor("testing.iconPassed"));
    case "rejected":
      return new vscode3.ThemeIcon("circle-slash", new vscode3.ThemeColor("testing.iconFailed"));
    case "commented":
      return new vscode3.ThemeIcon("comment-discussion", new vscode3.ThemeColor("charts.yellow"));
    default:
      return new vscode3.ThemeIcon("diff", new vscode3.ThemeColor("charts.blue"));
  }
}
var DiffTreeItem = class extends vscode3.TreeItem {
  bundle;
  constructor(bundle) {
    const title = bundle.title || bundle.id;
    super(title, vscode3.TreeItemCollapsibleState.None);
    this.bundle = bundle;
    this.contextValue = "diff";
    const fileCount = bundle.files?.length ?? 0;
    const changedAt = bundle.updatedAt ?? bundle.createdAt;
    this.description = `${bundle.status ?? "captured"} \xB7 ${formatCount(fileCount, "file")} \xB7 ${formatRelativeTime(changedAt)}`;
    this.iconPath = statusIcon(bundle.status);
    this.tooltip = new vscode3.MarkdownString(
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
var InfoItem = class extends vscode3.TreeItem {
  constructor(label, description, icon = "info") {
    super(label, vscode3.TreeItemCollapsibleState.None);
    this.contextValue = "urInfo";
    this.description = description;
    this.iconPath = new vscode3.ThemeIcon(icon);
    this.tooltip = `${label}${description ? ` \u2014 ${description}` : ""}`;
  }
};
var DiffTreeProvider = class {
  _onDidChangeTreeData = new vscode3.EventEmitter();
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
      return [];
    }
    return diffs.map((bundle) => new DiffTreeItem(bundle));
  }
};

// src/bridge/urCli.ts
var import_node_child_process2 = require("node:child_process");
var import_node_util = require("node:util");

// src/bridge/urCommand.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function resolveUrCommand(options) {
  const config = options.config ?? {};
  const configuredPath = config.executablePath?.trim();
  const configuredArgs = normalizeExecutableArgs(config.executableArgs);
  if (configuredPath) {
    return command(configuredPath, configuredArgs, "configured");
  }
  const pathExists = options.pathExists ?? import_node_fs.existsSync;
  const bunCommand = options.bunCommand ?? "bun";
  const nodeCommand = options.nodeCommand ?? "node";
  const distEntrypoint = (0, import_node_path.join)(options.cwd, "dist", "cli.js");
  if (pathExists(distEntrypoint) && (options.bunAvailable ?? isBunAvailable)(bunCommand)) {
    return command(bunCommand, [distEntrypoint], "workspace-dist");
  }
  const launcherEntrypoint = (0, import_node_path.join)(options.cwd, "bin", "ur.js");
  if (pathExists(launcherEntrypoint)) {
    return command(nodeCommand, [launcherEntrypoint], "workspace-launcher");
  }
  return command("ur", [], "path");
}
function formatResolvedUrCommand(resolved) {
  return [resolved.command, ...resolved.args].join(" ");
}
function command(commandName, args, source) {
  const resolved = { command: commandName, args, source, display: "" };
  return { ...resolved, display: formatResolvedUrCommand(resolved) };
}
function normalizeExecutableArgs(args) {
  return Array.isArray(args) ? args.filter((arg) => typeof arg === "string" && arg.length > 0) : [];
}
function isBunAvailable(commandName) {
  const result = (0, import_node_child_process.spawnSync)(commandName, ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

// src/bridge/urCli.ts
var execFileAsync = (0, import_node_util.promisify)(import_node_child_process2.execFile);
async function runUrCli(args, options) {
  const executable = resolveUrCommand({ cwd: options.cwd, config: readUrCommandConfig() });
  try {
    const { stdout, stderr } = await execFileAsync(executable.command, [...executable.args, ...args], {
      cwd: options.cwd,
      shell: false
    });
    return { stdout, stderr };
  } catch (error) {
    throw new Error(formatUrCliError(args, error, executable, options.cwd));
  }
}
async function runUrCliCapture(args, options) {
  const executable = resolveUrCommand({ cwd: options.cwd, config: readUrCommandConfig() });
  try {
    const { stdout, stderr } = await execFileAsync(executable.command, [...executable.args, ...args], {
      cwd: options.cwd,
      shell: false
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    if (isCapturedNonZeroExit(error)) {
      return { stdout: error.stdout, stderr: error.stderr, exitCode: error.code };
    }
    throw new Error(formatUrCliError(args, error, executable, options.cwd));
  }
}
function readUrCommandConfig() {
  try {
    const vscode18 = require("vscode");
    const config = vscode18.workspace.getConfiguration("ur");
    const executablePath = config.get("executablePath")?.trim();
    const executableArgs = config.get("executableArgs") ?? [];
    return {
      executablePath: executablePath || void 0,
      executableArgs: executableArgs.filter((arg) => typeof arg === "string" && arg.length > 0)
    };
  } catch {
    return {};
  }
}
function formatUrCliError(args, error, executable, cwd) {
  const stderr = hasStderr(error) ? error.stderr.trim() : "";
  const detail = stderr || (error instanceof Error ? error.message : String(error));
  return [
    `Failed to run UR command.`,
    `Executable: ${executable.display}`,
    `cwd: ${cwd}`,
    `Args: ${args.join(" ")}`,
    `Error: ${detail}`,
    `Hint: Set ur.executablePath in VS Code settings if the extension is using the wrong UR binary.`
  ].join("\n");
}
function hasStderr(error) {
  return typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string";
}
function isCapturedNonZeroExit(error) {
  return typeof error === "object" && error !== null && typeof error.code === "number" && typeof error.stdout === "string";
}

// src/actions/background.ts
var VALID_STATUSES = ["queued", "running", "completed", "failed", "canceled"];
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function parseBackgroundListJson(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isRecord(data) || !Array.isArray(data.tasks)) return [];
  const summaries = [];
  for (const entry of data.tasks) {
    if (!isRecord(entry)) continue;
    if (typeof entry.id !== "string" || typeof entry.task !== "string") continue;
    const status = VALID_STATUSES.includes(entry.status) ? entry.status : "queued";
    summaries.push({
      id: entry.id,
      task: entry.task,
      status,
      logFile: typeof entry.logFile === "string" ? entry.logFile : ""
    });
  }
  return summaries;
}
async function loadBackgroundTasks(cwd) {
  try {
    const { stdout } = await runUrCliCapture(["bg", "list", "--json"], { cwd });
    return parseBackgroundListJson(stdout);
  } catch {
    return [];
  }
}

// src/actions/actionsTreeProvider.ts
function backgroundStatusIcon(status) {
  switch (status) {
    case "completed":
      return new vscode4.ThemeIcon("check", new vscode4.ThemeColor("testing.iconPassed"));
    case "failed":
      return new vscode4.ThemeIcon("error", new vscode4.ThemeColor("testing.iconFailed"));
    case "canceled":
      return new vscode4.ThemeIcon("circle-slash", new vscode4.ThemeColor("charts.yellow"));
    case "running":
      return new vscode4.ThemeIcon("sync~spin", new vscode4.ThemeColor("charts.blue"));
    default:
      return new vscode4.ThemeIcon("clock");
  }
}
var BackgroundTaskItem = class extends vscode4.TreeItem {
  task;
  constructor(task) {
    super(task.task, vscode4.TreeItemCollapsibleState.None);
    this.task = task;
    this.contextValue = "backgroundTask";
    this.description = task.status;
    this.iconPath = backgroundStatusIcon(task.status);
    this.tooltip = `${task.id} \u2014 ${task.status}${task.logFile ? `
${task.logFile}` : ""}`;
    if (task.logFile) {
      this.command = { command: "urActions.openBackgroundLog", title: "Open Log", arguments: [this] };
    }
  }
};
var SectionItem = class extends vscode4.TreeItem {
  constructor(kind, label, count) {
    super(label, count > 0 ? vscode4.TreeItemCollapsibleState.Expanded : vscode4.TreeItemCollapsibleState.None);
    this.kind = kind;
    this.description = String(count);
    this.contextValue = "urActionsSection";
  }
  kind;
};
var InfoItem2 = class extends vscode4.TreeItem {
  constructor(label, description, icon = "info") {
    super(label, vscode4.TreeItemCollapsibleState.None);
    this.contextValue = "urInfo";
    this.description = description;
    this.iconPath = new vscode4.ThemeIcon(icon);
    this.tooltip = `${label}${description ? ` \u2014 ${description}` : ""}`;
  }
};
var ActionsTreeProvider = class {
  _onDidChangeTreeData = new vscode4.EventEmitter();
  onDidChangeTreeData = this._onDidChangeTreeData.event;
  diffs = [];
  backgroundTasks = [];
  loaded = false;
  refresh() {
    this.loaded = false;
    this._onDidChangeTreeData.fire();
  }
  getTreeItem(item) {
    return item;
  }
  async getChildren(element) {
    const root = workspaceRoot();
    if (!root) {
      return [new InfoItem2("Open a workspace folder", "UR actions are scoped to the active project", "folder-opened")];
    }
    if (!this.loaded) {
      this.diffs = loadManifest(root).diffs;
      this.backgroundTasks = await loadBackgroundTasks(root);
      this.loaded = true;
    }
    if (!element) {
      if (this.diffs.length === 0 && this.backgroundTasks.length === 0) {
        return [];
      }
      return [
        new SectionItem("diffs", "Diff Bundles", this.diffs.length),
        new SectionItem("background", "Background Tasks", this.backgroundTasks.length)
      ];
    }
    if (element instanceof SectionItem && element.kind === "diffs") {
      if (this.diffs.length === 0) {
        return [new InfoItem2("No diff bundles", "Captured review bundles will appear here", "diff")];
      }
      return this.diffs.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((bundle) => new DiffTreeItem(bundle));
    }
    if (element instanceof SectionItem && element.kind === "background") {
      if (this.backgroundTasks.length === 0) {
        return [new InfoItem2("No background tasks", "Tasks started with `ur bg run` will appear here", "circle-outline")];
      }
      return this.backgroundTasks.map((task) => new BackgroundTaskItem(task));
    }
    return [];
  }
};

// src/chat/chatController.ts
var import_node_crypto2 = require("node:crypto");
var vscode6 = __toESM(require("vscode"));

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
var import_node_child_process3 = require("node:child_process");
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
var defaultSpawn = (command2, args, options) => (0, import_node_child_process3.spawn)(command2, args, options);
function runUrTurn(request, handlers, deps = {}) {
  const spawnFn = deps.spawn ?? defaultSpawn;
  const executable = deps.executable ?? (deps.command ? { command: deps.command, args: [], source: "configured", display: deps.command } : resolveUrCommand({ cwd: request.cwd }));
  const args = [...executable.args, ...buildUrArgs(request)];
  let child;
  try {
    child = spawnFn(executable.command, args, {
      cwd: request.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (error) {
    handlers.onExit({
      ok: false,
      exitCode: null,
      signal: null,
      canceled: false,
      sawResult: false,
      stderr: "",
      error: formatTurnFailure({
        executable,
        cwd: request.cwd,
        exitCode: null,
        signal: null,
        stderr: "",
        reason: `Failed to start: ${errorMessage2(error)}`
      })
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
  const finish = (exitCode, signal, spawnError) => {
    if (settled) return;
    settled = true;
    const stderr = stderrChunks.join("");
    const ok = !canceled && !spawnError && sawResult && !resultIsError;
    handlers.onExit({
      ok,
      exitCode,
      signal,
      canceled,
      sawResult,
      stderr,
      error: spawnError ?? (!ok && !canceled ? deriveErrorMessage(executable, request.cwd, sawResult, resultIsError, exitCode, signal, stderr) : void 0)
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
          message: `Permission prompt failed in the extension: ${errorMessage2(error)}`
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
    finish(
      null,
      null,
      formatTurnFailure({
        executable,
        cwd: request.cwd,
        exitCode: null,
        signal: null,
        stderr: stderrChunks.join(""),
        reason: `Failed to run: ${errorMessage2(error)}`
      })
    );
  });
  child.on("exit", (code, signal) => {
    for (const message of stdoutBuffer.flush()) {
      handleMessage(message);
    }
    finish(code, signal);
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
function deriveErrorMessage(executable, cwd, sawResult, resultIsError, exitCode, signal, stderr) {
  const reason = sawResult && resultIsError ? "UR reported an error completing this turn." : "UR exited without producing a successful result.";
  return formatTurnFailure({ executable, cwd, exitCode, signal, stderr, reason });
}
function formatTurnFailure(options) {
  const stderr = summarizeStderr(options.stderr);
  return [
    `UR chat backend failed.`,
    `Executable: ${options.executable.display}`,
    `cwd: ${options.cwd}`,
    `Exit: code ${options.exitCode ?? "unknown"}, signal ${options.signal ?? "none"}`,
    `stderr: ${stderr || "<empty>"}`,
    options.reason,
    `Hint: Set ur.executablePath in VS Code settings if the extension is using the wrong UR binary.`
  ].join("\n");
}
function summarizeStderr(stderr) {
  const trimmed = stderr.trim();
  if (trimmed.length <= 2e3) return trimmed;
  return `${trimmed.slice(0, 2e3)}\u2026`;
}
function errorMessage2(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/context/ideContext.ts
var path2 = __toESM(require("node:path"));
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
  const vscode18 = require("vscode");
  const editor = vscode18.window.activeTextEditor;
  if (!editor) return { workspaceRoot: vscode18.workspace.workspaceFolders?.[0]?.uri.fsPath };
  const workspaceRoot2 = vscode18.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath;
  const absolutePath = editor.document.uri.fsPath;
  const relativePath = workspaceRoot2 ? path2.relative(workspaceRoot2, absolutePath) : absolutePath;
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
var vscode5 = __toESM(require("vscode"));
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
      _ChatPanel.current.panel.reveal(vscode5.ViewColumn.Beside);
      return _ChatPanel.current;
    }
    const panel = vscode5.window.createWebviewPanel("urChat", "UR Chat", vscode5.ViewColumn.Beside, {
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
function buildRunSpecPrompt() {
  return "List the specs in this project (.ur/specs, via `ur spec list`) and help me run the next pending task. If none exist yet, help me scaffold one with `ur spec init`.";
}
function buildRunWorkflowPrompt() {
  return "List the workflows available in this project (`ur workflow list`) and help me run the appropriate one for my current task.";
}

// src/chat/chatController.ts
var ChatController = class {
  _onDidChangeState = new vscode6.EventEmitter();
  onDidChangeState = this._onDidChangeState.event;
  panel;
  record;
  attachments = [];
  status = "idle";
  turnHandle;
  activeTurnId = 0;
  pendingPermissions = /* @__PURE__ */ new Map();
  // --- commands ---
  async newChat() {
    const root = this.requireWorkspaceRoot();
    if (!root) return;
    this.turnHandle?.cancel();
    this.activeTurnId++;
    this.turnHandle = void 0;
    this.denyAllPending("A new chat was started.");
    this.record = createSession(root);
    this.attachments = [];
    this.status = "idle";
    this._onDidChangeState.fire();
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
      vscode6.window.showInformationMessage("No UR chat request is currently running.");
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
  isRequestRunning() {
    return this.status === "running";
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
  /** Opens chat and runs a fully-formed prompt through the same pathway as a
   * manual send — used by Review Current Diff and Run Verifier so neither
   * command invents a second way to talk to UR. */
  async runStructuredPrompt(promptText) {
    await this.dispatchTurn(promptText);
  }
  dispose() {
    this.turnHandle?.cancel();
    this.denyAllPending("Extension is shutting down.");
    this._onDidChangeState.dispose();
  }
  // --- internals ---
  requireWorkspaceRoot() {
    const root = workspaceRoot();
    if (!root) {
      vscode6.window.showWarningMessage("Open a workspace folder to use UR Chat.");
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
    const picked = await vscode6.window.showQuickPick(items, {
      title: "UR Chat",
      placeHolder: "Resume a chat or start a new one"
    });
    return picked?.id;
  }
  stageAttachment(kind) {
    const snapshot = captureEditorSnapshot();
    const reason = describeUnavailableReason(snapshot, kind);
    if (reason) {
      vscode6.window.showWarningMessage(reason);
      return;
    }
    if (this.record && snapshot.workspaceRoot !== this.record.session.workspaceRoot) {
      vscode6.window.showWarningMessage("The active file belongs to a different workspace folder. Start a new chat for that folder.");
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
      vscode6.window.showWarningMessage(reason);
      return;
    }
    await this.dispatchTurn(build(snapshot.selection));
  }
  /** The single pathway every turn goes through — manual sends and editor
   * actions alike. */
  async dispatchTurn(promptText) {
    const root = this.record?.session.workspaceRoot ?? this.requireWorkspaceRoot();
    if (!root) return;
    if (this.status === "running") {
      vscode6.window.showWarningMessage("UR is already running a request. Cancel it first or wait for it to finish.");
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
    this._onDidChangeState.fire();
    this.panel?.post({ type: "statusChanged", status: this.status });
    const resumeSessionId = this.record.session.cliSessionId;
    const turnId = ++this.activeTurnId;
    let exitedSynchronously = false;
    const handle = runUrTurn(
      { cwd: root, prompt: promptText, resumeSessionId },
      {
        onMessage: (message) => this.handleStreamMessage(root, sessionId, turnId, message),
        onControlRequest: (request) => this.handlePermissionRequest(turnId, request),
        onExit: (result) => {
          exitedSynchronously = true;
          this.handleTurnExit(root, sessionId, turnId, result);
        }
      },
      { executable: resolveUrCommand({ cwd: root, config: readUrCommandConfig() }) }
    );
    this.turnHandle = exitedSynchronously ? void 0 : handle;
  }
  handleStreamMessage(root, sessionId, turnId, message) {
    if (turnId !== this.activeTurnId) return;
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
  handlePermissionRequest(turnId, request) {
    if (turnId !== this.activeTurnId) {
      return Promise.resolve({ behavior: "deny", message: "This chat turn is no longer active." });
    }
    return new Promise((resolve3) => {
      const toolName = request.request.tool_name ?? "tool";
      const input = request.request.input ?? {};
      this.pendingPermissions.set(request.request_id, { resolve: resolve3, toolName, input, turnId });
      this.panel?.post({ type: "permissionRequest", requestId: request.request_id, toolName, input });
    });
  }
  handleTurnExit(root, sessionId, turnId, result) {
    if (turnId !== this.activeTurnId) return;
    this.turnHandle = void 0;
    this.denyAllPending("The chat turn ended before this request was answered.");
    if (result.canceled) {
      this.status = "canceled";
      this.appendChatMessage(root, sessionId, "status", [{ type: "text", text: "Canceled." }]);
    } else if (!result.ok) {
      this.status = "error";
      const message = result.error ?? "UR failed to complete this turn.";
      this.appendChatMessage(root, sessionId, "status", [{ type: "text", text: `Error: ${message}` }]);
      this.panel?.post({ type: "errorBanner", message });
    } else {
      this.status = "idle";
    }
    this._onDidChangeState.fire();
    this.panel?.post({ type: "statusChanged", status: this.status });
  }
  resolvePermission(requestId, decision) {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending || pending.turnId !== this.activeTurnId) return;
    this.pendingPermissions.delete(requestId);
    pending.resolve(
      decision === "allow" ? { behavior: "allow", updatedInput: pending.input } : { behavior: "deny", message: "User denied this tool call from the UR Chat panel." }
    );
    this.panel?.post({ type: "permissionResolved", requestId });
    const root = this.record?.session.workspaceRoot;
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

// src/chat/chatTreeProvider.ts
var vscode7 = __toESM(require("vscode"));
var ActionItem = class extends vscode7.TreeItem {
  constructor(label, description, icon, command2, tooltip) {
    super(label, vscode7.TreeItemCollapsibleState.None);
    this.contextValue = "urChatAction";
    this.description = description;
    this.iconPath = new vscode7.ThemeIcon(icon);
    this.tooltip = tooltip ?? `${label}${description ? ` - ${description}` : ""}`;
    this.command = command2;
  }
};
var InfoItem3 = class extends vscode7.TreeItem {
  constructor(label, description, icon = "comment-discussion") {
    super(label, vscode7.TreeItemCollapsibleState.None);
    this.contextValue = "urInfo";
    this.description = description;
    this.iconPath = new vscode7.ThemeIcon(icon);
    this.tooltip = `${label}${description ? ` - ${description}` : ""}`;
  }
};
var ChatTreeProvider = class {
  constructor(chat) {
    this.chat = chat;
  }
  chat;
  _onDidChangeTreeData = new vscode7.EventEmitter();
  onDidChangeTreeData = this._onDidChangeTreeData.event;
  refresh() {
    this._onDidChangeTreeData.fire();
  }
  getTreeItem(item) {
    return item;
  }
  getChildren() {
    const snapshot = captureEditorSnapshot();
    const items = [
      new InfoItem3("Start a UR chat", "Ask about this workspace or attach editor context."),
      new ActionItem("New Chat", "Start a fresh UR session", "comment-add", {
        command: "urInlineDiffs.chat.new",
        title: "New Chat"
      }),
      new ActionItem("Open Chat", "Resume an existing session", "comment", {
        command: "urInlineDiffs.chat.open",
        title: "Open Chat"
      }),
      new ActionItem("Pick Model", "Choose provider and model", "symbol-variable", {
        command: "urInlineDiffs.pickModel",
        title: "Pick Model"
      })
    ];
    if (snapshot.activeFile) {
      items.push(
        new ActionItem("Add Current File to Chat", snapshot.activeFile.path, "file-add", {
          command: "urInlineDiffs.chat.addFile",
          title: "Add Current File to Chat"
        })
      );
    }
    if (snapshot.selection) {
      const lineRange = snapshot.selection.startLine === snapshot.selection.endLine ? `${snapshot.selection.path}:${snapshot.selection.startLine}` : `${snapshot.selection.path}:${snapshot.selection.startLine}-${snapshot.selection.endLine}`;
      items.push(
        new ActionItem("Add Selection to Chat", lineRange, "selection", {
          command: "urInlineDiffs.chat.addSelection",
          title: "Add Selection to Chat"
        })
      );
    }
    if (this.chat.isRequestRunning()) {
      items.push(
        new ActionItem("Cancel Current Chat Request", "Stop the running request", "stop-circle", {
          command: "urInlineDiffs.chat.cancel",
          title: "Cancel Current Chat Request"
        })
      );
    }
    return items;
  }
};

// src/diffs/actions.ts
var import_node_child_process4 = require("node:child_process");
var fs3 = __toESM(require("node:fs"));
var import_node_util2 = require("node:util");
var vscode8 = __toESM(require("vscode"));
var execFileAsync2 = (0, import_node_util2.promisify)(import_node_child_process4.execFile);
async function commentDiff(item, provider) {
  const root = workspaceRoot();
  const bundle = item?.bundle;
  if (!root || !bundle) {
    vscode8.window.showWarningMessage("No UR inline diff selected.");
    return;
  }
  const text = await vscode8.window.showInputBox({
    title: `Comment on ${bundle.id}`,
    prompt: "Comment text",
    ignoreFocusOut: true
  });
  if (!text?.trim()) return;
  const manifest = loadManifest(root);
  const manifestBundle = manifest.diffs.find((diff) => diff.id === bundle.id);
  if (!manifestBundle) {
    vscode8.window.showErrorMessage(`UR inline diff not found: ${bundle.id}`);
    return;
  }
  const at = (/* @__PURE__ */ new Date()).toISOString();
  manifestBundle.status = "commented";
  manifestBundle.updatedAt = at;
  manifestBundle.comments = [...manifestBundle.comments ?? [], { at, text: text.trim() }];
  writeManifest(root, manifest);
  writeBundleMetadata(root, manifestBundle);
  provider.refresh();
  vscode8.window.showInformationMessage(`Added UR comment to ${bundle.id}.`);
}
async function applyDiff(item, provider) {
  const root = workspaceRoot();
  const bundle = item?.bundle;
  if (!root || !bundle) {
    vscode8.window.showWarningMessage("No UR inline diff selected.");
    return;
  }
  const patch = patchPath(root, bundle);
  if (!fs3.existsSync(patch)) {
    vscode8.window.showErrorMessage(`UR patch file missing for ${bundle.id}.`);
    return;
  }
  const choice = await vscode8.window.showWarningMessage(
    `Apply UR patch ${bundle.id} to your working tree? This modifies ${bundle.files?.length ?? 0} file(s).`,
    { modal: true },
    "Apply"
  );
  if (choice !== "Apply") return;
  try {
    await execFileAsync2("git", ["apply", "--whitespace=nowarn", patch], { cwd: root, shell: false });
  } catch (error) {
    vscode8.window.showErrorMessage(`Failed to apply UR patch ${bundle.id}: ${processErrorMessage(error)}`);
    return;
  }
  try {
    const { stdout } = await runUrCli(["ide", "diff", "approve", bundle.id], { cwd: root });
    provider.refresh();
    if (isNotFoundResult(stdout)) {
      vscode8.window.showWarningMessage(
        `Applied ${bundle.id} to disk, but no matching diff record was found to mark it approved.`
      );
      return;
    }
    vscode8.window.showInformationMessage(`Applied UR patch ${bundle.id}.`);
  } catch (error) {
    vscode8.window.showErrorMessage(
      `Applied ${bundle.id} to disk, but failed to record approval: ${errorMessage(error)}`
    );
  }
}
async function rejectDiff(item, provider) {
  const root = workspaceRoot();
  const bundle = item?.bundle;
  if (!root || !bundle) {
    vscode8.window.showWarningMessage("No UR inline diff selected.");
    return;
  }
  try {
    const { stdout } = await runUrCli(["ide", "diff", "reject", bundle.id], { cwd: root });
    provider.refresh();
    if (isNotFoundResult(stdout)) {
      vscode8.window.showErrorMessage(`UR inline diff not found: ${bundle.id}`);
      return;
    }
    vscode8.window.showInformationMessage(`Rejected UR patch ${bundle.id} (no files changed).`);
  } catch (error) {
    vscode8.window.showErrorMessage(errorMessage(error));
  }
}
async function showStatus(channel) {
  const root = workspaceRoot();
  if (!root) {
    vscode8.window.showWarningMessage("Open a workspace folder to query UR status.");
    return;
  }
  channel.clear();
  channel.show(true);
  channel.appendLine("Running: ur ide status");
  try {
    const { stdout } = await runUrCli(["ide", "status"], { cwd: root });
    channel.appendLine(stdout.trim());
  } catch (error) {
    channel.appendLine(errorMessage(error));
  }
}
function isNotFoundResult(stdout) {
  return stdout.trim().toLowerCase().includes("not found");
}

// src/diffs/webview.ts
var vscode9 = __toESM(require("vscode"));
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
    vscode9.window.showWarningMessage("No UR inline diff selected.");
    return;
  }
  const panel = vscode9.window.createWebviewPanel("urInlineDiff", `UR ${bundle.id}`, vscode9.ViewColumn.Active, {
    enableScripts: false
  });
  const latest = loadBundleMetadata(root, bundle);
  panel.webview.html = renderDiffHtml(root, latest);
}

// src/model/modelPicker.ts
var vscode10 = __toESM(require("vscode"));
function isRecord2(value) {
  return typeof value === "object" && value !== null;
}
function parseProviderList(raw) {
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.flatMap((entry) => {
      if (!isRecord2(entry) || typeof entry.id !== "string" || typeof entry.name !== "string") return [];
      return [
        {
          id: entry.id,
          name: entry.name,
          accessTypeLabel: typeof entry.accessTypeLabel === "string" ? entry.accessTypeLabel : void 0,
          providerKind: typeof entry.providerKind === "string" ? entry.providerKind : void 0,
          runtimeBackend: typeof entry.runtimeBackend === "string" ? entry.runtimeBackend : void 0
        }
      ];
    });
  } catch {
    return [];
  }
}
function parseProviderModels(raw) {
  try {
    const data = JSON.parse(raw);
    if (!isRecord2(data) || typeof data.provider !== "string" || !Array.isArray(data.models)) return void 0;
    const source = data.source === "live" || data.source === "cache" || data.source === "static" ? data.source : "static";
    return {
      provider: data.provider,
      source,
      warning: typeof data.warning === "string" ? data.warning : void 0,
      models: data.models.flatMap((model) => {
        if (!isRecord2(model) || typeof model.id !== "string") return [];
        return [
          {
            id: model.id,
            displayName: typeof model.displayName === "string" ? model.displayName : void 0,
            description: typeof model.description === "string" ? model.description : void 0,
            isDefault: Boolean(model.isDefault)
          }
        ];
      })
    };
  } catch {
    return void 0;
  }
}
function parseProviderStatus(raw) {
  try {
    const data = JSON.parse(raw);
    if (!isRecord2(data)) return {};
    return {
      provider: typeof data.provider === "string" ? data.provider : void 0,
      model: typeof data.model === "string" ? data.model : void 0
    };
  } catch {
    return {};
  }
}
function parseIdeStatus(raw) {
  try {
    const data = JSON.parse(raw);
    if (!isRecord2(data)) return {};
    const provider = isRecord2(data.provider) ? data.provider : {};
    return {
      model: typeof provider.model === "string" ? provider.model : void 0
    };
  } catch {
    return {};
  }
}
function selectionError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
async function pickProviderModel(cwd) {
  if (!cwd) {
    vscode10.window.showWarningMessage("Open a workspace folder to pick a UR model.");
    return;
  }
  const [{ stdout: providerStdout }, statusResult, ideStatusResult] = await Promise.all([
    runUrCliCapture(["provider", "list", "--json"], { cwd }),
    runUrCliCapture(["provider", "status", "--json"], { cwd }).catch(() => ({ stdout: "" })),
    runUrCliCapture(["ide", "status", "--json"], { cwd }).catch(() => ({ stdout: "" }))
  ]);
  const providers = parseProviderList(providerStdout);
  if (providers.length === 0) {
    vscode10.window.showWarningMessage("No UR providers were reported by `ur provider list`.");
    return;
  }
  const providerStatus = parseProviderStatus(statusResult.stdout);
  const ideStatus = parseIdeStatus(ideStatusResult.stdout);
  const status = { provider: providerStatus.provider, model: providerStatus.model ?? ideStatus.model };
  const pickedProvider = await vscode10.window.showQuickPick(
    providers.map((provider) => ({
      label: provider.name,
      description: provider.id === status.provider ? "current" : provider.id,
      detail: [provider.accessTypeLabel, provider.providerKind, provider.runtimeBackend].filter(Boolean).join(" \xB7 "),
      provider
    })),
    {
      title: "UR: Pick Model",
      placeHolder: "Choose a provider first"
    }
  );
  if (!pickedProvider) return;
  let modelsStdout = "";
  try {
    const result = await runUrCliCapture(["provider", "models", pickedProvider.provider.id, "--json"], { cwd });
    modelsStdout = result.stdout;
  } catch (error) {
    vscode10.window.showWarningMessage(
      `UR could not list models for ${pickedProvider.provider.name}: ${selectionError(error)}`
    );
    return;
  }
  const modelResult = parseProviderModels(modelsStdout);
  if (!modelResult || modelResult.models.length === 0) {
    vscode10.window.showWarningMessage(
      modelResult?.warning ?? `No models are available for ${pickedProvider.provider.name}. Run "ur provider doctor ${pickedProvider.provider.id}" to troubleshoot.`
    );
    return;
  }
  if (modelResult.warning) {
    vscode10.window.showWarningMessage(modelResult.warning);
  }
  const pickedModel = await vscode10.window.showQuickPick(
    modelResult.models.map((model) => ({
      label: model.displayName ?? model.id,
      description: [
        model.id === status.model ? "current" : model.id,
        model.isDefault ? "default" : "",
        modelResult.source
      ].filter(Boolean).join(" \xB7 "),
      detail: model.description,
      model
    })),
    {
      title: `UR: Pick Model for ${pickedProvider.provider.name}`,
      placeHolder: "Choose a model for this provider"
    }
  );
  if (!pickedModel) return;
  try {
    const { stdout } = await runUrCliCapture(
      ["provider", "select-model", pickedProvider.provider.id, pickedModel.model.id, "--json"],
      { cwd }
    );
    const parsed = JSON.parse(stdout);
    if (parsed.ok) {
      vscode10.window.showInformationMessage(
        `UR model set to ${parsed.model ?? pickedModel.model.id} for ${parsed.provider ?? pickedProvider.provider.id}.`
      );
      return;
    }
    vscode10.window.showErrorMessage(parsed.message ?? "UR could not save the selected model.");
  } catch (error) {
    vscode10.window.showErrorMessage(`UR could not save the selected model: ${selectionError(error)}`);
  }
}

// src/misc/quickCommands.ts
var vscode11 = __toESM(require("vscode"));
var UR_DOCS_URL = "https://github.com/Maitham16/UR#readme";
async function openSettings() {
  await vscode11.commands.executeCommand("workbench.action.openSettings", "UR");
}
async function openDocs() {
  await vscode11.env.openExternal(vscode11.Uri.parse(UR_DOCS_URL));
}
async function openArtifacts() {
  const root = workspaceRoot();
  if (!root) {
    vscode11.window.showWarningMessage("Open a workspace folder to view UR artifacts.");
    return;
  }
  const uri = vscode11.Uri.joinPath(vscode11.Uri.file(root), ".ur");
  try {
    await vscode11.commands.executeCommand("revealInExplorer", uri);
  } catch {
    vscode11.window.showInformationMessage("No .ur directory yet \u2014 it is created the first time UR runs in this workspace.");
  }
}
async function runSpecAction(chat) {
  await chat.runStructuredPrompt(buildRunSpecPrompt());
}
async function runWorkflowAction(chat) {
  await chat.runStructuredPrompt(buildRunWorkflowPrompt());
}

// src/options/agentOptionsPanel.ts
var vscode12 = __toESM(require("vscode"));

// src/options/agentOptions.ts
function ids(options) {
  return options.map((o) => o.id);
}
function isLocalOrServer(option) {
  return option.accessType === "local" || option.accessType === "server";
}
function buildRecommendations(options) {
  const local = options.filter(isLocalOrServer);
  const nativeStreaming = options.filter((o) => o.supportsNativeStreaming);
  const multimodal = options.filter((o) => o.multimodal === true);
  const toolCalling = options.filter((o) => o.supportsNativeToolCalls);
  const subscriptionCli = options.filter((o) => o.providerKind === "subscription-cli");
  const refactorCapable = options.filter((o) => o.providerKind === "ur-native" && o.supportsNativeToolCalls);
  const recommendations = [
    {
      category: "privacy",
      title: "Privacy",
      rationale: "Local/self-hosted runtimes keep prompts, code, and responses on your machine; nothing is sent to a third-party API.",
      recommendedProviderIds: ids(local)
    },
    {
      category: "speed",
      title: "Speed",
      rationale: "Local/self-hosted runtimes avoid a network round-trip per request. This reflects request path structure only \u2014 actual throughput depends on your hardware and the model you load.",
      recommendedProviderIds: ids(local)
    },
    {
      category: "multimodal",
      title: "Multimodal (image input)",
      rationale: "These providers accept image content at the provider level. Local/self-hosted and OpenAI-compatible endpoints are marked unknown below since support depends on the model currently loaded, not a fixed provider fact.",
      recommendedProviderIds: ids(multimodal)
    },
    {
      category: "tool-calling",
      title: "Native tool calling",
      rationale: "UR-native providers support UR-native tool-call parsing. Subscription CLI providers do not \u2014 UR passes prompt text to the external CLI and receives final text only.",
      recommendedProviderIds: ids(toolCalling)
    },
    {
      category: "native-streaming",
      title: "Native streaming",
      rationale: "These providers stream tokens as they are generated. Subscription CLI providers return final text output only, with no UR-native token stream.",
      recommendedProviderIds: ids(nativeStreaming)
    },
    {
      category: "subscription-cli-access",
      title: "Subscription CLI access",
      rationale: "For using an existing Codex CLI / Claude Code / Gemini CLI / Antigravity subscription through UR.",
      recommendedProviderIds: ids(subscriptionCli),
      caveat: subscriptionCli[0]?.safetyBoundaryLabel ?? "External vendor CLI boundary: UR passes prompt text to the official CLI and receives final text output only."
    },
    {
      category: "local-offline",
      title: "Local / offline",
      rationale: "Runs against a local or self-hosted endpoint; works without an internet connection once the runtime and model are available on your machine.",
      recommendedProviderIds: ids(local)
    },
    {
      category: "complex-refactor",
      title: "Complex, multi-step refactors",
      rationale: "Only UR-native providers with native tool calling get full UR tool-call parsing, sandbox, and verifier enforcement on every step. This is a structural capability statement, not a claim about model reasoning quality.",
      recommendedProviderIds: ids(refactorCapable)
    },
    {
      category: "docs-review",
      title: "Docs / review writing",
      rationale: "Docs and review tasks are typically single-turn text generation with light tool use, so no provider is structurally favored here \u2014 use whichever provider you already have configured for chat.",
      recommendedProviderIds: []
    }
  ];
  return recommendations;
}

// src/options/providerKnowledge.ts
var MULTIMODAL_TRUE = /* @__PURE__ */ new Set(["openai-api", "anthropic-api", "gemini-api", "openrouter"]);
var MULTIMODAL_FALSE = /* @__PURE__ */ new Set(["codex-cli", "claude-code-cli", "gemini-cli", "antigravity-cli"]);
function deriveMultimodalSupport(providerId) {
  if (MULTIMODAL_TRUE.has(providerId)) return true;
  if (MULTIMODAL_FALSE.has(providerId)) return false;
  return "unknown";
}

// src/options/providerOptionsLoader.ts
var PROVIDER_KINDS = ["ur-native", "subscription-cli", "subscription-placeholder"];
var ACCESS_TYPES = ["subscription", "api", "local", "server"];
function isRecord3(value) {
  return typeof value === "object" && value !== null;
}
function parseProviderListJson(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const options = [];
  for (const entry of data) {
    if (!isRecord3(entry)) continue;
    if (typeof entry.id !== "string" || typeof entry.name !== "string") continue;
    const providerKind = PROVIDER_KINDS.includes(entry.providerKind) ? entry.providerKind : "subscription-placeholder";
    const accessType = ACCESS_TYPES.includes(entry.accessType) ? entry.accessType : "api";
    options.push({
      id: entry.id,
      displayName: entry.name,
      providerKind,
      accessType,
      usesExternalCli: Boolean(entry.usesExternalCli),
      supportsNativeToolCalls: Boolean(entry.supportsNativeToolCalls),
      supportsNativeStreaming: Boolean(entry.supportsNativeStreaming),
      multimodal: deriveMultimodalSupport(entry.id),
      safetyBoundaryLabel: typeof entry.safetyBoundaryLabel === "string" ? entry.safetyBoundaryLabel : ""
    });
  }
  return options;
}
async function loadProviderOptions(cwd) {
  try {
    const { stdout } = await runUrCliCapture(["provider", "list", "--json"], { cwd });
    return parseProviderListJson(stdout);
  } catch {
    return [];
  }
}

// src/options/agentOptionsPanel.ts
function knownText(value) {
  if (value === "unknown") return "unknown";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}
function displayNameFor(options, id) {
  return options.find((o) => o.id === id)?.displayName ?? id;
}
function renderProviderTable(options) {
  if (options.length === 0) return '<p class="meta">No providers found. Is the UR CLI on PATH?</p>';
  const rows = options.map(
    (o) => `<tr><td>${escapeHtml(o.displayName)}</td><td>${escapeHtml(o.providerKind)}</td><td>${escapeHtml(o.accessType)}</td><td>${escapeHtml(knownText(o.multimodal))}</td></tr>`
  ).join("");
  return `<table><thead><tr><th>Provider</th><th>Provider kind</th><th>Access type</th><th>Multimodal</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function renderCategory(options, rec) {
  const names = rec.recommendedProviderIds.length > 0 ? rec.recommendedProviderIds.map((id) => escapeHtml(displayNameFor(options, id))).join(", ") : "(no provider structurally favored)";
  const caveat = rec.caveat ? `<p class="caveat">${escapeHtml(rec.caveat)}</p>` : "";
  return `<section class="category">
    <h3>${escapeHtml(rec.title)}</h3>
    <p>${escapeHtml(rec.rationale)}</p>
    <p class="recommend"><strong>Recommended:</strong> ${names}</p>
    ${caveat}
  </section>`;
}
function renderOptionsHtml(options) {
  const recommendations = buildRecommendations(options);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { font: 13px/1.6 var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px; margin: 0; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 6px; }
  h2 { font-size: 13px; margin: 20px 0 8px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.04em; }
  .disclaimer { color: var(--vscode-descriptionForeground); border-left: 3px solid var(--vscode-textBlockQuote-border); padding: 8px 12px; margin-bottom: 20px; background: var(--vscode-textBlockQuote-background); }
  table { border-collapse: collapse; width: 100%; margin-bottom: 12px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); }
  th { color: var(--vscode-descriptionForeground); font-weight: 600; }
  .category { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px 16px; margin-bottom: 14px; }
  .category h3 { margin: 0 0 6px; font-size: 13px; }
  .recommend { margin: 8px 0 0; }
  .caveat { color: var(--vscode-descriptionForeground); font-style: italic; margin: 8px 0 0; }
  .meta { color: var(--vscode-descriptionForeground); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 6px 14px; cursor: pointer; font: inherit; }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
  <h1>UR-Nexus Options</h1>
  <p class="disclaimer">Based on local, curated data and the UR CLI's own provider registry only. This is not live market research and does not rank model quality.</p>
  <h2>Providers</h2>
  ${renderProviderTable(options)}
  <h2>Recommendations</h2>
  ${recommendations.map((rec) => renderCategory(options, rec)).join("")}
  <button id="refresh">Refresh</button>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  </script>
</body>
</html>`;
}
function renderLoadingHtml() {
  return `<!doctype html><html><body style="font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground);"><p>Loading UR agent options\u2026</p></body></html>`;
}
var AgentOptionsPanel = class _AgentOptionsPanel {
  static current;
  panel;
  disposed = false;
  constructor(panel, onRefresh) {
    this.panel = panel;
    this.panel.webview.onDidReceiveMessage((message) => {
      if (message?.type === "refresh") onRefresh();
    });
    this.panel.onDidDispose(() => {
      this.disposed = true;
      if (_AgentOptionsPanel.current === this) _AgentOptionsPanel.current = void 0;
    });
  }
  static createOrShow(onRefresh) {
    if (_AgentOptionsPanel.current && !_AgentOptionsPanel.current.disposed) {
      _AgentOptionsPanel.current.panel.reveal(vscode12.ViewColumn.Active);
      return _AgentOptionsPanel.current;
    }
    const panel = vscode12.window.createWebviewPanel("urAgentOptions", "UR-Nexus Options", vscode12.ViewColumn.Active, {
      enableScripts: true
    });
    const instance = new _AgentOptionsPanel(panel, onRefresh);
    _AgentOptionsPanel.current = instance;
    return instance;
  }
  render(options) {
    if (this.disposed) return;
    this.panel.webview.html = renderOptionsHtml(options);
  }
  renderLoading() {
    if (this.disposed) return;
    this.panel.webview.html = renderLoadingHtml();
  }
};
async function showAgentOptions(cwd) {
  if (!cwd) {
    vscode12.window.showWarningMessage("Open a workspace folder to view UR agent options.");
    return;
  }
  let panel;
  const refresh = async () => {
    if (!panel) return;
    panel.renderLoading();
    const options = await loadProviderOptions(cwd);
    panel.render(options);
  };
  panel = AgentOptionsPanel.createOrShow(() => void refresh());
  await refresh();
}

// src/review/reviewDiff.ts
var import_node_child_process5 = require("node:child_process");
var import_node_util3 = require("node:util");
var vscode13 = __toESM(require("vscode"));

// src/review/reviewPrompt.ts
var LARGE_DIFF_THRESHOLD = 2e4;
function buildReviewPrompt(diff) {
  return [
    "Review the current git diff for correctness, style, and potential bugs.",
    "Point out specific issues with file references where possible, and suggest concrete improvements.",
    "",
    "```diff",
    diff,
    "```"
  ].join("\n");
}

// src/review/reviewDiff.ts
var execFileAsync3 = (0, import_node_util3.promisify)(import_node_child_process5.execFile);
async function captureGitDiff(cwd) {
  const { stdout } = await execFileAsync3("git", ["diff", "HEAD"], { cwd, shell: false });
  return stdout;
}
async function reviewCurrentDiff(chat) {
  const root = workspaceRoot();
  if (!root) {
    vscode13.window.showWarningMessage("Open a workspace folder to review a diff.");
    return;
  }
  let diff;
  try {
    diff = await captureGitDiff(root);
  } catch (error) {
    vscode13.window.showErrorMessage(`Could not read the current git diff: ${processErrorMessage(error)}`);
    return;
  }
  if (!diff.trim()) {
    vscode13.window.showInformationMessage("No changes to review (working tree matches HEAD).");
    return;
  }
  if (diff.length > LARGE_DIFF_THRESHOLD) {
    const choice = await vscode13.window.showWarningMessage(
      `The current diff is large (${diff.length.toLocaleString()} characters). Send it to UR for review?`,
      { modal: true },
      "Send"
    );
    if (choice !== "Send") return;
  }
  await chat.runStructuredPrompt(buildReviewPrompt(diff));
}

// src/search/searchQuickPick.ts
var vscode14 = __toESM(require("vscode"));

// src/search/actionRegistry.ts
var ACTION_REGISTRY = [
  { id: "newChat", label: "New Chat", commandId: "urInlineDiffs.chat.new", description: "Start a new UR chat session" },
  { id: "openChat", label: "Open Chat", commandId: "urInlineDiffs.chat.open", description: "Open or resume a UR chat session" },
  { id: "explainSelection", label: "Explain Selection", commandId: "urInlineDiffs.chat.explainSelection", description: "Ask UR to explain the current editor selection" },
  { id: "fixSelection", label: "Fix Selection", commandId: "urInlineDiffs.chat.fixSelection", description: "Ask UR to fix the current editor selection" },
  { id: "generateTests", label: "Generate Tests", commandId: "urInlineDiffs.chat.generateTests", description: "Ask UR to generate tests for the current selection" },
  { id: "reviewCurrentDiff", label: "Review Current Diff", commandId: "urInlineDiffs.reviewCurrentDiff", description: "Send the current git diff to UR for review" },
  { id: "runVerifier", label: "Run Verifier", commandId: "urInlineDiffs.runVerifier", description: "Run the UR verifier against the current changes" },
  { id: "providerStatus", label: "Provider Status", commandId: "urInlineDiffs.status", description: "Show provider, model, and plugin status" },
  { id: "agentStatus", label: "Agent Status", commandId: "urInlineDiffs.agentStatus", description: "Open the UR agent status card" },
  { id: "agentOptions", label: "Agent Options", commandId: "urInlineDiffs.agentOptions", description: "Open curated provider recommendations" },
  { id: "pickModel", label: "Pick Model", commandId: "urInlineDiffs.pickModel", description: "Choose a provider-scoped UR model" },
  { id: "openSettings", label: "Open Settings", commandId: "urInlineDiffs.openSettings", description: "Open VS Code settings filtered to UR" },
  { id: "openDocs", label: "Open Docs", commandId: "urInlineDiffs.openDocs", description: "Open the UR documentation" },
  { id: "openArtifacts", label: "Open Artifacts", commandId: "urInlineDiffs.openArtifacts", description: "Reveal the .ur workspace directory" },
  { id: "runSpec", label: "Run Spec", commandId: "urInlineDiffs.runSpec", description: "Ask UR to list and run specs (ur spec)" },
  { id: "runWorkflow", label: "Run Workflow", commandId: "urInlineDiffs.runWorkflow", description: "Ask UR to list and run workflows (ur workflow)" },
  { id: "refreshActions", label: "Refresh IDE Actions", commandId: "urActions.refresh", description: "Refresh the UR actions panel" }
];

// src/search/searchQuickPick.ts
async function showSearchActions() {
  const items = ACTION_REGISTRY.map((action) => ({
    label: action.label,
    detail: action.description,
    commandId: action.commandId
  }));
  const picked = await vscode14.window.showQuickPick(items, {
    title: "UR: Search Actions",
    placeHolder: "Search UR actions",
    matchOnDetail: true
  });
  if (!picked) return;
  await vscode14.commands.executeCommand(picked.commandId);
}

// src/status/statusPanel.ts
var vscode15 = __toESM(require("vscode"));

// src/status/statusData.ts
function isRecord4(value) {
  return typeof value === "object" && value !== null;
}
function safeParseRecord(raw) {
  try {
    const parsed = JSON.parse(raw);
    return isRecord4(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function asKnownString(value, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : "unknown";
}
function asKnownBoolean(value) {
  return typeof value === "boolean" ? value : "unknown";
}
function parseIdeStatusJson(raw, fallbackWorkspaceRoot = "") {
  const data = safeParseRecord(raw);
  const acpRaw = isRecord4(data.acp) ? data.acp : {};
  const providerRaw = isRecord4(data.provider) ? data.provider : {};
  return {
    workspaceRoot: typeof data.workspaceRoot === "string" && data.workspaceRoot ? data.workspaceRoot : fallbackWorkspaceRoot,
    acp: {
      running: Boolean(acpRaw.running),
      port: typeof acpRaw.port === "number" ? acpRaw.port : null,
      host: typeof acpRaw.host === "string" ? acpRaw.host : "127.0.0.1"
    },
    pluginCount: typeof data.pluginCount === "number" ? data.pluginCount : 0,
    warnings: Array.isArray(data.warnings) ? data.warnings.filter((w) => typeof w === "string") : [],
    sandboxMode: asKnownString(data.sandboxMode, ["disabled", "recommended", "required"]),
    verifierMode: asKnownString(data.verifierMode, ["off", "loose", "strict"]),
    providerLabel: typeof providerRaw.label === "string" ? providerRaw.label : "Unknown provider",
    providerModel: typeof providerRaw.model === "string" ? providerRaw.model : void 0
  };
}
function parseProviderStatusJson(raw) {
  const data = safeParseRecord(raw);
  return {
    providerId: typeof data.provider === "string" ? data.provider : void 0,
    providerKind: asKnownString(data.providerKind, ["ur-native", "subscription-cli", "subscription-placeholder"]),
    usesExternalCli: asKnownBoolean(data.usesExternalCli),
    supportsNativeToolCalls: asKnownBoolean(data.supportsNativeToolCalls),
    supportsNativeStreaming: asKnownBoolean(data.supportsNativeStreaming),
    safetyBoundaryLabel: typeof data.safetyBoundaryLabel === "string" ? data.safetyBoundaryLabel : void 0
  };
}
function errorMessage3(reason) {
  return reason instanceof Error ? reason.message : String(reason);
}
var defaultRunner = runUrCliCapture;
async function assembleAgentStatus(cwd, runCli = defaultRunner) {
  const [ideResult, providerResult, versionResult] = await Promise.allSettled([
    runCli(["ide", "status", "--json"], { cwd }),
    runCli(["provider", "status", "--json"], { cwd }),
    runCli(["--version"], { cwd })
  ]);
  const ide = ideResult.status === "fulfilled" ? parseIdeStatusJson(ideResult.value.stdout, cwd) : parseIdeStatusJson("", cwd);
  const provider = providerResult.status === "fulfilled" ? parseProviderStatusJson(providerResult.value.stdout) : parseProviderStatusJson("");
  const urVersion = versionResult.status === "fulfilled" ? versionResult.value.stdout.trim() || "unknown" : "unknown";
  const warnings = [...ide.warnings];
  if (ideResult.status === "rejected") warnings.push(`Could not read IDE status: ${errorMessage3(ideResult.reason)}`);
  if (providerResult.status === "rejected") warnings.push(`Could not read provider status: ${errorMessage3(providerResult.reason)}`);
  return {
    urVersion,
    workspaceRoot: ide.workspaceRoot,
    acp: ide.acp,
    provider: {
      label: ide.providerLabel,
      model: ide.providerModel,
      providerKind: provider.providerKind,
      usesExternalCli: provider.usesExternalCli,
      supportsNativeToolCalls: provider.supportsNativeToolCalls,
      supportsNativeStreaming: provider.supportsNativeStreaming,
      multimodal: provider.providerId ? deriveMultimodalSupport(provider.providerId) : "unknown",
      safetyBoundaryLabel: provider.safetyBoundaryLabel
    },
    sandboxMode: ide.sandboxMode,
    verifierMode: ide.verifierMode,
    pluginCount: ide.pluginCount,
    warnings
  };
}

// src/status/statusPanel.ts
function knownText2(value) {
  if (value === "unknown") return "unknown";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}
function row(label, value) {
  return `<div class="row"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`;
}
function renderStatusHtml(status) {
  const acp = status.acp.running ? `running on ${status.acp.host}:${status.acp.port}` : "not running";
  const warnings = status.warnings.length === 0 ? '<p class="meta">No warnings.</p>' : `<ul>${status.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul>`;
  const boundary = status.provider.safetyBoundaryLabel ? row("Safety boundary", status.provider.safetyBoundaryLabel) : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light dark; }
  body { font: 13px/1.5 var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px; margin: 0; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 16px; }
  .row { display: flex; justify-content: space-between; gap: 16px; padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  .label { color: var(--vscode-descriptionForeground); }
  .value { text-align: right; word-break: break-word; }
  section { margin-top: 20px; }
  h2 { font-size: 13px; margin: 0 0 8px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.04em; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 6px 14px; cursor: pointer; font: inherit; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  .meta { color: var(--vscode-descriptionForeground); }
  ul { margin: 4px 0 0; padding-left: 18px; }
</style>
</head>
<body>
  <h1>UR-Nexus Status</h1>
  ${row("UR version", status.urVersion)}
  ${row("Workspace root", status.workspaceRoot)}
  ${row("Provider", status.provider.label)}
  ${row("Model", status.provider.model ?? "(none selected)")}
  ${row("Provider kind", knownText2(status.provider.providerKind))}
  ${row("Uses external CLI", knownText2(status.provider.usesExternalCli))}
  ${row("Native tool-call support", knownText2(status.provider.supportsNativeToolCalls))}
  ${row("Native streaming support", knownText2(status.provider.supportsNativeStreaming))}
  ${row("Multimodal support", knownText2(status.provider.multimodal))}
  ${boundary}
  ${row("Sandbox mode", knownText2(status.sandboxMode))}
  ${row("Verifier mode", knownText2(status.verifierMode))}
  ${row("ACP server", acp)}
  ${row("Plugins loaded", String(status.pluginCount))}
  <section>
    <h2>Warnings</h2>
    ${warnings}
  </section>
  <section>
    <button id="refresh">Refresh</button>
  </section>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  </script>
</body>
</html>`;
}
function renderLoadingHtml2() {
  return `<!doctype html><html><body style="font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground);"><p>Loading UR agent status\u2026</p></body></html>`;
}
var StatusPanel = class _StatusPanel {
  static current;
  panel;
  disposed = false;
  constructor(panel, onRefresh) {
    this.panel = panel;
    this.panel.webview.onDidReceiveMessage((message) => {
      if (message?.type === "refresh") onRefresh();
    });
    this.panel.onDidDispose(() => {
      this.disposed = true;
      if (_StatusPanel.current === this) _StatusPanel.current = void 0;
    });
  }
  static createOrShow(onRefresh) {
    if (_StatusPanel.current && !_StatusPanel.current.disposed) {
      _StatusPanel.current.panel.reveal(vscode15.ViewColumn.Active);
      return _StatusPanel.current;
    }
    const panel = vscode15.window.createWebviewPanel("urAgentStatus", "UR-Nexus Status", vscode15.ViewColumn.Active, {
      enableScripts: true
    });
    const instance = new _StatusPanel(panel, onRefresh);
    _StatusPanel.current = instance;
    return instance;
  }
  render(status) {
    if (this.disposed) return;
    this.panel.webview.html = renderStatusHtml(status);
  }
  renderLoading() {
    if (this.disposed) return;
    this.panel.webview.html = renderLoadingHtml2();
  }
};
async function showAgentStatus(cwd) {
  if (!cwd) {
    vscode15.window.showWarningMessage("Open a workspace folder to view UR agent status.");
    return;
  }
  let panel;
  const refresh = async () => {
    if (!panel) return;
    panel.renderLoading();
    const status = await assembleAgentStatus(cwd);
    panel.render(status);
  };
  panel = StatusPanel.createOrShow(() => void refresh());
  await refresh();
}

// src/verify/runVerifier.ts
var vscode16 = __toESM(require("vscode"));

// src/verify/verifierPrompt.ts
function buildVerifierPrompt() {
  return [
    'Run verification on the current changes: spawn the verification subagent (Task tool, subagent_type="verification") to check the most recent task.',
    "Include in the subagent prompt: the files changed in the most recent task, a short summary of the approach taken, and any test/lint/build commands defined in the project.",
    "Wait for the VERDICT line from the subagent and report it verbatim, along with any findings. Do not declare the task complete unless the verdict is PASS."
  ].join("\n");
}

// src/verify/runVerifier.ts
async function runVerifier(chat) {
  const root = workspaceRoot();
  if (!root) {
    vscode16.window.showWarningMessage("Open a workspace folder to run the UR verifier.");
    return;
  }
  await chat.runStructuredPrompt(buildVerifierPrompt());
}

// src/extension.ts
function activate(context) {
  const diffTreeProvider = new DiffTreeProvider();
  const actionsTreeProvider = new ActionsTreeProvider();
  const channel = vscode17.window.createOutputChannel("UR");
  const chat = new ChatController();
  const chatTreeProvider = new ChatTreeProvider(chat);
  const chatTree = vscode17.window.createTreeView("urChat", {
    treeDataProvider: chatTreeProvider,
    showCollapseAll: false
  });
  const diffTree = vscode17.window.createTreeView("urInlineDiffs", {
    treeDataProvider: diffTreeProvider,
    showCollapseAll: false
  });
  const actionsTree = vscode17.window.createTreeView("urActions", {
    treeDataProvider: actionsTreeProvider,
    showCollapseAll: false
  });
  const bothDiffViews = {
    refresh: () => {
      diffTreeProvider.refresh();
      actionsTreeProvider.refresh();
    }
  };
  context.subscriptions.push(
    channel,
    chatTree,
    diffTree,
    actionsTree,
    chat,
    chat.onDidChangeState(() => chatTreeProvider.refresh()),
    vscode17.window.onDidChangeActiveTextEditor(() => chatTreeProvider.refresh()),
    vscode17.window.onDidChangeTextEditorSelection(() => chatTreeProvider.refresh()),
    vscode17.commands.registerCommand("urInlineDiffs.refresh", () => diffTreeProvider.refresh()),
    vscode17.commands.registerCommand("urInlineDiffs.open", (item) => openDiff(item)),
    vscode17.commands.registerCommand("urInlineDiffs.comment", (item) => commentDiff(item, bothDiffViews)),
    vscode17.commands.registerCommand("urInlineDiffs.apply", (item) => applyDiff(item, bothDiffViews)),
    vscode17.commands.registerCommand("urInlineDiffs.reject", (item) => rejectDiff(item, bothDiffViews)),
    vscode17.commands.registerCommand("urInlineDiffs.status", () => showStatus(channel)),
    vscode17.commands.registerCommand("urInlineDiffs.chat.new", () => chat.newChat()),
    vscode17.commands.registerCommand("urInlineDiffs.chat.open", () => chat.openChat()),
    vscode17.commands.registerCommand("urInlineDiffs.chat.cancel", () => chat.cancelCurrentRequest()),
    vscode17.commands.registerCommand("urInlineDiffs.chat.addFile", () => chat.addCurrentFileToChat()),
    vscode17.commands.registerCommand("urInlineDiffs.chat.addSelection", () => chat.addSelectionToChat()),
    vscode17.commands.registerCommand("urInlineDiffs.chat.explainSelection", () => chat.explainSelection()),
    vscode17.commands.registerCommand("urInlineDiffs.chat.fixSelection", () => chat.fixSelection()),
    vscode17.commands.registerCommand("urInlineDiffs.chat.generateTests", () => chat.generateTestsForSelection()),
    vscode17.commands.registerCommand("urInlineDiffs.agentStatus", () => showAgentStatus(workspaceRoot())),
    vscode17.commands.registerCommand("urInlineDiffs.agentOptions", () => showAgentOptions(workspaceRoot())),
    vscode17.commands.registerCommand("urInlineDiffs.reviewCurrentDiff", () => reviewCurrentDiff(chat)),
    vscode17.commands.registerCommand("urInlineDiffs.runVerifier", () => runVerifier(chat)),
    vscode17.commands.registerCommand("urInlineDiffs.searchActions", () => showSearchActions()),
    vscode17.commands.registerCommand("urInlineDiffs.pickModel", () => pickProviderModel(workspaceRoot())),
    vscode17.commands.registerCommand("urInlineDiffs.openSettings", () => openSettings()),
    vscode17.commands.registerCommand("urInlineDiffs.openDocs", () => openDocs()),
    vscode17.commands.registerCommand("urInlineDiffs.openArtifacts", () => openArtifacts()),
    vscode17.commands.registerCommand("urInlineDiffs.runSpec", () => runSpecAction(chat)),
    vscode17.commands.registerCommand("urInlineDiffs.runWorkflow", () => runWorkflowAction(chat)),
    vscode17.commands.registerCommand("urActions.refresh", () => actionsTreeProvider.refresh()),
    vscode17.commands.registerCommand("urActions.openBackgroundLog", (item) => openBackgroundLog(item))
  );
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
