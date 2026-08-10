import { spawnSync } from 'node:child_process'
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { delimiter, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { safeParseJSON } from '../../utils/json.js'

export type Design3dEngine = 'blender' | 'openscad' | '3dsmax' | 'custom'
export type Design3dUnits = 'mm' | 'cm' | 'm' | 'in'

export type Design3dAdapter = {
  executable: string
  args: string[]
}

export type Design3dManifest = {
  version: 1
  name: string
  engine: Design3dEngine
  units: Design3dUnits
  source: string
  output: string
  createdAt: string
  adapter?: Design3dAdapter
  quality: {
    requireManifold: boolean
    validateGlTf: boolean
  }
}

export type Design3dBuildPlan = {
  manifestPath: string
  projectDir: string
  engine: Design3dEngine
  executable: string
  executablePath: string | null
  args: string[]
  source: string
  output: string
  customAdapter: boolean
}

export type Design3dInspection = {
  path: string
  format: string
  bytes: number
  valid: boolean
  errors: string[]
  warnings: string[]
  stats: Record<string, string | number | boolean>
}

export type Design3dValidation = {
  valid: boolean
  inspection: Design3dInspection
  external?: {
    tool: 'gltf_validator'
    path: string
    valid: boolean
    exitCode?: number
    report?: unknown
    stderr: string
  }
  warnings: string[]
}

export type Design3dDoctorApp = {
  id: string
  name: string
  executable: string
  path: string | null
  supported: boolean
  role: string
}

const MANIFEST = 'design3d.json'
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const UNITS = new Set<Design3dUnits>(['mm', 'cm', 'm', 'in'])
const ENGINES = new Set<Design3dEngine>(['blender', 'openscad', '3dsmax', 'custom'])
const OUTPUT_FORMATS = new Set([
  '.3ds', '.3mf', '.blend', '.dxf', '.fbx', '.glb', '.gltf', '.max', '.obj', '.step', '.stl', '.stp',
])
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_INSPECT_BYTES = 128 * 1024 * 1024

function normalizeName(value: string): string {
  const name = value.trim().toLowerCase()
  if (!NAME_RE.test(name)) throw new Error('Project name must contain 1-64 lowercase letters, numbers, or hyphens')
  return name
}

function workspacePath(root: string, value: string, label: string): string {
  const absoluteRoot = resolve(root)
  const absolute = isAbsolute(value) ? resolve(value) : resolve(absoluteRoot, value)
  const rel = relative(absoluteRoot, absolute)
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error(`${label} must stay inside the workspace`)
  }
  return absolute
}

function projectPath(projectDir: string, value: string, label: string): string {
  const absoluteProject = resolve(projectDir)
  const absolute = resolve(absoluteProject, value)
  const rel = relative(absoluteProject, absolute)
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error(`${label} must stay inside the 3D project directory`)
  }
  return absolute
}

function defaultFormat(engine: Design3dEngine): string {
  if (engine === 'openscad') return 'stl'
  if (engine === '3dsmax') return 'max'
  return 'glb'
}

function sourceFor(engine: Design3dEngine): string {
  if (engine === 'openscad') return 'model.scad'
  if (engine === '3dsmax') return 'model.ms'
  if (engine === 'custom') return 'model.script'
  return 'model.py'
}

