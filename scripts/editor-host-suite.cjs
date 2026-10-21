const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vscode = require('vscode')
exports.run = async function () {
  const started = Date.now()
  const checks = []
  const workspace = vscode.workspace.workspaceFolders[0].uri.fsPath
  const resultPath = path.join(path.dirname(workspace), 'result.json')
  fs.writeFileSync(resultPath, JSON.stringify({ok:false, stage:'started', workspace}))
  const checkpoint = () => fs.writeFileSync(resultPath, JSON.stringify({ok:false, checks}))
  try {
    const extension = vscode.extensions.getExtension('ur-nexus.ur-inline-diffs')
    assert.ok(extension, 'Packaged extension was discovered')
    await extension.activate()
    assert.equal(extension.isActive, true)
    const commands = await vscode.commands.getCommands(true)
    for (const command of extension.packageJSON.contributes.commands) assert.ok(commands.includes(command.command), `Missing command ${command.command}`)
    checks.push('packaged activation and all declared commands'); checkpoint()
    await vscode.commands.executeCommand('urInlineDiffs.refresh')
    await vscode.commands.executeCommand('urActions.refresh')
    const root = vscode.workspace.workspaceFolders[0].uri.fsPath
    const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(path.join(root, 'sample.js')))
    editor.selection = new vscode.Selection(0, 0, 0, 43)
    const records = () => {
      const directory = path.join(root, '.ur/ide/chat/sessions')
      return fs.existsSync(directory) ? fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))) : []
    }
    const until = async check => { const end = Date.now() + 12000; while (Date.now() < end) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 50)) } throw Error('Timed out awaiting real host chat state') }
    const selectedEditor0 = await vscode.window.showTextDocument(editor.document, {viewColumn:vscode.ViewColumn.One,preserveFocus:false})
    selectedEditor0.selection = new vscode.Selection(0, 0, 0, 43)
    await vscode.commands.executeCommand('urInlineDiffs.chat.explainSelection')
    await until(() => JSON.stringify(records()).includes('host turn 1 café العربية'))
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.equal(records()[0].session.cliSessionId, 'host-cli-session')
    checks.push('editor selection to real child stream and Unicode persisted chat'); checkpoint()
    const selectedEditor1 = await vscode.window.showTextDocument(editor.document, {viewColumn:vscode.ViewColumn.One,preserveFocus:false})
    selectedEditor1.selection = new vscode.Selection(0, 0, 0, 43)
    await vscode.commands.executeCommand('urInlineDiffs.chat.explainSelection')
    await until(() => JSON.stringify(records()).includes('host turn 2 café العربية'))
    await new Promise(resolve => setTimeout(resolve, 200))
    const trace = fs.readFileSync(path.join(root, 'cli-trace.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter(args => args.includes('-p'))
    assert.equal(trace[1][trace[1].indexOf('--resume') + 1], 'host-cli-session')
    checks.push('second editor turn resumes native CLI session')
    const selectedEditor2 = await vscode.window.showTextDocument(editor.document, {viewColumn:vscode.ViewColumn.One,preserveFocus:false})
    selectedEditor2.selection = new vscode.Selection(0, 0, 0, 43)
    await vscode.commands.executeCommand('urInlineDiffs.chat.explainSelection')
    await new Promise(resolve => setTimeout(resolve, 300))
    await vscode.commands.executeCommand('urInlineDiffs.chat.cancel')
    await until(() => JSON.stringify(records()).toLowerCase().includes('canceled'))
    checks.push('cancel command terminates active child and records cancellation')
    fs.writeFileSync(resultPath, JSON.stringify({ ok: true, checks, durationMs: Date.now() - started }))
  } catch (error) {
    fs.writeFileSync(resultPath, JSON.stringify({ ok: false, checks, error: String(error), stack: error.stack }))
    throw error
  }
}
