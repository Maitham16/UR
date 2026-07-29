import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

export const WORKING_MODES = [
  'code',
  'research',
  'debug',
  'browser',
  'image',
  'video',
  'data',
] as const

export type WorkingMode = (typeof WORKING_MODES)[number]

const MODE_PROMPTS: Record<WorkingMode, string> = {
  code: `Use the normal software-engineering workflow: inspect before editing, preserve existing conventions, make the smallest complete change, and verify at the narrowest useful level before broader checks.`,
  research: `Work as an evidence-led researcher. Define the question and inclusion criteria, prefer primary sources, record provenance, distinguish observations from inference, compare conflicting evidence, and do not state a claim more strongly than its sources support.`,
  debug: `Work as a debugger. Reproduce the symptom first, record competing hypotheses, isolate variables with the cheapest discriminating checks, fix the root cause rather than the symptom, and add a regression check that fails before the fix and passes after it.`,
  browser: `Work as a browser operator. Inspect the current page state before each dependent action, use stable semantic targets, wait for and re-check observable state transitions, preserve screenshots or logs as evidence, and require approval for consequential submissions, purchases, downloads, or account changes.`,
  image: `Work as a visual analyst. Separate directly visible evidence, OCR/metadata output, and inference; inspect at sufficient resolution; preserve coordinates, labels, units, and uncertainty; and verify extracted values against the image before reporting them.`,
  video: `Work as a video analyst. Establish duration, streams, and sampling coverage; use timestamps for observations; distinguish audio, frame, metadata, and inferred evidence; and verify important conclusions across adjacent frames or transcript context.`,
  data: `Work as a data analyst. Preserve source data, validate schema, types, units, missingness, duplicates, and sampling assumptions before analysis; use reproducible transformations; report denominators and uncertainty; and verify calculations independently when conclusions matter.`,
}

export function workingModePath(cwd: string): string {
  return join(cwd, '.ur', 'mode')
}

export function isWorkingMode(value: string): value is WorkingMode {
  return (WORKING_MODES as readonly string[]).includes(value)
}

function escapesWorkspace(workspace: string, target: string): boolean {
  const rel = relative(workspace, target)
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
}

function safeWorkingModePath(
  cwd: string,
  create: boolean,
): string | undefined {
  const workspace = realpathSync(cwd)
  const directory = join(workspace, '.ur')
  if (!existsSync(directory)) {
    if (!create) return undefined
    mkdirSync(directory, { mode: 0o700 })
  }
  const directoryStat = lstatSync(directory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error('working-mode storage must use a regular workspace directory')
  }
  const resolvedDirectory = realpathSync(directory)
  if (escapesWorkspace(workspace, resolvedDirectory)) {
    throw new Error('working-mode storage resolves outside the workspace')
  }
  const target = join(resolvedDirectory, 'mode')
  if (existsSync(target)) {
    const targetStat = lstatSync(target)
    if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
      throw new Error('working-mode marker must be a regular file')
    }
  }
  return create || existsSync(target) ? target : undefined
}

export function loadWorkingMode(cwd: string): WorkingMode {
  try {
    const path = safeWorkingModePath(cwd, false)
    if (!path) return 'code'
    const value = readFileSync(path, 'utf8').trim().toLowerCase()
    return isWorkingMode(value) ? value : 'code'
  } catch {
    return 'code'
  }
}

export function saveWorkingMode(cwd: string, mode: WorkingMode): void {
  const target = safeWorkingModePath(cwd, true)!
  const temporary = join(
    realpathSync(join(realpathSync(cwd), '.ur')),
    `.mode.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    writeFileSync(temporary, `${mode}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
    renameSync(temporary, target)
  } catch (error) {
    try {
      if (existsSync(temporary)) unlinkSync(temporary)
    } catch {
      // Preserve the original persistence error.
    }
    throw error
  }
}

export function getWorkingModePrompt(cwd: string): string {
  const mode = loadWorkingMode(cwd)
  return `# Working mode: ${mode}\n${MODE_PROMPTS[mode]}`
}