function blenderTemplate(): string {
  return `# UR Design3D Blender template — parametric, unit-aware, and headless-safe.
import argparse
from pathlib import Path
import bpy

parser = argparse.ArgumentParser()
parser.add_argument("--output", required=True)
parser.add_argument("--units", default="mm", choices=["mm", "cm", "m", "in"])
args = parser.parse_args(__import__("sys").argv[__import__("sys").argv.index("--") + 1:])
output = Path(args.output).resolve()

scale = {"mm": 0.001, "cm": 0.01, "m": 1.0, "in": 0.0254}[args.units]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "IMPERIAL" if args.units == "in" else "METRIC"
scene.unit_settings.scale_length = 1.0
scene.unit_settings.length_unit = {"mm": "MILLIMETERS", "cm": "CENTIMETERS", "m": "METERS", "in": "INCHES"}[args.units]

# Dimensions are expressed in manifest units. Edit these parameters, not the mesh.
width, depth, height, bevel = 40.0, 30.0, 20.0, 1.5
bpy.ops.mesh.primitive_cube_add(location=(0, 0, height * scale / 2))
obj = bpy.context.object
obj.name = "UR_Parametric_Model"
obj.dimensions = (width * scale, depth * scale, height * scale)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
modifier = obj.modifiers.new(name="Manufacturing bevel", type="BEVEL")
modifier.width = bevel * scale
modifier.segments = 3
bpy.context.view_layer.objects.active = obj
bpy.ops.object.modifier_apply(modifier=modifier.name)

material = bpy.data.materials.new("UR Material")
material.diffuse_color = (0.08, 0.32, 0.8, 1.0)
obj.data.materials.append(material)

output.parent.mkdir(parents=True, exist_ok=True)
suffix = output.suffix.lower()
if suffix == ".blend":
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
elif suffix in {".glb", ".gltf"}:
    bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB" if suffix == ".glb" else "GLTF_SEPARATE")
elif suffix == ".stl":
    if hasattr(bpy.ops.wm, "stl_export"):
        bpy.ops.wm.stl_export(filepath=str(output), export_selected_objects=False, global_scale=1.0 / scale)
    else:
        bpy.ops.export_mesh.stl(filepath=str(output), global_scale=1.0 / scale)
elif suffix == ".obj":
    if hasattr(bpy.ops.wm, "obj_export"):
        bpy.ops.wm.obj_export(filepath=str(output), export_selected_objects=False, global_scale=1.0 / scale)
    else:
        bpy.ops.export_scene.obj(filepath=str(output), global_scale=1.0 / scale)
else:
    raise SystemExit(f"Unsupported Blender output: {suffix}")
print(f"UR_DESIGN3D_OUTPUT={output}")
`
}

function openScadTemplate(): string {
  return `// UR Design3D OpenSCAD template — dimensions use the manifest units.
$fn = 64;
width = 40;
depth = 30;
height = 20;
bevel = 1.5;
ur_unit_scale = is_undef(ur_unit_scale) ? 1 : ur_unit_scale;

module ur_model() {
  // Minkowski creates a printable rounded enclosure primitive.
  minkowski() {
    cube([width - 2 * bevel, depth - 2 * bevel, height - 2 * bevel], center = true);
    sphere(r = bevel);
  }
}

scale([ur_unit_scale, ur_unit_scale, ur_unit_scale]) ur_model();
`
}

function maxScriptTemplate(): string {
  return `-- UR Design3D 3ds Max template — unattended MAXScript entry point.
-- The runner passes UR_DESIGN3D_OUTPUT and UR_DESIGN3D_UNITS.
resetMaxFile #noPrompt
output = getEnvVariable "UR_DESIGN3D_OUTPUT"
unitName = getEnvVariable "UR_DESIGN3D_UNITS"
if output == undefined or output == "" do throw "UR_DESIGN3D_OUTPUT is required"

-- Set system units before creating geometry; display units follow the project.
units.SystemScale = 1.0
case unitName of
(
  "mm": (units.SystemType = #Millimeters; units.DisplayType = #Metric; units.MetricType = #Millimeters)
  "cm": (units.SystemType = #Centimeters; units.DisplayType = #Metric; units.MetricType = #Centimeters)
  "m":  (units.SystemType = #Meters; units.DisplayType = #Metric; units.MetricType = #Meters)
  "in": (units.SystemType = #Inches; units.DisplayType = #US; units.USType = #Dec_In)
)

-- Dimensions are expressed in the manifest units.
model = chamferBox name:"UR_Parametric_Model" length:40 width:30 height:20 fillet:1.5 filletSegments:3
model.pos = [0, 0, 10]
mat = PhysicalMaterial name:"UR Material"
mat.base_color = color 20 82 204
model.material = mat

extension = toLower (getFilenameType output)
if extension == ".max" then
(
  if not (saveMaxFile output quiet:true) do throw ("Could not save " + output)
)
else
(
  if not (exportFile output #noPrompt quiet:true) do throw ("Could not export " + output)
)
format "UR_DESIGN3D_OUTPUT=%\n" output
quitMax #noPrompt
`
}

