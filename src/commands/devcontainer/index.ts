import type { Command } from '../../types/command.js'

const devcontainer = {
  type: 'local',
  name: 'devcontainer',
  aliases: ['exec-target'],
  description:
    'Opt-in reproducible container execution target (.ur/devcontainer.json): run ci-loop and commands isolated in Docker/devcontainer instead of the host',
  argumentHint: 'status|init [--image ref]|exec -- <command> [--dry-run] [--json]',
  supportsNonInteractive: true,
  load: () => import('./devcontainer.js'),
} satisfies Command

export default devcontainer
