#!/usr/bin/env node
// Build on the target OS/CPU: native addons and their shared libraries must match.
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertVersionConsistency } from './version-consistency.mjs'
import { NATIVE_BUN_VERSION, prepareNativeCompileExecutable, renameNativeBuildStage } from './native-compiler.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const bun = process.env.BUN_BIN || process.env.BUN_EXECUTABLE || 'bun'
const nativeBunVersion = NATIVE_BUN_VERSION

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

const platformTargets = {
  'darwin-arm64': { os: 'darwin', arch: 'arm64', bun: 'bun-darwin-arm64' },
  'darwin-x64': { os: 'darwin', arch: 'x64', bun: 'bun-darwin-x64' },
  'linux-x64': { os: 'linux', arch: 'x64', bun: 'bun-linux-x64-baseline' },
  'linux-arm64': { os: 'linux', arch: 'arm64', bun: 'bun-linux-arm64' },
  'win32-x64': { os: 'win32', arch: 'x64', bun: 'bun-windows-x64-baseline' },
}

function packageRoot(name, from = root) {
  const req = createRequire(join(from, 'package.json'))
  for (const directory of req.resolve.paths(name) ?? []) {
    const candidate = join(directory, name, 'package.json')
    if (existsSync(candidate) && JSON.parse(readFileSync(candidate, 'utf8')).name === name) return realpathSync(dirname(candidate))
  }
  try {
    return realpathSync(dirname(req.resolve(`${name}/package.json`)))
  } catch {
    let directory = dirname(req.resolve(name))
    while (true) {
      const path = join(directory, 'package.json')
      if (existsSync(path) && JSON.parse(readFileSync(path, 'utf8')).name === name) return realpathSync(directory)
      const parent = dirname(directory)
      if (parent === directory) throw new Error(`Cannot find installed package root for ${name}`)
      directory = parent
    }
  }
}

function copyTree(source, target) {
  cpSync(source, target, {
    recursive: true,
    dereference: true,
    filter: path => !['node_modules', '.git', '.DS_Store'].includes(path === source ? '' : path.slice(path.lastIndexOf(sep) + 1)),
  })
}

function allFiles(directory, prefix = '') {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    const path = join(directory, entry.name)
    if (lstatSync(path).isSymbolicLink()) throw new Error(`Native release must not contain symlink resources: ${path}`)
    if (entry.isDirectory()) files.push(...allFiles(path, name))
    else if (entry.isFile()) files.push(name)
  }
  return files
}

function manifestFiles(resources) {
  const files = {}
  for (const name of allFiles(resources)) {
    if (name === 'manifest.json') continue
    const bytes = readFileSync(join(resources, name))
    files[name] = { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }
  }
  return files
}

function normalizeResourceModes(directory) {
  chmodSync(directory, 0o755)
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (lstatSync(path).isSymbolicLink()) throw new Error(`Native release must not contain symlink resources: ${path}`)
    if (entry.isDirectory()) normalizeResourceModes(path)
    else if (entry.isFile()) chmodSync(path, statSync(path).mode & 0o111 ? 0o755 : 0o644)
  }
}

function createVSIX(destination) {
  const extension = join(root, 'extensions', 'vscode-ur-inline-diffs')
  const manifest = JSON.parse(readFileSync(join(extension, 'package.json'), 'utf8'))
  if (!existsSync(join(extension, 'out', 'extension.js'))) throw new Error('VS Code extension must be built before native packaging')
  const { zipSync } = require('fflate')
  const files = {}
  const extensionFiles = ['package.json', 'README.md', 'LICENSE'].filter(name => existsSync(join(extension, name)))
  for (const directory of ['out', 'media']) {
    if (existsSync(join(extension, directory))) extensionFiles.push(...allFiles(join(extension, directory)).map(name => `${directory}/${name}`))
  }
  for (const name of extensionFiles) {
    files[`extension/${name}`] = new Uint8Array(readFileSync(join(extension, name)))
  }
  const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  files['[Content_Types].xml'] = new TextEncoder().encode(`<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="md" ContentType="text/markdown"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>`)
  files['extension.vsixmanifest'] = new TextEncoder().encode(`<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="en-US" Id="${xml(manifest.name)}" Version="${xml(manifest.version)}" Publisher="${xml(manifest.publisher)}"/><DisplayName>${xml(manifest.displayName ?? manifest.name)}</DisplayName><Description xml:space="preserve">${xml(manifest.description ?? '')}</Description><Tags>ur,ai</Tags><Categories>Other</Categories><GalleryFlags>Public</GalleryFlags><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="${xml(manifest.engines.vscode)}"/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>`)
  writeFileSync(destination, Buffer.from(zipSync(files, { level: 6 })))
}