function customTemplate(): string {
  return `# UR Design3D custom adapter source.
# Replace this file with the script accepted by your DCC/CAD application's CLI.
# Adapter placeholders available in design3d.json: {source}, {output}, {project}, {units}.
`
}

function templateFor(engine: Design3dEngine): string {
  if (engine === 'openscad') return openScadTemplate()
  if (engine === '3dsmax') return maxScriptTemplate()
  if (engine === 'custom') return customTemplate()
  return blenderTemplate()
}

export function initDesign3dProject(
  root: string,
  input: {
    name: string
    engine: Design3dEngine
    units?: Design3dUnits
    format?: string
    force?: boolean
    adapter?: Design3dAdapter
  },
): { manifest: Design3dManifest; manifestPath: string; sourcePath: string } {
  const name = normalizeName(input.name)
  if (!ENGINES.has(input.engine)) throw new Error(`Unsupported 3D engine: ${input.engine}`)
  const units = input.units ?? 'mm'
  if (!UNITS.has(units)) throw new Error(`Unsupported units: ${units}`)
  const format = (input.format ?? defaultFormat(input.engine)).replace(/^\./, '').toLowerCase()
  if (!OUTPUT_FORMATS.has(`.${format}`)) throw new Error(`Unsupported 3D output format: ${format}`)
  if (input.engine === 'custom' && !input.adapter) throw new Error('Custom 3D projects require an executable adapter')
  const projectDir = workspacePath(root, join('design3d', name), '3D project')
  const manifestPath = join(projectDir, MANIFEST)
  const source = sourceFor(input.engine)
  const sourcePath = join(projectDir, source)
  if (!input.force && (existsSync(manifestPath) || existsSync(sourcePath))) {
    throw new Error(`3D project already exists: design3d/${name}`)
  }
  mkdirSync(projectDir, { recursive: true })
  const manifest: Design3dManifest = {
    version: 1,
    name,
    engine: input.engine,
    units,
    source,
    output: join('build', `${name}.${format}`),
    createdAt: new Date().toISOString(),
    adapter: input.adapter,
    quality: {
      requireManifold: format === 'stl' || format === '3mf',
      validateGlTf: format === 'glb' || format === 'gltf',
    },
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(sourcePath, templateFor(input.engine))
  return { manifest, manifestPath, sourcePath }
}

function assertManifest(value: unknown): asserts value is Design3dManifest {
  if (!value || typeof value !== 'object') throw new Error('3D manifest must be a JSON object')
  const manifest = value as Partial<Design3dManifest>
  if (
    manifest.version !== 1 ||
    typeof manifest.name !== 'string' ||
    typeof manifest.engine !== 'string' ||
    typeof manifest.units !== 'string' ||
    typeof manifest.source !== 'string' ||
    typeof manifest.output !== 'string' ||
    !ENGINES.has(manifest.engine as Design3dEngine) ||
    !UNITS.has(manifest.units as Design3dUnits)
  ) throw new Error('3D manifest is missing required version/name/engine/units/source/output fields')
}

export function resolveDesign3dManifest(root: string, input: string): string {
  const path = workspacePath(root, input, 'Manifest')
  if (existsSync(path) && statSync(path).isDirectory()) return join(path, MANIFEST)
  if (!existsSync(path) && !extname(path)) return join(path, MANIFEST)
  return path
}

export function loadDesign3dManifest(root: string, input: string): { manifest: Design3dManifest; manifestPath: string } {
  const manifestPath = resolveDesign3dManifest(root, input)
  if (!existsSync(manifestPath)) throw new Error(`3D manifest not found: ${relative(resolve(root), manifestPath)}`)
  const stat = statSync(manifestPath)
  if (stat.size > MAX_MANIFEST_BYTES) throw new Error('3D manifest is too large')
  const parsed = safeParseJSON(readFileSync(manifestPath, 'utf8'), false)
  assertManifest(parsed)
  normalizeName(parsed.name)
  if (!OUTPUT_FORMATS.has(extname(parsed.output).toLowerCase())) throw new Error(`Unsupported output format: ${parsed.output}`)
  if (parsed.engine === 'custom') validateAdapter(parsed.adapter)
  return { manifest: parsed, manifestPath }
}

function validateAdapter(adapter: Design3dAdapter | undefined): asserts adapter is Design3dAdapter {
  if (!adapter || typeof adapter.executable !== 'string' || !Array.isArray(adapter.args)) {
    throw new Error('Custom 3D manifest requires adapter.executable and adapter.args')
  }
  if (!adapter.executable.trim() || /[\0\r\n]/.test(adapter.executable) || adapter.executable.length > 1_024) {
    throw new Error('Custom adapter executable is invalid')
  }
  if (adapter.args.length > 64 || adapter.args.some(arg => typeof arg !== 'string' || arg.length > 2_048 || /[\0\r\n]/.test(arg))) {
    throw new Error('Custom adapter arguments are invalid or exceed limits')
  }
}

function canExecute(path: string): boolean {
  try {
    accessSync(path, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

function candidateWithExtensions(name: string): string[] {
  if (process.platform !== 'win32' || extname(name)) return [name]
  const pathext = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
  return [name, ...pathext.map(extension => `${name}${extension.toLowerCase()}`), ...pathext.map(extension => `${name}${extension.toUpperCase()}`)]
}

export function findExecutable(name: string): string | null {
  if (isAbsolute(name) || name.includes('/') || name.includes('\\')) {
    const absolute = resolve(name)
    return canExecute(absolute) ? absolute : null
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const candidate of candidateWithExtensions(name)) {
      const path = join(dir, candidate)
      if (canExecute(path)) return path
    }
  }
  return null
}

function firstExecutable(candidates: Array<string | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate && canExecute(candidate)) return candidate
  }
  return null
}

function findVersionedExecutable(
  parent: string,
  directoryPattern: RegExp,
  suffix: string[],
): string | null {
  try {
    const directories = readdirSync(parent, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && directoryPattern.test(entry.name))
      .map(entry => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    return firstExecutable(directories.map(directory => join(parent, directory, ...suffix)))
  } catch {
    return null
  }
}

function findBlender(): string | null {
  const direct = findExecutable(process.platform === 'win32' ? 'blender.exe' : 'blender')
  if (direct) return direct
  if (process.platform === 'darwin') {
    return firstExecutable(['/Applications/Blender.app/Contents/MacOS/Blender'])
  }
  if (process.platform === 'win32' && process.env.ProgramFiles) {
    return findVersionedExecutable(
      join(process.env.ProgramFiles, 'Blender Foundation'),
      /^Blender\b/i,
      ['blender.exe'],
    )
  }
  return null
}

function findOpenScad(): string | null {
  const direct = findExecutable(process.platform === 'win32' ? 'openscad.exe' : 'openscad')
  if (direct) return direct
  if (process.platform === 'darwin') {
    return firstExecutable(['/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD'])
  }
  if (process.platform === 'win32' && process.env.ProgramFiles) {
    return firstExecutable([join(process.env.ProgramFiles, 'OpenSCAD', 'openscad.exe')])
  }
  return null
}

function find3dsMax(): string | null {
  const direct = findExecutable('3dsmax.exe') ?? findExecutable('3dsmax')
  if (direct) return direct
  if (process.platform !== 'win32') return null
  const programFiles = process.env.ProgramFiles
  if (!programFiles) return null
  for (let year = 2035; year >= 2020; year--) {
    const candidate = join(programFiles, 'Autodesk', `3ds Max ${year}`, '3dsmax.exe')
    if (canExecute(candidate)) return candidate
  }
  return null
}

function findMaya(): string | null {
  const direct = findExecutable(process.platform === 'win32' ? 'mayabatch.exe' : 'mayabatch')
  if (direct) return direct
  if (process.platform === 'darwin') {
    return findVersionedExecutable(
      '/Applications/Autodesk',
      /^maya\d/i,
      ['Maya.app', 'Contents', 'bin', 'mayabatch'],
    )
  }
  if (process.platform === 'win32' && process.env.ProgramFiles) {
    return findVersionedExecutable(
      join(process.env.ProgramFiles, 'Autodesk'),
      /^Maya\d/i,
      ['bin', 'mayabatch.exe'],
    )
  }
  return null
}

function findFreeCad(): string | null {
  const direct = findExecutable(process.platform === 'win32' ? 'FreeCADCmd.exe' : 'FreeCADCmd')
  if (direct) return direct
  if (process.platform === 'darwin') {
    return firstExecutable([
      '/Applications/FreeCAD.app/Contents/Resources/bin/FreeCADCmd',
      '/Applications/FreeCAD.app/Contents/MacOS/FreeCADCmd',
    ])
  }
  if (process.platform === 'win32' && process.env.ProgramFiles) {
    return findVersionedExecutable(
      process.env.ProgramFiles,
      /^FreeCAD\b/i,
      ['bin', 'FreeCADCmd.exe'],
    )
  }
  return null
}

function findHoudini(): string | null {
  const direct = findExecutable(process.platform === 'win32' ? 'hython.exe' : 'hython')
  if (direct) return direct
  if (process.platform === 'darwin') {
    return findVersionedExecutable(
      '/Applications/Houdini',
      /^Houdini\b/i,
      ['Frameworks', 'Houdini.framework', 'Versions', 'Current', 'Resources', 'bin', 'hython'],
    )
  }
  if (process.platform === 'win32' && process.env.ProgramFiles) {
    return findVersionedExecutable(
      join(process.env.ProgramFiles, 'Side Effects Software'),
      /^Houdini\b/i,
      ['bin', 'hython.exe'],
    )
  }
  return null
}

function findCinema4d(): string | null {
  const executable = process.platform === 'darwin' ? 'Commandline' : 'Commandline.exe'
  const direct = findExecutable(executable)
  if (direct) return direct
  if (process.platform === 'darwin') {
    return findVersionedExecutable(
      '/Applications',
      /Cinema 4D/i,
      ['Commandline.app', 'Contents', 'MacOS', 'Commandline'],
    )
  }
  if (process.platform === 'win32' && process.env.ProgramFiles) {
    return findVersionedExecutable(
      process.env.ProgramFiles,
      /Cinema 4D/i,
      ['Commandline.exe'],
    )
  }
  return null
}

function findRhino(): string | null {
  const direct = findExecutable(process.platform === 'win32' ? 'Rhino.exe' : 'Rhino')
  if (direct) return direct
  if (process.platform === 'darwin') {
    return firstExecutable([
      '/Applications/Rhino 8.app/Contents/MacOS/Rhino',
      '/Applications/Rhino 8.app/Contents/MacOS/Rhinoceros',
    ])
  }
  if (process.platform === 'win32' && process.env.ProgramFiles) {
    return findVersionedExecutable(process.env.ProgramFiles, /^Rhino\b/i, ['System', 'Rhino.exe'])
  }
  return null
}

function executableFor(engine: Design3dEngine, adapter?: Design3dAdapter): { name: string; path: string | null } {
  if (engine === 'blender') return { name: 'blender', path: findBlender() }
  if (engine === 'openscad') return { name: 'openscad', path: findOpenScad() }
  if (engine === '3dsmax') return { name: '3dsmax.exe', path: find3dsMax() }
  validateAdapter(adapter)
  return { name: adapter.executable, path: findExecutable(adapter.executable) }
}

function expandAdapterArg(value: string, values: Record<string, string>): string {
  return value.replace(/\{(source|output|project|units)\}/g, (_, key: string) => values[key] ?? '')
}

export function planDesign3dBuild(root: string, input: string): Design3dBuildPlan {
  const { manifest, manifestPath } = loadDesign3dManifest(root, input)
  const projectDir = dirname(manifestPath)
  const source = projectPath(projectDir, manifest.source, 'Source')
  const output = projectPath(projectDir, manifest.output, 'Output')
  if (!existsSync(source)) throw new Error(`3D source not found: ${manifest.source}`)
  const executable = executableFor(manifest.engine, manifest.adapter)
  let args: string[]
  if (manifest.engine === 'blender') {
    args = ['--background', '--python', source, '--', '--output', output, '--units', manifest.units]
  } else if (manifest.engine === 'openscad') {
    const unitScale = manifest.units === 'mm' ? '1' : manifest.units === 'cm' ? '10' : manifest.units === 'm' ? '1000' : '25.4'
    args = ['-D', `ur_unit_scale=${unitScale}`, '-o', output, source]
  } else if (manifest.engine === '3dsmax') {
    args = ['-silent', '-U', 'MAXScript', source]
  } else {
    validateAdapter(manifest.adapter)
    const values = { source, output, project: projectDir, units: manifest.units }
    args = manifest.adapter.args.map(arg => expandAdapterArg(arg, values))
  }
  return {
    manifestPath,
    projectDir,
    engine: manifest.engine,
    executable: executable.name,
    executablePath: executable.path,
    args,
    source,
    output,
    customAdapter: manifest.engine === 'custom',
  }
}

export function executeDesign3dBuild(
  root: string,
  input: string,
  options: { dryRun?: boolean; force?: boolean; allowCustom?: boolean; timeoutMs?: number } = {},
): { ok: boolean; dryRun: boolean; plan: Design3dBuildPlan; exitCode?: number; stdout?: string; stderr?: string; inspection?: Design3dInspection; error?: string } {
  const plan = planDesign3dBuild(root, input)
  if (options.dryRun) return { ok: true, dryRun: true, plan }
  if (plan.customAdapter && !options.allowCustom) {
    return { ok: false, dryRun: false, plan, error: 'Custom 3D adapters require --allow-custom after reviewing the executable and arguments.' }
  }
  if (!plan.executablePath) return { ok: false, dryRun: false, plan, error: `3D application not found: ${plan.executable}` }
  if (existsSync(plan.output)) {
    if (!options.force) return { ok: false, dryRun: false, plan, error: `Output already exists: ${plan.output}; pass --force to replace it.` }
    rmSync(plan.output, { force: true })
  }
  mkdirSync(dirname(plan.output), { recursive: true })
  const result = spawnSync(plan.executablePath, plan.args, {
    cwd: plan.projectDir,
    encoding: 'utf8',
    timeout: Math.min(Math.max(options.timeoutMs ?? 10 * 60_000, 1_000), 60 * 60_000),
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      UR_DESIGN3D_OUTPUT: plan.output,
      UR_DESIGN3D_UNITS: loadDesign3dManifest(root, input).manifest.units,
    },
  })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      dryRun: false,
      plan,
      exitCode: result.status ?? undefined,
      stdout,
      stderr,
      error: result.error?.message ?? `3D application exited with status ${result.status}`,
    }
  }
  if (!existsSync(plan.output)) {
    return { ok: false, dryRun: false, plan, exitCode: result.status ?? undefined, stdout, stderr, error: '3D application succeeded but did not create the declared output.' }
  }
  const inspection = inspectDesign3dAsset(root, plan.output)
  return { ok: inspection.valid, dryRun: false, plan, exitCode: result.status ?? undefined, stdout, stderr, inspection, error: inspection.valid ? undefined : inspection.errors.join('; ') }
}

