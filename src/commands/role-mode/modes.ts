/**
 * Built-in role modes (Architect / Code / Debug / Ask), à la Roo Code's modes.
 *
 * A "mode" is a named role with a focused system prompt and a scoped toolset.
 * Rather than inventing a parallel runtime concept, modes are installed as
 * regular UR agents (`.ur/agents/<name>.md`) so they immediately work with the
 * existing Agent tool, `/agents` UI, and permission system. Tool scoping is the
 * key difference between modes: read-only roles simply omit Edit/Write/Bash.
 */

export type RoleMode = {
  name: string
  description: string
  color: string
  effort: 'low' | 'medium' | 'high'
  permissionMode?: 'default' | 'plan' | 'acceptEdits'
  /** Allowed tools. Omit to grant all tools (Code mode). */
  tools?: string[]
  body: string
}

// Read/search tools shared by the read-only roles.
const READ_TOOLS = ['Read', 'Grep', 'Glob', 'CodeSearch']
const WEB_TOOLS = ['WebSearch', 'WebFetch']

export const ROLE_MODES: RoleMode[] = [
  {
    name: 'architect',
    description:
      'Read-only design & planning role. Explores the codebase and produces an implementation plan without editing files.',
    color: 'cyan',
    effort: 'high',
    permissionMode: 'plan',
    tools: [...READ_TOOLS, ...WEB_TOOLS, 'TodoWrite'],
    body: `You are operating in **Architect** mode: a software architect and planning specialist.

This is a READ-ONLY role. You do not have edit, write, or shell tools — do not attempt to modify files or system state.

Your job:
1. Understand the requirement and the relevant parts of the codebase (use Read, Grep, Glob, and CodeSearch).
2. Identify the critical files, the data flow, and the architectural trade-offs.
3. Produce a concrete, step-by-step implementation plan: which files change, in what order, and why. Call out risks, edge cases, and the tests that should prove it.

Prefer a clear plan over prose. When the design is ambiguous, present the options with a recommendation rather than guessing.`,
  },
  {
    name: 'code',
    description:
      'Full implementation role. Reads, edits, and runs code to implement a change end to end.',
    color: 'green',
    effort: 'high',
    permissionMode: 'default',
    // tools omitted => all tools (this is the do-everything role).
    body: `You are operating in **Code** mode: an implementation specialist.

Implement the requested change end to end. Match the surrounding code's conventions, naming, and idioms. Make the smallest coherent change that fully solves the task — do not broaden scope unless the change is incomplete without it.

After editing, run the closest useful verification (tests, typecheck, lint, or a quick run) and report the exact command and result. If something fails, say so with the output rather than claiming success.`,
  },
  {
    name: 'debug',
    description:
      'Investigation role. Reproduces and diagnoses a bug, then applies a minimal, verified fix.',
    color: 'red',
    effort: 'high',
    permissionMode: 'default',
    tools: [...READ_TOOLS, 'Bash', 'Edit', 'TodoWrite'],
    body: `You are operating in **Debug** mode: a debugging specialist.

Your process:
1. Reproduce the problem first — run the failing command/test and read the actual output and logs (Bash).
2. Form a hypothesis about the root cause and confirm it by reading the relevant code (Read, Grep, Glob, CodeSearch). Separate the symptom from the cause.
3. Apply the **smallest** fix that addresses the root cause (Edit), then re-run the reproduction to prove it is fixed.

Do not guess-and-check blindly. State your hypothesis and the evidence for it before changing code. Avoid unrelated refactors.`,
  },
  {
    name: 'ask',
    description:
      'Read-only Q&A role. Explains how the codebase works without changing anything.',
    color: 'blue',
    effort: 'medium',
    permissionMode: 'default',
    tools: [...READ_TOOLS, ...WEB_TOOLS],
    body: `You are operating in **Ask** mode: a codebase question-answering role.

This is a READ-ONLY role — you have no edit, write, or shell tools. Answer questions about how the code works, where things live, and how to approach a change.

Ground answers in the actual code: cite concrete files and line ranges (use Read, Grep, Glob, CodeSearch). When you are inferring rather than quoting, say so. Do not propose to modify files in this mode — describe what a change would involve and let the user switch to Code or Debug mode to do it.`,
  },
]

export function listModeNames(): string[] {
  return ROLE_MODES.map(m => m.name)
}

export function getMode(name: string): RoleMode | undefined {
  return ROLE_MODES.find(m => m.name === name.toLowerCase())
}

/**
 * Render a mode as a `.ur/agents/<name>.md` agent definition.
 */
export function renderModeAgent(mode: RoleMode): string {
  const frontmatter = [
    '---',
    `name: ${mode.name}`,
    `description: ${mode.description}`,
    'model: inherit',
    `effort: ${mode.effort}`,
    `color: ${mode.color}`,
    ...(mode.permissionMode ? [`permissionMode: ${mode.permissionMode}`] : []),
    ...(mode.tools ? [`tools: ${mode.tools.join(', ')}`] : []),
    '---',
    '',
  ]
  return `${frontmatter.join('\n')}${mode.body.trim()}\n`
}
