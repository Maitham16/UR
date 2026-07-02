#!/usr/bin/env node
// Bundles src/extension.ts into a single CommonJS file the extension host
// can load directly. `vscode` stays external — the host provides it.
const { join } = require('node:path')
const esbuild = require('esbuild')

const root = __dirname

esbuild
  .build({
    entryPoints: [join(root, 'src', 'extension.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: join(root, 'out', 'extension.js'),
    external: ['vscode'],
    sourcemap: false,
    logLevel: 'info',
  })
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
