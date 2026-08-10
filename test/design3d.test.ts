import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  executeDesign3dBuild,
  initDesign3dProject,
  inspectDesign3dAsset,
  loadDesign3dManifest,
  planDesign3dBuild,
  validateDesign3dAsset,
} from '../src/services/design3d/design3d.js'
import { runWithCwdOverride } from '../src/utils/cwd.js'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'ur-design3d-'))
}

function glb(json: unknown): Buffer {
  const source = Buffer.from(JSON.stringify(json), 'utf8')
  const padding = (4 - (source.length % 4)) % 4
  const chunk = Buffer.concat([source, Buffer.alloc(padding, 0x20)])
  const buffer = Buffer.alloc(20 + chunk.length)
  buffer.write('glTF', 0, 'ascii')
  buffer.writeUInt32LE(2, 4)
  buffer.writeUInt32LE(buffer.length, 8)
  buffer.writeUInt32LE(chunk.length, 12)
  buffer.writeUInt32LE(0x4e4f534a, 16)
  chunk.copy(buffer, 20)
  return buffer
}

describe('Design3D workflows', () => {
  test('scaffolds deterministic Blender, OpenSCAD, and 3ds Max projects', () => {
    const root = tempDir()
    const blender = initDesign3dProject(root, { name: 'web-asset', engine: 'blender', units: 'm', format: 'glb' })
    const scad = initDesign3dProject(root, { name: 'printable-part', engine: 'openscad', units: 'mm' })
    const max = initDesign3dProject(root, { name: 'max-scene', engine: '3dsmax', units: 'cm' })
    expect(blender.manifest.output).toBe('build/web-asset.glb')
    expect(readFileSync(blender.sourcePath, 'utf8')).toContain('bpy.ops.export_scene.gltf')
    expect(readFileSync(scad.sourcePath, 'utf8')).toContain('module ur_model()')
    expect(readFileSync(max.sourcePath, 'utf8')).toContain('saveMaxFile')
    expect(readFileSync(max.sourcePath, 'utf8')).toContain('units.SystemType = #Centimeters')
    expect(planDesign3dBuild(root, 'design3d/printable-part').args).toEqual(
      expect.arrayContaining(['-D', 'ur_unit_scale=1']),
    )
    expect(loadDesign3dManifest(root, join('design3d', 'max-scene')).manifest.engine).toBe('3dsmax')
    rmSync(root, { recursive: true, force: true })
  })

  test('plans fixed argv without a shell and gates custom adapters', () => {
    const root = tempDir()
    initDesign3dProject(root, {
      name: 'custom-app',
      engine: 'custom',
      adapter: { executable: 'missing-dcc', args: ['--source', '{source}', '--output', '{output}', '--units', '{units}'] },
    })
    const plan = planDesign3dBuild(root, 'design3d/custom-app')
    expect(plan.customAdapter).toBe(true)
    expect(plan.args).toContain(join(root, 'design3d', 'custom-app', 'model.script'))
    expect(plan.args).toContain(join(root, 'design3d', 'custom-app', 'build', 'custom-app.glb'))
    const gated = executeDesign3dBuild(root, 'design3d/custom-app')
    expect(gated.ok).toBe(false)
    expect(gated.error).toContain('--allow-custom')
    const dryRun = executeDesign3dBuild(root, 'design3d/custom-app', { dryRun: true })
    expect(dryRun.ok).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  test('inspects glTF, GLB, STL, and OBJ structures locally', () => {
    const root = tempDir()
    mkdirSync(join(root, 'assets'))
    const asset = { asset: { version: '2.0' }, scenes: [{}], nodes: [{ mesh: 0 }], meshes: [{ primitives: [] }], materials: [{}] }
    writeFileSync(join(root, 'assets', 'model.gltf'), JSON.stringify(asset))
    writeFileSync(join(root, 'assets', 'model.glb'), glb(asset))
    writeFileSync(join(root, 'assets', 'model.stl'), 'solid demo\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid demo\n')
    writeFileSync(join(root, 'assets', 'model.obj'), 'o Demo\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n')
    expect(inspectDesign3dAsset(root, 'assets/model.gltf').stats.meshes).toBe(1)
    expect(inspectDesign3dAsset(root, 'assets/model.glb').valid).toBe(true)
    expect(inspectDesign3dAsset(root, 'assets/model.stl').stats.triangles).toBe(1)
    expect(inspectDesign3dAsset(root, 'assets/model.obj').stats.faces).toBe(1)
    const validation = validateDesign3dAsset(root, 'assets/model.glb', { external: false })
    expect(validation.valid).toBe(true)
    expect(validation.external).toBeUndefined()
    rmSync(root, { recursive: true, force: true })
  })

  test('design3d command exposes 3ds Max and general app discovery', async () => {
    const root = tempDir()
    const { call } = await import('../src/commands/design3d/design3d.js')
    const init = await runWithCwdOverride(root, () => call('init studio --engine 3dsmax --json', {} as never))
    expect(init.type).toBe('text')
    if (init.type !== 'text') throw new Error('expected text')
    expect(JSON.parse(init.value).manifest.engine).toBe('3dsmax')
    const doctor = await runWithCwdOverride(root, () => call('doctor --json', {} as never))
    if (doctor.type !== 'text') throw new Error('expected text')
    const apps = JSON.parse(doctor.value).apps
    expect(apps.map((app: { id: string }) => app.id)).toEqual(expect.arrayContaining(['blender', '3dsmax', 'maya', 'freecad', 'houdini', 'rhino']))
    rmSync(root, { recursive: true, force: true })
  })
})
