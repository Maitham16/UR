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
var vscode5 = __toESM(require("vscode"));

// src/diffs/actions.ts
var import_node_child_process2 = require("node:child_process");
var fs2 = __toESM(require("node:fs"));
var import_node_util2 = require("node:util");
var vscode2 = __toESM(require("vscode"));

// src/bridge/urCli.ts
var import_node_child_process = require("node:child_process");
var import_node_util = require("node:util");
var execFileAsync = (0, import_node_util.promisify)(import_node_child_process.execFile);
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

// src/diffs/store.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var vscode = __toESM(require("vscode"));
function workspaceRoot() {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}
function diffsRoot(root) {
  return path.join(root, ".ur", "ide", "diffs");
}
function manifestPath(root) {
  return path.join(diffsRoot(root), "manifest.json");
}
function patchPath(root, bundle) {
  return path.join(diffsRoot(root), bundle.patchFile);
}
function metadataPath(root, bundle) {
  return path.join(diffsRoot(root), bundle.metadataFile);
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

// src/diffs/actions.ts
var execFileAsync2 = (0, import_node_util2.promisify)(import_node_child_process2.execFile);
async function commentDiff(item, provider) {
  const root = workspaceRoot();
  const bundle = item?.bundle;
  if (!root || !bundle) {
    vscode2.window.showWarningMessage("No UR inline diff selected.");
    return;
  }
  const text = await vscode2.window.showInputBox({
    title: `Comment on ${bundle.id}`,
    prompt: "Comment text",
    ignoreFocusOut: true
  });
  if (!text?.trim()) return;
  const manifest = loadManifest(root);
  const manifestBundle = manifest.diffs.find((diff) => diff.id === bundle.id);
  if (!manifestBundle) {
    vscode2.window.showErrorMessage(`UR inline diff not found: ${bundle.id}`);
    return;
  }
  const at = (/* @__PURE__ */ new Date()).toISOString();
  manifestBundle.status = "commented";
  manifestBundle.updatedAt = at;
  manifestBundle.comments = [...manifestBundle.comments ?? [], { at, text: text.trim() }];
  writeManifest(root, manifest);
  writeBundleMetadata(root, manifestBundle);
  provider.refresh();
  vscode2.window.showInformationMessage(`Added UR comment to ${bundle.id}.`);
}
async function applyDiff(item, provider) {
  const root = workspaceRoot();
  const bundle = item?.bundle;
  if (!root || !bundle) {
    vscode2.window.showWarningMessage("No UR inline diff selected.");
    return;
  }
  const patch = patchPath(root, bundle);
  if (!fs2.existsSync(patch)) {
    vscode2.window.showErrorMessage(`UR patch file missing for ${bundle.id}.`);
    return;
  }
  const choice = await vscode2.window.showWarningMessage(
    `Apply UR patch ${bundle.id} to your working tree? This modifies ${bundle.files?.length ?? 0} file(s).`,
    { modal: true },
    "Apply"
  );
  if (choice !== "Apply") return;
  try {
    await execFileAsync2("git", ["apply", "--whitespace=nowarn", patch], { cwd: root, shell: false });
  } catch (error) {
    vscode2.window.showErrorMessage(`Failed to apply UR patch ${bundle.id}: ${gitErrorMessage(error)}`);
    return;
  }
  try {
    const { stdout } = await runUrCli(["ide", "diff", "approve", bundle.id], { cwd: root });
    provider.refresh();
    if (isNotFoundResult(stdout)) {
      vscode2.window.showWarningMessage(
        `Applied ${bundle.id} to disk, but no matching diff record was found to mark it approved.`
      );
      return;
    }
    vscode2.window.showInformationMessage(`Applied UR patch ${bundle.id}.`);
  } catch (error) {
    vscode2.window.showErrorMessage(
      `Applied ${bundle.id} to disk, but failed to record approval: ${errorMessage(error)}`
    );
  }
}
async function rejectDiff(item, provider) {
  const root = workspaceRoot();
  const bundle = item?.bundle;
  if (!root || !bundle) {
    vscode2.window.showWarningMessage("No UR inline diff selected.");
    return;
  }
  try {
    const { stdout } = await runUrCli(["ide", "diff", "reject", bundle.id], { cwd: root });
    provider.refresh();
    if (isNotFoundResult(stdout)) {
      vscode2.window.showErrorMessage(`UR inline diff not found: ${bundle.id}`);
      return;
    }
    vscode2.window.showInformationMessage(`Rejected UR patch ${bundle.id} (no files changed).`);
  } catch (error) {
    vscode2.window.showErrorMessage(errorMessage(error));
  }
}
async function showStatus(channel) {
  const root = workspaceRoot();
  if (!root) {
    vscode2.window.showWarningMessage("Open a workspace folder to query UR status.");
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
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function gitErrorMessage(error) {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = error.stderr;
    if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  }
  return errorMessage(error);
}

// src/diffs/treeProvider.ts
var fs3 = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));
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
var ActionItem = class extends vscode3.TreeItem {
  constructor(label, description, icon, command, tooltip) {
    super(label, vscode3.TreeItemCollapsibleState.None);
    this.contextValue = "urAction";
    this.description = description;
    this.iconPath = new vscode3.ThemeIcon(icon);
    this.tooltip = tooltip ?? `${label}${description ? ` \u2014 ${description}` : ""}`;
    this.command = command;
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
      return [
        new InfoItem(
          "Ready for inline review",
          fs3.existsSync(manifestPath(root)) ? "No pending diff bundles" : "No diff bundles captured yet",
          "pass"
        ),
        new ActionItem("Show UR status", "Provider, model, plugins", "pulse", {
          command: "urInlineDiffs.status",
          title: "Show UR Status"
        }),
        new ActionItem("Refresh", path2.relative(root, manifestPath(root)), "refresh", {
          command: "urInlineDiffs.refresh",
          title: "Refresh Inline Diffs"
        })
      ];
    }
    return diffs.map((bundle) => new DiffTreeItem(bundle));
  }
};

// src/diffs/webview.ts
var vscode4 = __toESM(require("vscode"));
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
    vscode4.window.showWarningMessage("No UR inline diff selected.");
    return;
  }
  const panel = vscode4.window.createWebviewPanel("urInlineDiff", `UR ${bundle.id}`, vscode4.ViewColumn.Active, {
    enableScripts: false
  });
  const latest = loadBundleMetadata(root, bundle);
  panel.webview.html = renderDiffHtml(root, latest);
}

// src/extension.ts
function activate(context) {
  const provider = new DiffTreeProvider();
  const channel = vscode5.window.createOutputChannel("UR");
  const tree = vscode5.window.createTreeView("urInlineDiffs", {
    treeDataProvider: provider,
    showCollapseAll: false
  });
  context.subscriptions.push(
    channel,
    tree,
    vscode5.commands.registerCommand("urInlineDiffs.refresh", () => provider.refresh()),
    vscode5.commands.registerCommand("urInlineDiffs.open", (item) => openDiff(item)),
    vscode5.commands.registerCommand("urInlineDiffs.comment", (item) => commentDiff(item, provider)),
    vscode5.commands.registerCommand("urInlineDiffs.apply", (item) => applyDiff(item, provider)),
    vscode5.commands.registerCommand("urInlineDiffs.reject", (item) => rejectDiff(item, provider)),
    vscode5.commands.registerCommand("urInlineDiffs.status", () => showStatus(channel))
  );
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
