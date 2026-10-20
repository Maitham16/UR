import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isInBundledMode } from './bundledMode.js'
import { getBuildVersion } from './buildVersion.js'

/** Native releases install their executable and resources together. Never use cwd. */
let nativeResourcesRoot: string | undefined

export function getNativeResourcesRoot(): string | null {
  if (!isInBundledMode()) return null
  // Pin this process to the version it launched, even if a stable symlink updates.
  nativeResourcesRoot ??= join(dirname(realpathSync(process.execPath)), 'resources')
  return nativeResourcesRoot
}

export function getNativeResourcePath(resource: string): string | null {
  const root = getNativeResourcesRoot()
  if (root === null) return null
  if (isAbsolute(resource)) throw new Error('Native resource paths must be relative')
  const path = resolve(root, resource)
  const rel = relative(root, path)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('Native resource path escapes the installation')
  }
  return path
}

export function requireNativeResource(resource: string): string {
  const path = getNativeResourcePath(resource)
  if (path === null || !existsSync(path)) {
    throw new Error(`UR installation is missing resource "${resource}". Reinstall this version of UR.`)
  }
  return path
}

/** Real filesystem modules are needed for dlopen and Playwright's own assets. */
export function loadNativeModule<T>(name: string): T {
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) {
    throw new Error('Invalid packaged module name')
  }
  const root = getNativeResourcesRoot()
  if (root === null) throw new Error('Packaged modules are only used by native UR')
  // Anchor module resolution inside the immutable installation, not the project.
  const require = createRequire(join(root, 'package.json'))
  try {
    const resourceMetadata = JSON.parse(readFileSync(requireNativeResource('package.json'), 'utf8'))
    const generatedEntry = resourceMetadata.urNativeModuleEntrypoints?.[name]
    if (generatedEntry !== undefined) {
      if (typeof generatedEntry !== 'string') throw new Error('Invalid generated module entry')
      const modulePath = realpathSync(requireNativeResource(generatedEntry))
      const rel = relative(realpathSync(root), modulePath)
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new Error('Generated module resolved outside this installation')
      }
      return require(modulePath) as T
    }
    const metadataPath = requireNativeResource(`node_modules/${name}/package.json`)
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
    if (metadata.name !== name) throw new Error('Packaged module identity mismatch')
    function requireExport(value: unknown): string | undefined {
      if (typeof value === 'string') return value
      if (value && typeof value === 'object') {
        const conditions = value as Record<string, unknown>
        for (const key of ['node', 'require', 'default']) {
          const found = requireExport(conditions[key])
          if (found) return found
        }
      }
      return undefined
    }
    const exported = typeof metadata.exports === 'object' && metadata.exports !== null
      ? metadata.exports['.'] ?? metadata.exports
      : metadata.exports
    const entry = requireExport(exported) ?? metadata.main ?? 'index.js'
    if (typeof entry !== 'string' || isAbsolute(entry)) throw new Error('Invalid packaged module entry')
    // Bun 1.3.14's compiled createRequire.resolve cannot resolve some nested
    // conditional exports (sharp). Choose its require entry from our own metadata.
    const modulePath = realpathSync(resolve(dirname(metadataPath), entry))
    const modulesRoot = realpathSync(join(root, 'node_modules'))
    const rel = relative(modulesRoot, modulePath)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error('Packaged module resolved outside this installation')
    }
    return require(modulePath) as T
  } catch (error) {
    throw new Error(`UR could not load packaged ${name}. Reinstall this version of UR.`, { cause: error })
  }
}

export type NativeResourceManifest = {
  schemaVersion: 1
  version: string
  platform: string
  files: Record<string, { sha256: string; size: number }>
}

export function readNativeResourceManifest(): NativeResourceManifest | null {
  if (!isInBundledMode()) return null
  const manifest = JSON.parse(readFileSync(requireNativeResource('manifest.json'), 'utf8')) as NativeResourceManifest
  if (manifest.schemaVersion !== 1 || typeof manifest.version !== 'string' || !manifest.files) {
    throw new Error('UR resource manifest is invalid. Reinstall this version of UR.')
  }
  if (manifest.version !== getBuildVersion()) {
    throw new Error('UR executable and resources have different versions. Reinstall this version of UR.')
  }
  return manifest
}