function bundleSharp(resources, copied) {
  const directory = join(resources, 'modules')
  mkdirSync(directory, { recursive: true })
  const destination = join(directory, 'sharp.cjs')
  const stagedRequire = createRequire(join(resources, 'package.json'))
  execFileSync(bun, [
    'build', stagedRequire.resolve('sharp'), '--target', 'node', '--format', 'cjs',
    '--outfile', destination, '--external', '@img/sharp-*',
  ], { cwd: root, stdio: 'inherit' })
  // Bun 1.3.14 compiled applications cannot reliably resolve package names in
  // external filesystem modules. Bundle the JS closure, then pin native addon
  // and libvips metadata exports to this installation's real files.
  const mappings = {}
  for (const name of copied.keys()) {
    if (!name.startsWith('@img/sharp-')) continue
    const metadata = JSON.parse(readFileSync(join(resources, 'node_modules', name, 'package.json'), 'utf8'))
    for (const exported of Object.keys(metadata.exports ?? {})) {
      if (exported !== '.' && !exported.startsWith('./')) continue
      const specifier = exported === '.' ? name : `${name}/${exported.slice(2)}`
      const entry = realpathSync(stagedRequire.resolve(specifier))
      const resourceRelative = relative(realpathSync(resources), entry)
      if (resourceRelative === '..' || resourceRelative.startsWith(`..${sep}`) || isAbsolute(resourceRelative)) throw new Error(`Native image export escapes its resources: ${specifier}`)
      mappings[specifier] = relative(realpathSync(directory), entry).split(sep).join('/')
    }
  }
  const source = readFileSync(destination, 'utf8')
  const shim = `// Generated native resource export map; no project module lookup.\nconst urOriginalRequire = require;\nconst urNativeExports = ${JSON.stringify(mappings)};\nrequire = Object.assign(specifier => urOriginalRequire(urNativeExports[specifier] ?? specifier), urOriginalRequire);\n`
  writeFileSync(destination, shim + source)
}

function validateNativeModules(resources) {
  // A child releases its dlopen handles before Windows renames/cleans the stage.
  execFileSync(process.execPath, ['--input-type=commonjs', '-e', `
    const {createRequire} = require('node:module');
    const {realpathSync} = require('node:fs');
    const {join,relative,sep,isAbsolute} = require('node:path');
    const root = process.argv[1];
    const req = createRequire(join(root, 'package.json'));
    const modules = realpathSync(join(root, 'node_modules'));
    function staged(name) {
      const entry = realpathSync(req.resolve(name));
      const rel = relative(modules, entry);
      if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Staged module escapes release: ' + name);
      return req(entry);
    }
    (async () => {
      for (const sharp of [staged('sharp'), req(join(root, 'modules', 'sharp.cjs'))]) {
        if (typeof sharp !== 'function' || !sharp.versions?.vips) throw new Error('Staged sharp/libvips did not load');
        const image = await sharp({create:{width:2,height:2,channels:3,background:{r:1,g:2,b:3}}}).png().toBuffer();
        if ((await sharp(image).metadata()).width !== 2) throw new Error('Staged native image processing failed');
      }
      if (!staged('playwright-core').chromium) throw new Error('Staged browser engine did not load');
    })().catch(error => {console.error(error); process.exitCode=1});
  `, resources], { cwd: root, stdio: 'inherit', timeout: 30_000 })
}

