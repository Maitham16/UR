import { extname } from 'node:path'
import type { LocalCommandCall } from '../../types/command.js'
import { parseArguments } from '../../utils/argumentSubstitution.js'
import { getCwd } from '../../utils/cwd.js'
import {
  design3dDoctor,
  executeDesign3dBuild,
  formatDesign3dPlan,
  initDesign3dProject,
  inspectDesign3dAsset,
  loadDesign3dManifest,
  planDesign3dBuild,
  validateDesign3dAsset,
  type Design3dAdapter,
  type Design3dEngine,
  type Design3dUnits,
} from '../../services/design3d/design3d.js'

const OPTIONS_WITH_VALUES = new Set([
  '--engine', '--units', '--format', '--executable', '--adapter-arg', '--timeout',
])

function option(tokens: string[], name: string): string | undefined {
  const index = tokens.indexOf(name)
  return index === -1 ? undefined : tokens[index + 1]
}

function options(tokens: string[], name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] === name && tokens[index + 1] !== undefined) values.push(tokens[index + 1]!)
  }
  return values
}

function positionals(tokens: string[]): string[] {
  const values: string[] = []
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (OPTIONS_WITH_VALUES.has(token)) {
      index++
      continue
    }
    if (!token.startsWith('--')) values.push(token)
  }
  return values
}

function usage(): string {
  return [
    'Usage:',
    '  ur design3d doctor [--json]',
    '  ur design3d init <name> --engine blender|openscad|3dsmax|custom [--units mm|cm|m|in] [--format glb|gltf|stl|obj|blend|max|fbx|3ds|step|3mf]',
    '  ur design3d init <name> --engine custom --executable <app> --adapter-arg <arg>... [--force]',
    '  ur design3d plan <project-dir|design3d.json> [--json]',
    '  ur design3d build <project-dir|design3d.json> [--dry-run] [--force] [--allow-custom] [--timeout <seconds>] [--json]',
    '  ur design3d inspect <asset.glb|gltf|stl|obj|blend|max> [--json]',
    '  ur design3d validate <project-dir|manifest|asset> [--internal-only] [--json]',
    '',
    'Custom adapters never use a shell. Arguments support exact {source}, {output}, {project}, and {units} placeholders.',
  ].join('\n')
}

function parseTimeout(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3_600) {
    throw new Error('Timeout must be between 1 and 3600 seconds')
  }
  return Math.round(seconds * 1_000)
}

