#!/usr/bin/env node
import path from 'node:path'
import ts from 'typescript'

const root = process.cwd()
const configPath = path.join(root, 'tsconfig.strict-core.json')
const configFile = ts.readConfigFile(configPath, ts.sys.readFile)

if (configFile.error) {
  reportDiagnostics([configFile.error])
  process.exit(1)
}

const parsed = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  root,
  {
    noEmit: true,
    noImplicitAny: true,
    strictNullChecks: true,
  },
  configPath,
)

const rootFiles = new Set(parsed.fileNames.map(file => path.resolve(file)))
const program = ts.createProgram(parsed.fileNames, parsed.options)
const diagnostics = ts
  .getPreEmitDiagnostics(program)
  .filter(diagnostic => {
    if (!diagnostic.file) return false
    return rootFiles.has(path.resolve(diagnostic.file.fileName))
  })

if (diagnostics.length > 0) {
  reportDiagnostics(diagnostics)
  process.exit(1)
}

console.log(
  `Strict core typecheck passed (${rootFiles.size} files, noImplicitAny + strictNullChecks).`,
)

function reportDiagnostics(diagnostics) {
  const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: fileName => fileName,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  })
  process.stderr.write(formatted)
}