function gltfStats(json: unknown): { errors: string[]; warnings: string[]; stats: Record<string, string | number | boolean> } {
  const errors: string[] = []
  const warnings: string[] = []
  if (!json || typeof json !== 'object') return { errors: ['glTF JSON root must be an object'], warnings, stats: {} }
  const value = json as Record<string, unknown>
  const asset = value.asset as Record<string, unknown> | undefined
  if (!asset || typeof asset.version !== 'string') errors.push('glTF asset.version is missing')
  else if (asset.version !== '2.0') errors.push(`Unsupported glTF version: ${asset.version}`)
  const count = (key: string): number => Array.isArray(value[key]) ? value[key].length : 0
  if (count('scenes') === 0) warnings.push('glTF contains no scenes')
  return {
    errors,
    warnings,
    stats: {
      version: typeof asset?.version === 'string' ? asset.version : 'unknown',
      scenes: count('scenes'),
      nodes: count('nodes'),
      meshes: count('meshes'),
      materials: count('materials'),
      textures: count('textures'),
      animations: count('animations'),
    },
  }
}

function inspectGlb(buffer: Buffer): ReturnType<typeof gltfStats> {
  if (buffer.length < 20) return { errors: ['GLB header is truncated'], warnings: [], stats: {} }
  if (buffer.toString('ascii', 0, 4) !== 'glTF') return { errors: ['Invalid GLB magic'], warnings: [], stats: {} }
  const version = buffer.readUInt32LE(4)
  const declaredLength = buffer.readUInt32LE(8)
  const chunkLength = buffer.readUInt32LE(12)
  const chunkType = buffer.readUInt32LE(16)
  const errors: string[] = []
  if (version !== 2) errors.push(`Unsupported GLB version: ${version}`)
  if (declaredLength !== buffer.length) errors.push(`GLB length mismatch: header ${declaredLength}, actual ${buffer.length}`)
  if (chunkType !== 0x4e4f534a) errors.push('GLB first chunk is not JSON')
  if (20 + chunkLength > buffer.length) errors.push('GLB JSON chunk exceeds file size')
  if (errors.length > 0) return { errors, warnings: [], stats: { version, declaredLength } }
  const text = buffer.toString('utf8', 20, 20 + chunkLength).replace(/[\0\x20]+$/g, '')
  const parsed = safeParseJSON(text, false)
  const result = gltfStats(parsed)
  return { ...result, errors: [...errors, ...result.errors], stats: { ...result.stats, glbVersion: version, declaredLength } }
}