async function build() {
  const compilerVersion = execFileSync(bun, ['--version'], { encoding: 'utf8' }).trim()
  if (compilerVersion !== nativeBunVersion) throw new Error(`Native releases require the tested Bun ${nativeBunVersion} compiler; found ${compilerVersion}`)
  const target = option('--target', `${process.platform}-${process.arch}`)
  const config = platformTargets[target]
  if (!config) throw new Error(`Unsupported native target ${target}`)
  if (config.os !== process.platform || config.arch !== process.arch) {
    throw new Error(`Build ${target} on its own OS/CPU runner so native dependencies match; current host is ${process.platform}-${process.arch}`)
  }
  if (config.os === 'linux') {
    const libc = createRequire(join(packageRoot('sharp'), 'package.json'))('detect-libc').familySync()
    if ((libc === 'musl') !== (config.libc === 'musl')) throw new Error(`Host libc ${libc} does not match ${target}`)
  }
  assertVersionConsistency(root, pkg.version)
  const out = resolve(root, option('--out-dir', 'dist-native'))
  if (out === root || root.startsWith(`${out}${sep}`) || out === join(root, 'src') || out.startsWith(`${join(root, 'src')}${sep}`)) {
    throw new Error('Choose a separate native build output directory')
  }
  mkdirSync(out, { recursive: true })
  const compileExecutable = await prepareNativeCompileExecutable(target, join(out, '.compiler-cache'))
  const stage = mkdtempSync(join(out, `.build-${target}-`))
  const resources = join(stage, 'resources')
  mkdirSync(resources, { recursive: true })
  const notices = [`UR-Nexus ${pkg.version} — native resource notices\n`]
  const copied = new Map()
  const noticed = new Set()

  function notice(source, metadata) {
    const identity = `${metadata.name}@${metadata.version}`
    if (noticed.has(identity)) return
    noticed.add(identity)
    notices.push(`\n--- ${metadata.name}@${metadata.version} (${metadata.license ?? 'see license files'}) ---\n`)
    for (const name of readdirSync(source).filter(name => /^(?:licen[cs]e|notice|copying|copyright)(?:\.|-|$)/i.test(name))) {
      const path = join(source, name)
      if (statSync(path).isFile()) notices.push(`${name}:\n${readFileSync(path, 'utf8')}\n`)
    }
  }

  const noticeRoots = new Set()
  function noticeClosure(name, from = root, optional = false) {
    let source
    try { source = packageRoot(name, from) } catch (error) {
      if (optional) return
      throw error
    }
    if (noticeRoots.has(source)) return
    noticeRoots.add(source)
    const metadata = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    notice(source, metadata)
    for (const dependency of Object.keys(metadata.dependencies ?? {})) noticeClosure(dependency, source)
    for (const dependency of Object.keys(metadata.optionalDependencies ?? {})) noticeClosure(dependency, source, true)
    for (const dependency of Object.keys(metadata.peerDependencies ?? {})) noticeClosure(dependency, source, true)
  }

  function copyModule(name, from = root, optional = false) {
    let source
    try { source = packageRoot(name, from) } catch (error) {
      if (optional) return
      throw error
    }
    const metadata = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    const prior = copied.get(name)
    if (prior) {
      if (prior !== metadata.version) throw new Error(`Native dependency version conflict for ${name}: ${prior} / ${metadata.version}`)
      return
    }
    copied.set(name, metadata.version)
    copyTree(source, join(resources, 'node_modules', name))
    notice(source, metadata)
    for (const dependency of Object.keys(metadata.dependencies ?? {})) copyModule(dependency, source)
    for (const dependency of Object.keys(metadata.optionalDependencies ?? {})) copyModule(dependency, source, true)
  }

  try {
    writeFileSync(join(resources, 'package.json'), JSON.stringify({
      name: 'ur-native-resources', private: true, version: pkg.version,
      urNativeModuleEntrypoints: { sharp: 'modules/sharp.cjs' },
    }))
    copyModule('sharp')
    copyModule('playwright-core')
    bundleSharp(resources, copied)
    validateNativeModules(resources)

    mkdirSync(join(resources, 'bin'), { recursive: true })
    const { rgPath } = require('@vscode/ripgrep')
    const rgName = process.platform === 'win32' ? 'rg.exe' : 'rg'
    cpSync(rgPath, join(resources, 'bin', rgName))
    chmodSync(join(resources, 'bin', rgName), 0o755)
    execFileSync(join(resources, 'bin', rgName), ['--version'], { stdio: 'ignore' })
    const rgPackageRoot = packageRoot('@vscode/ripgrep')
    notice(rgPackageRoot, JSON.parse(readFileSync(join(rgPackageRoot, 'package.json'), 'utf8')))

    const tsRoot = packageRoot('typescript')
    const tsLib = join(resources, 'typescript', 'lib')
    mkdirSync(tsLib, { recursive: true })
    for (const name of readdirSync(join(tsRoot, 'lib')).filter(name => /^lib.*\.d\.ts$/.test(name))) {
      cpSync(join(tsRoot, 'lib', name), join(tsLib, name))
    }
    notice(tsRoot, JSON.parse(readFileSync(join(tsRoot, 'package.json'), 'utf8')))

    const sandboxRoot = packageRoot('@anthropic-ai/sandbox-runtime')
    if (existsSync(join(sandboxRoot, 'vendor'))) copyTree(join(sandboxRoot, 'vendor'), join(resources, 'sandbox'))
    notice(sandboxRoot, JSON.parse(readFileSync(join(sandboxRoot, 'package.json'), 'utf8')))
    if (process.platform === 'linux' && !existsSync(join(resources, 'sandbox', 'seccomp', process.arch, 'apply-seccomp'))) {
      throw new Error('Linux native release is missing the sandbox seccomp helper')
    }
    if (process.platform === 'win32' && !existsSync(join(resources, 'sandbox', 'srt-win', process.arch, 'srt-win.exe'))) {
      throw new Error('Windows native release is missing the packaged sandbox helper')
    }

    mkdirSync(join(resources, 'viewer'), { recursive: true })
    for (const [name, spec] of Object.entries({
      'hljs.css': 'highlight.js/styles/github.min.css',
      'diff2html.css': 'diff2html/bundles/css/diff2html.min.css',
      'diff2html-ui.js': 'diff2html/bundles/js/diff2html-ui.min.js',
    })) cpSync(require.resolve(spec), join(resources, 'viewer', name))
    for (const name of ['highlight.js', 'diff2html']) {
      const directory = packageRoot(name)
      notice(directory, JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')))
    }

    mkdirSync(join(resources, 'ide'), { recursive: true })
    createVSIX(join(resources, 'ide', 'ur-inline-diffs.vsix'))
    const marketplace = join(resources, 'marketplace')
    mkdirSync(join(marketplace, '.ur-plugin'), { recursive: true })
    cpSync(join(root, '.ur-plugin', 'marketplace.json'), join(marketplace, '.ur-plugin', 'marketplace.json'))
    copyTree(join(root, 'plugins', 'core'), join(marketplace, 'plugins', 'core'))
    cpSync(join(root, 'LICENSE'), join(resources, 'LICENSE'))
    // Most statically bundled runtime imports are build dependencies in this
    // repository. Include the entire installed dependency closure's notices.
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) noticeClosure(name)
    const securityPatches = join(resources, 'security-patches')
    mkdirSync(securityPatches, { recursive: true })
    for (const name of ['node-forge-security.json', 'node-forge@1.4.0.patch', 'README.md']) cpSync(join(root, 'patches', name), join(securityPatches, name))
    copyTree(join(root, 'third-party', 'bun'), join(resources, 'runtime-notices', 'bun'))
    notices.push(`\n--- Embedded Bun ${nativeBunVersion} runtime ---\nSee runtime-notices/bun/LICENSE.md for upstream component licenses, source and relinking instructions.\n`)
    writeFileSync(join(resources, 'third-party-notices.txt'), notices.join('\n'))
    // Package-manager extraction modes must not ship writable native code.
    normalizeResourceModes(resources)
    writeFileSync(join(resources, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, version: pkg.version, platform: target,
      modules: Object.fromEntries(copied), files: manifestFiles(resources),
    }, null, 2) + '\n', { mode: 0o644 })

    const executable = join(stage, process.platform === 'win32' ? 'ur.exe' : 'ur')
    execFileSync(bun, [
      'build', 'src/entrypoints/cli.tsx', '--compile', '--target', config.bun,
      ...(compileExecutable ? ['--compile-executable-path', compileExecutable] : []),
      '--no-compile-autoload-bunfig',
      '--outfile', executable,
      '--external', 'sharp', '--external', 'audio-capture-napi', '--external', 'playwright-core',
      '--define', 'UR_NATIVE_BUILD=true',
      '--define', `MACRO.VERSION=${JSON.stringify(pkg.version)}`,
      '--define', 'MACRO.BUILD_TIME=""',
      '--define', `MACRO.PACKAGE_URL=${JSON.stringify(pkg.name)}`,
      '--define', 'MACRO.NATIVE_PACKAGE_URL=undefined',
      '--define', `MACRO.FEEDBACK_CHANNEL=${JSON.stringify(pkg.bugs.url)}`,
      '--define', `MACRO.ISSUES_EXPLAINER=${JSON.stringify(`file an issue at ${pkg.bugs.url}`)}`,
      '--define', 'MACRO.VERSION_CHANGELOG=""',
      '--feature=VOICE_MODE', '--feature=CHICAGO_MCP', '--feature=TREE_SITTER_BASH',
      '--feature=BUILTIN_EXPLORE_PLAN_AGENTS',
    ], { cwd: root, stdio: 'inherit' })
    chmodSync(executable, 0o755)
    const result = spawnSync(executable, ['--version'], { encoding: 'utf8', env: { ...process.env, UR_CONFIG_DIR: join(stage, '.smoke-config') } })
    if (result.status !== 0 || result.stdout.trim() !== `${pkg.version} (UR-Nexus)`) {
      throw new Error(`Native executable startup failed: ${result.stderr || result.stdout}`)
    }
    rmSync(join(stage, '.smoke-config'), { recursive: true, force: true })
    const destination = join(out, target)
    // Only replace this build script's generated target directory.
    if (existsSync(destination)) {
      if (!existsSync(join(destination, 'resources', 'manifest.json'))) throw new Error(`Refusing to replace non-release directory ${destination}`)
      rmSync(destination, { recursive: true })
    }
    await renameNativeBuildStage(stage, destination, { onRetry(error, attempt) {
      if (attempt === 1) console.warn(`Windows native build directory is temporarily locked (${error.code}); retrying for up to 15 seconds`)
    } })
    console.log(`Native release built: ${destination}`)
  } catch (error) {
    try { rmSync(stage, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }
    catch (cleanupError) { console.warn(`Native build stage cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`) }
    throw error
  }
}

try { await build() } catch (error) {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
}
