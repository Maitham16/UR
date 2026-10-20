import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'
import { getImageCreator, getImageProcessor } from '../tools/FileReadTool/imageProcessor.js'
import { loadProgram } from '../services/repoEditing/ast/typescriptEngine.js'
import { inspectNativeNvidiaGrpcContract } from '../services/providers/nvidiaGrpcRuntime.js'
import { parseCommandRaw, PARSE_ABORTED } from './bash/parser.js'
import { isInBundledMode } from './bundledMode.js'
import { getNativeResourcePath, loadNativeModule, readNativeResourceManifest, requireNativeResource } from './nativeResources.js'
import { loadPlaywright } from './playwrightRuntime.js'
import { ripgrepCommand } from './ripgrep.js'
import { runCleanupFunctions } from './cleanupRegistry.js'
import { nativePlatform } from './nativeRelease.js'
import { assertForgeRsaSecurity } from './forgeSecurity.js'

/** Release qualification entrypoint. No network, credentials, or provider calls. */
export async function runNativeSelfTest(): Promise<number> {
  const results: Array<{ name: string; passed: boolean; detail?: string }> = []
  async function check(name: string, action: () => unknown | Promise<unknown>) {
    try {
      await action()
      results.push({ name, passed: true })
    } catch (error) {
      const detail = error instanceof Error
        ? `${error.message}${error.cause instanceof Error ? `: ${error.cause.message}` : ''}`
        : String(error)
      results.push({ name, passed: false, detail })
    }
  }
  const workspace = await mkdtemp(join(tmpdir(), 'ur-native-self-test-'))
  try {
    await check('native-build-identity', () => {
      if (!isInBundledMode()) throw new Error('Not running a native UR release')
    })
    await check('bundled-rsa-security-regressions', () => {
      if (assertForgeRsaSecurity().length !== 7) throw new Error('Incomplete RSA security regression checks')
    })
    await check('resource-integrity', async () => {
      const manifest = readNativeResourceManifest()
      if (!manifest || Object.keys(manifest.files).length < 10) throw new Error('Incomplete native resource manifest')
      if (manifest.platform !== nativePlatform()) throw new Error('Native resource platform does not match this runtime')
      for (const [name, expected] of Object.entries(manifest.files)) {
        const path = requireNativeResource(name)
        const bytes = await readFile(path)
        if (bytes.length !== expected.size || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) {
          throw new Error(`Resource integrity failed: ${name}`)
        }
        if (process.platform !== 'win32' && ((await stat(path)).mode & 0o022) !== 0) {
          throw new Error(`Resource is writable by another account: ${name}`)
        }
      }
    })
    await check('packaged-ripgrep', async () => {
      await writeFile(join(workspace, 'search.txt'), 'native resource needle42\n')
      const { rgPath, rgArgs, argv0 } = ripgrepCommand()
      const result = spawnSync(rgPath, [...rgArgs, '-n', 'needle[0-9]+', workspace], { encoding: 'utf8', argv0 })
      if (result.status !== 0 || !result.stdout.includes('native resource needle42')) {
        throw new Error(result.stderr || 'Packaged rg could not search a fixture')
      }
    })
    await check('ripgrep-cancellation', async () => {
      const { rgPath, rgArgs, argv0 } = ripgrepCommand()
      const controller = new AbortController()
      await new Promise<void>((resolveCheck, reject) => {
        let matched = false
        let aborted = false
        const child = spawn(rgPath, [...rgArgs, '--line-buffered', '^native\\s+needle$'], {
          argv0, signal: controller.signal, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
        })
        const timer = setTimeout(() => { child.kill(); reject(new Error('Packaged rg did not cancel promptly')) }, 5000)
        child.stdout.on('data', bytes => {
          if (String(bytes).includes('native needle')) { matched = true; controller.abort() }
        })
        child.on('error', error => {
          if (error.name === 'AbortError') aborted = true
          else { clearTimeout(timer); reject(error) }
        })
        child.on('close', () => {
          clearTimeout(timer)
          if (matched && aborted) resolveCheck()
          else reject(new Error('Packaged rg cancellation was not observed'))
        })
        child.stdin.on('error', () => {})
        // Fill ripgrep's input buffer while retaining an open stream to cancel.
        child.stdin.write(`native needle\n${'irrelevant line\n'.repeat(10_000)}`)
      })
    })
    await check('resource-path-isolation', () => {
      let blocked = false
      try { getNativeResourcePath('../outside-installation') } catch { blocked = true }
      if (!blocked) throw new Error('Native resources allowed path traversal')
    })
    await check('sharp-and-libvips', async () => {
      const create = await getImageCreator()
      const processImage = await getImageProcessor()
      const image = await create({ create: { width: 8, height: 6, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer()
      const resized = await processImage(image).resize(4, 4, { fit: 'inside' }).jpeg().toBuffer()
      const metadata = await processImage(resized).metadata()
      if (metadata.width !== 4 || metadata.height !== 3 || metadata.format !== 'jpeg') throw new Error('Native image encode/resize/metadata failed')
      if (!loadNativeModule<{ versions?: { vips?: string } }>('sharp').versions?.vips) throw new Error('libvips was not loaded')
    })
    await check('typescript-standard-libraries', async () => {
      const file = join(workspace, 'types.ts')
      await writeFile(file, "const values: Array<number> = [1, 2];\nconst text = values.map(value => value.toFixed()).join(',');\n")
      const { program, checker } = loadProgram(workspace, ['types.ts'])
      const errors = ts.getPreEmitDiagnostics(program).filter(item => item.category === ts.DiagnosticCategory.Error)
      if (errors.length) throw new Error(ts.flattenDiagnosticMessageText(errors[0]!.messageText, '\n'))
      const source = program.getSourceFile(file)
      const statement = source?.statements[1]
      if (!statement || !ts.isVariableStatement(statement)) throw new Error('TypeScript fixture missing')
      const declaration = statement.declarationList.declarations[0]!
      if (checker.typeToString(checker.getTypeAtLocation(declaration.name)) !== 'string') throw new Error('Standard-library type inference failed')
    })
    await check('bash-permission-parser', async () => {
      const parsed = await parseCommandRaw('printf "%s" "safe;literal" && printf done')
      if (parsed === null || parsed === PARSE_ABORTED) throw new Error('Structured Bash parser is unavailable')
    })
    await check('packaged-browser-engine', async () => {
      const browser = await loadPlaywright()
      if (!browser.chromium || !browser._electron) throw new Error('Browser/Electron drivers are missing')
    })
    await check('nvidia-grpc-contracts', async () => {
      for (const model of ['nvidia/active-speaker-detection', 'nvidia/bnr', 'nvidia/magpie-tts-zeroshot', 'nvidia/studiovoice', 'nvidia/synthetic-video-detector']) {
        if (!(await inspectNativeNvidiaGrpcContract(model))?.path) throw new Error(`Missing embedded gRPC descriptor for ${model}`)
      }
    })
    await check('ide-and-viewer-assets', async () => {
      const vsix = await readFile(requireNativeResource('ide/ur-inline-diffs.vsix'))
      if (vsix[0] !== 0x50 || vsix[1] !== 0x4b) throw new Error('Bundled VSIX is not a ZIP archive')
      for (const name of ['hljs.css', 'diff2html.css', 'diff2html-ui.js']) {
        if ((await readFile(requireNativeResource(`viewer/${name}`))).length < 100) throw new Error(`Missing viewer asset ${name}`)
      }
    })
    await check('offline-plugin-catalog', async () => {
      const manifest = JSON.parse(await readFile(requireNativeResource('marketplace/.ur-plugin/marketplace.json'), 'utf8'))
      if (!Array.isArray(manifest.plugins) || manifest.plugins.length < 1) throw new Error('Bundled marketplace is empty')
      for (const plugin of manifest.plugins) {
        const source = plugin.source
        if (typeof source !== 'string' || !source.startsWith('./plugins/core/')) throw new Error('Unexpected bundled plugin source')
        requireNativeResource(`marketplace/${source.slice(2)}/.ur-plugin/plugin.json`)
      }
    })
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await runCleanupFunctions()
  }
  const passed = results.every(result => result.passed)
  process.stdout.write(`${JSON.stringify({ passed, results }, null, 2)}\n`)
  return passed ? 0 : 1
}