export function inspectDesign3dAsset(root: string, input: string): Design3dInspection {
  const path = workspacePath(root, input, '3D asset')
  if (!existsSync(path)) throw new Error(`3D asset not found: ${input}`)
  const stat = statSync(path)
  if (!stat.isFile()) throw new Error('3D asset must be a file')
  if (stat.size > MAX_INSPECT_BYTES) throw new Error(`3D asset exceeds inspection limit (${MAX_INSPECT_BYTES} bytes)`)
  const ext = extname(path).toLowerCase()
  const buffer = readFileSync(path)
  let errors: string[] = []
  let warnings: string[] = []
  let stats: Record<string, string | number | boolean> = {}
  if (ext === '.gltf') {
    const result = gltfStats(safeParseJSON(buffer.toString('utf8'), false))
    errors = result.errors
    warnings = result.warnings
    stats = result.stats
  } else if (ext === '.glb') {
    const result = inspectGlb(buffer)
    errors = result.errors
    warnings = result.warnings
    stats = result.stats
  } else if (ext === '.stl') {
    const header = buffer.subarray(0, Math.min(buffer.length, 256)).toString('utf8').trimStart()
    if (/^solid\b/i.test(header) && /\bfacet\s+normal\b/i.test(buffer.toString('utf8', 0, Math.min(buffer.length, 2_000_000)))) {
      const facets = buffer.toString('utf8').match(/\bfacet\s+normal\b/gi)?.length ?? 0
      if (facets === 0) errors.push('ASCII STL contains no facets')
      stats = { encoding: 'ascii', triangles: facets }
    } else if (buffer.length >= 84) {
      const triangles = buffer.readUInt32LE(80)
      const expectedBytes = 84 + triangles * 50
      if (expectedBytes !== buffer.length) errors.push(`Binary STL size mismatch: expected ${expectedBytes}, actual ${buffer.length}`)
      stats = { encoding: 'binary', triangles }
    } else errors.push('STL header is truncated')
  } else if (ext === '.obj') {
    const text = buffer.toString('utf8')
    const vertices = text.match(/^v\s+/gm)?.length ?? 0
    const faces = text.match(/^f\s+/gm)?.length ?? 0
    if (vertices === 0 || faces === 0) errors.push('Wavefront OBJ must contain vertices and faces')
    stats = { vertices, faces, objects: text.match(/^o\s+/gm)?.length ?? 0, materials: text.match(/^usemtl\s+/gm)?.length ?? 0 }
  } else if (ext === '.blend') {
    const signature = buffer.toString('ascii', 0, Math.min(buffer.length, 12))
    if (!signature.startsWith('BLENDER')) errors.push('Invalid Blender file signature')
    stats = { signature: signature.slice(0, 12), version: signature.length >= 12 ? signature.slice(9, 12) : 'unknown' }
  } else if (ext === '.max') {
    if (buffer.length < 32) errors.push('3ds Max scene is too small to be valid')
    warnings.push('Native .max structure requires 3ds Max `isMaxFile()` for complete validation.')
    stats = { native3dsMaxScene: true }
  } else if (OUTPUT_FORMATS.has(ext)) {
    if (buffer.length === 0) errors.push('3D asset is empty')
    warnings.push(`${ext} received structural size validation only; use the originating DCC/CAD application for native validation.`)
  } else errors.push(`Unsupported 3D asset format: ${ext || '(none)'}`)
  return {
    path,
    format: ext.replace(/^\./, '') || 'unknown',
    bytes: buffer.length,
    valid: errors.length === 0,
    errors,
    warnings,
    stats,
  }
}

