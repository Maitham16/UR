import { AGENT_TOOL_NAME } from '../../tools/AgentTool/constants.js'
import { registerBundledSkill } from '../bundledSkills.js'

const DOCKERIZE_PROMPT = `# Dockerize Skill

Add production-ready Docker support to the project in an isolated worktree. Include a Dockerfile, compose file, health checks, and .dockerignore.

## Setup

1. Use the ${AGENT_TOOL_NAME} tool with "isolation: worktree" and model "route: auto" to create a fresh git worktree and branch named "ur/dockerize-<timestamp>-<slug>". UR will pick a cheap or strong model based on the project complexity.
2. Inspect the project: runtime, package manager, ports, environment variables, build command, and start command.

## Files to create

1. **Dockerfile** — multi-stage if appropriate, non-root user, minimal image, correct entrypoint.
2. **docker-compose.yml** or **compose.yaml** — service definition, port mapping, env-file support, health check, and volume mounts if needed.
3. **.dockerignore** — ignore node_modules, .git, .ur, build artifacts, secrets, and editor files.
4. Optionally a **docs/docker.md** note explaining how to build and run.

## Verification

1. Build the image: <code>docker build -t <project> .</code>
2. Run the container and confirm it starts (or use <code>docker compose up --build</code> if compose is available).
3. Check that the health check responds correctly.
4. Keep all changes local in the worktree.

## Finish

1. Use AskUserQuestion to ask whether the user wants the full Docker verification sequence run.
2. Run it only if approved; otherwise report the checks already completed.
3. Do not commit, push, or open a PR unless separately requested.

Return a concise summary: branch name, created files, verification evidence, and caveats.
`

export function registerDockerizeSkill(): void {
  registerBundledSkill({
    name: 'dockerize',
    aliases: ['docker'],
    description:
      'Add Dockerfile, compose file, health checks, and .dockerignore in an isolated worktree.',
    allowedTools: [AGENT_TOOL_NAME, 'Read', 'Grep', 'Glob', 'Edit', 'Bash', 'Docker', 'AskUserQuestion'],
    argumentHint: '[optional runtime or service description]',
    userInvocable: true,
    async getPromptForCommand(args) {
      let prompt = DOCKERIZE_PROMPT
      if (args) {
        prompt += `\n\n## Containerization target\n\n${args}`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
