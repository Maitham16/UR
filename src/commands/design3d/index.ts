import type { Command } from '../../types/command.js'

const design3d = {
  type: 'local',
  name: 'design3d',
  description: 'Create, plan, build, inspect, and validate Blender, OpenSCAD, 3ds Max, and custom 3D app projects',
  argumentHint: 'doctor|init|plan|build|inspect|validate [options]',
  supportsNonInteractive: true,
  load: () => import('./design3d.js'),
} satisfies Command

export default design3d