export function validateDesign3dAsset(
  root: string,
  input: string,
  options: { external?: boolean } = {},
): Design3dValidation {
  const inspection = inspectDesign3dAsset(root, input)
  const warnings = [...inspection.warnings]
  if (!['gltf', 'glb'].includes(inspection.format) || options.external === false) {
    return { valid: inspection.valid, inspection, warnings }
  }
  const validator = findExecutable(process.platform === 'win32' ? 'gltf_validator.exe' : 'gltf_validator')
  if (!validator) {
    warnings.push('Khronos glTF Validator was not found; only bounded structural validation was performed.')
    return { valid: inspection.valid, inspection, warnings }
  }
  const result = spawnSync(validator, ['--stdout', inspection.path], {
    cwd: dirname(inspection.path),
    encoding: 'utf8',
    timeout: 2 * 60_000,
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  const report = stdout ? safeParseJSON(stdout, false) : null
  const external = {
    tool: 'gltf_validator' as const,
    path: validator,
    valid: !result.error && result.status === 0,
    exitCode: result.status ?? undefined,
    report,
    stderr: stderr.slice(0, 20_000),
  }
  if (result.error) warnings.push(`Khronos validator failed to run: ${result.error.message}`)
  return { valid: inspection.valid && external.valid, inspection, external, warnings }
}

export function design3dDoctor(): Design3dDoctorApp[] {
  const candidates: Array<Omit<Design3dDoctorApp, 'path' | 'supported'> & { finder?: () => string | null }> = [
    { id: 'blender', name: 'Blender', executable: 'blender', role: 'modeling, rendering, animation, glTF/STL/OBJ export', finder: findBlender },
    { id: 'openscad', name: 'OpenSCAD', executable: 'openscad', role: 'parametric CAD and manufacturing meshes', finder: findOpenScad },
    { id: '3dsmax', name: 'Autodesk 3ds Max', executable: '3dsmax.exe', role: 'DCC modeling, MAXScript automation, native .max scenes', finder: find3dsMax },
    { id: 'maya', name: 'Autodesk Maya', executable: process.platform === 'win32' ? 'mayabatch.exe' : 'mayabatch', role: 'DCC modeling, rigging, and animation', finder: findMaya },
    { id: 'freecad', name: 'FreeCAD', executable: process.platform === 'win32' ? 'FreeCADCmd.exe' : 'FreeCADCmd', role: 'parametric mechanical CAD and STEP workflows', finder: findFreeCad },
    { id: 'houdini', name: 'SideFX Houdini', executable: 'hython', role: 'procedural modeling and simulation', finder: findHoudini },
    { id: 'cinema4d', name: 'Cinema 4D', executable: process.platform === 'darwin' ? 'Commandline' : 'Commandline.exe', role: 'DCC modeling, motion graphics, and rendering', finder: findCinema4d },
    { id: 'rhino', name: 'Rhino', executable: process.platform === 'win32' ? 'Rhino.exe' : 'Rhino', role: 'NURBS CAD and fabrication workflows', finder: findRhino },
    { id: 'gltf-validator', name: 'Khronos glTF Validator', executable: process.platform === 'win32' ? 'gltf_validator.exe' : 'gltf_validator', role: 'glTF 2.0 conformance validation' },
  ]
  return candidates.map(candidate => {
    const path = candidate.finder?.() ?? findExecutable(candidate.executable)
    return { id: candidate.id, name: candidate.name, executable: candidate.executable, path, supported: path !== null, role: candidate.role }
  })
}

export function formatDesign3dPlan(plan: Design3dBuildPlan): string {
  const executable = plan.executablePath ?? plan.executable
  return [
    `3D build plan (${plan.engine})`,
    `  application: ${executable}${plan.executablePath ? '' : ' (not found)'}`,
    `  source:      ${plan.source}`,
    `  output:      ${plan.output}`,
    `  argv:        ${JSON.stringify([executable, ...plan.args])}`,
    ...(plan.customAdapter ? ['  safety:      custom adapter requires explicit --allow-custom'] : []),
  ].join('\n')
}
