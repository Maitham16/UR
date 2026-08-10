import { registerBundledSkill } from '../bundledSkills.js'

const DESIGN_3D_PROMPT = `# Professional 3D / DCC Design Workflow

Create or modify a reproducible 3D project using the application's native scriptable workflow. UR supports Blender Python, OpenSCAD, Autodesk 3ds Max MAXScript, and reviewed custom adapters for apps such as Maya, FreeCAD, Houdini, Cinema 4D, and Rhino.

## Requirements and application choice

1. Confirm intended use (render, animation, game/web asset, manufacturing, CAD exchange), exact dimensions, units, tolerances, coordinate/up-axis expectations, materials, and output format.
2. Run \`ur design3d doctor\` and choose the best installed application. Use OpenSCAD/FreeCAD-style parametric CAD for dimensional parts, Blender/3ds Max/Maya/Houdini for DCC scenes, and glTF/GLB for interoperable runtime delivery.
3. Search official application and format documentation when an exporter, modifier, material, or version-specific API is uncertain.

## Build non-destructively

1. Scaffold with \`ur design3d init <slug> --engine blender|openscad|3dsmax --units mm --format glb|stl|max\`.
2. Edit the generated source script; keep dimensions named and parametric, preserve modifiers/history where appropriate, apply real-world scale, name objects/materials, and avoid manual-only steps.
3. For another DCC/CAD tool, define a custom adapter with an executable and separate arguments. Review \`ur design3d plan\`, then pass \`--allow-custom\`; UR never invokes adapters through a shell.
4. Run \`ur design3d build <project> --dry-run\` before execution. Do not overwrite an output unless the user requested it and \`--force\` is appropriate.

## Verify the artifact

1. Build, then run \`ur design3d inspect <asset>\` and \`ur design3d validate <project>\`.
2. For glTF/GLB delivery, use the Khronos glTF Validator when installed. For printable meshes, verify manifoldness, normals, wall thickness, scale, and tolerances in the chosen CAD/DCC tool.
3. For native .max files, validate with 3ds Max \`isMaxFile()\`; for other native formats, use their originating application.
4. Report the source, manifest, output, units, application/version, validation evidence, warnings, and any manual visual checks still needed. Never claim a model exists unless the output file was actually produced.
`

export function registerDesign3dSkill(): void {
  registerBundledSkill({
    name: 'dcc-design',
    aliases: ['professional-3d'],
    description: 'Design, automate, build, and validate 3D assets with Blender, OpenSCAD, 3ds Max, or another reviewed DCC/CAD app.',
    whenToUse: 'Use for 3D modeling, CAD, DCC, meshes, scenes, animation assets, glTF/GLB, STL, Blender, OpenSCAD, Autodesk 3ds Max, Maya, FreeCAD, Houdini, Cinema 4D, or Rhino tasks.',
    allowedTools: ['WebSearch', 'WebFetch', 'Read', 'Grep', 'Glob', 'Edit', 'Bash'],
    argumentHint: '[3D design brief]',
    userInvocable: true,
    async getPromptForCommand(args) {
      return [{ type: 'text', text: `${DESIGN_3D_PROMPT}${args ? `\n\n## Design brief\n\n${args}` : ''}` }]
    },
  })
}