export const call: LocalCommandCall = async (args: string) => {
  const tokens = parseArguments(args)
  const values = positionals(tokens)
  const action = values[0] ?? 'doctor'
  const target = values[1]
  const json = tokens.includes('--json')
  const root = getCwd()
  try {
    if (action === 'help') return { type: 'text', value: usage() }
    if (action === 'doctor') {
      const apps = design3dDoctor()
      const human = [
        `3D applications: ${apps.filter(app => app.supported).length}/${apps.length} discovered`,
        ...apps.map(app => `${app.supported ? 'READY' : 'MISSING'} ${app.name} — ${app.path ?? app.executable}\n  ${app.role}`),
      ].join('\n')
      return { type: 'text', value: json ? JSON.stringify({ apps }, null, 2) : human }
    }
    if (action === 'init') {
      if (!target) return { type: 'text', value: usage() }
      const engine = (option(tokens, '--engine') ?? 'blender') as Design3dEngine
      const executable = option(tokens, '--executable')
      const adapterArgs = options(tokens, '--adapter-arg')
      const adapter: Design3dAdapter | undefined = executable ? { executable, args: adapterArgs } : undefined
      const result = initDesign3dProject(root, {
        name: target,
        engine,
        units: (option(tokens, '--units') ?? 'mm') as Design3dUnits,
        format: option(tokens, '--format'),
        force: tokens.includes('--force'),
        adapter,
      })
      return {
        type: 'text',
        value: json
          ? JSON.stringify(result, null, 2)
          : `Created ${result.manifest.engine} 3D project.\n  manifest: ${result.manifestPath}\n  source:   ${result.sourcePath}`,
      }
    }
    if (!target) return { type: 'text', value: usage() }
    if (action === 'plan') {
      const plan = planDesign3dBuild(root, target)
      return { type: 'text', value: json ? JSON.stringify(plan, null, 2) : formatDesign3dPlan(plan) }
    }
    if (action === 'build') {
      const result = executeDesign3dBuild(root, target, {
        dryRun: tokens.includes('--dry-run'),
        force: tokens.includes('--force'),
        allowCustom: tokens.includes('--allow-custom'),
        timeoutMs: parseTimeout(option(tokens, '--timeout')),
      })
      const human = result.ok
        ? `${result.dryRun ? 'Validated dry-run' : 'Built and inspected 3D asset'}.\n${formatDesign3dPlan(result.plan)}${result.inspection ? `\n  inspection: ${result.inspection.valid ? 'PASS' : 'FAIL'} (${result.inspection.format}, ${result.inspection.bytes} bytes)` : ''}`
        : `3D build failed: ${result.error ?? 'unknown error'}\n${formatDesign3dPlan(result.plan)}`
      return { type: 'text', value: json ? JSON.stringify(result, null, 2) : human }
    }
    if (action === 'inspect') {
      const inspection = inspectDesign3dAsset(root, target)
      const human = [
        `3D asset inspection: ${inspection.valid ? 'PASS' : 'FAIL'}`,
        `  path:   ${inspection.path}`,
        `  format: ${inspection.format}`,
        `  bytes:  ${inspection.bytes}`,
        ...Object.entries(inspection.stats).map(([key, value]) => `  ${key}: ${value}`),
        ...inspection.errors.map(error => `ERROR: ${error}`),
        ...inspection.warnings.map(warning => `WARN: ${warning}`),
      ].join('\n')
      return { type: 'text', value: json ? JSON.stringify(inspection, null, 2) : human }
    }
    if (action === 'validate') {
      try {
        const { manifest, manifestPath } = loadDesign3dManifest(root, target)
        const plan = planDesign3dBuild(root, manifestPath)
        const validation = (() => {
          try {
            return validateDesign3dAsset(root, plan.output, { external: !tokens.includes('--internal-only') })
          } catch {
            return null
          }
        })()
        const result = {
          valid: Boolean(plan.executablePath) && (validation?.valid ?? true),
          manifest,
          plan,
          validation,
          warnings: [
            ...(plan.executablePath ? [] : [`Application not found: ${plan.executable}`]),
            ...(validation ? validation.warnings : ['Declared output does not exist yet; source and build plan were validated.']),
          ],
        }
        const human = [
          `3D project validation: ${result.valid ? 'PASS' : 'WARN'}`,
          formatDesign3dPlan(plan),
          ...result.warnings.map(warning => `WARN: ${warning}`),
          ...(validation ? [`Asset validation: ${validation.valid ? 'PASS' : 'FAIL'}`] : []),
        ].join('\n')
        return { type: 'text', value: json ? JSON.stringify(result, null, 2) : human }
      } catch (manifestError) {
        const targetExtension = extname(target).toLowerCase()
        if (!targetExtension || targetExtension === '.json') throw manifestError
        const validation = validateDesign3dAsset(root, target, { external: !tokens.includes('--internal-only') })
        return { type: 'text', value: json ? JSON.stringify(validation, null, 2) : `3D asset validation: ${validation.valid ? 'PASS' : 'FAIL'}\n${validation.inspection.errors.join('\n') || `${validation.inspection.format}, ${validation.inspection.bytes} bytes`}${validation.external ? `\nKhronos glTF Validator: ${validation.external.valid ? 'PASS' : 'FAIL'}` : ''}` }
      }
    }
  } catch (error) {
    return { type: 'text', value: `design3d failed: ${error instanceof Error ? error.message : String(error)}` }
  }
  return { type: 'text', value: usage() }
}
